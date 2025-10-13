import { createMessageHandler } from '../services/messaging';
import { pageAnalyzer } from '../services/pageAnalyzer';
import { displayAnnotations, clearAnnotations, MOCK_ANNOTATIONS } from './annotator';

console.log('🛡️ Shop Sentinel content script loaded on:', window.location.href);

async function handlePing() {
  return { status: 'ready', url: window.location.href };
}

async function handleGetPageInfo() {
  // Use the page analyzer for consistent page type detection
  const cached = await pageAnalyzer.getCachedAnalysis(window.location.href);
  const pageType = cached?.pageType || 'other';
  const pageTypeConfidence = cached?.pageTypeConfidence || 0;
  
  // Check if analysis is currently in progress
  const isInProgress = await pageAnalyzer.isAnalysisInProgress(window.location.href);
  
  return {
    title: document.title,
    url: window.location.href,
    domain: window.location.hostname,
    protocol: window.location.protocol,
    pageType,
    pageTypeConfidence,
    isAnalysisInProgress: isInProgress,
  };
}

/**
 * Main page analysis handler
 * Implements TG-06: Full Heuristic Engine Integration with production-quality architecture
 */

async function handleAnalyzePage(payload: any) {
  console.log('🔍 Starting page analysis...', payload);
  
  try {
    // Check if analysis is already in progress
    const isInProgress = await pageAnalyzer.isAnalysisInProgress(window.location.href);
    if (isInProgress) {
      return {
        status: 'in_progress',
        message: 'Analysis is already running in another tab. Please wait or check that tab.',
        url: window.location.href,
      };
    }
    
    // Run comprehensive analysis using the page analyzer
    const result = await pageAnalyzer.analyzePage(window.location.href, {
      includeAI: payload?.includeAI !== false,
      forceRefresh: payload?.forceRefresh === true,
    });
    
    return result;
    
  } catch (error) {
    console.error('❌ Analysis failed:', error);
    
    // Return error response instead of throwing
    return {
      status: 'error',
      error: error instanceof Error ? error.message : 'Analysis failed',
      url: window.location.href,
    };
  }
}

async function handleHighlightElements(payload: any) {
  console.log('🎨 Highlighting elements...', payload);
  
  // TODO [TG-07 Integration]: Replace with real AI elements when TG-07 is merged
  // Currently using mock data for testing annotations
  const elementsToHighlight = payload?.elements || MOCK_ANNOTATIONS;
  
  const result = displayAnnotations(elementsToHighlight);
  return result;
}

async function handleClearHighlights() {
  console.log('🧹 Clearing highlights...');
  const result = clearAnnotations();
  return result;
}

chrome.runtime.onMessage.addListener(
  createMessageHandler({
    PING: handlePing,
    GET_PAGE_INFO: handleGetPageInfo,
    ANALYZE_PAGE: handleAnalyzePage,
    HIGHLIGHT_ELEMENTS: handleHighlightElements,
    CLEAR_HIGHLIGHTS: handleClearHighlights,
  })
);

// ============================================================================
// URL CHANGE MONITORING (for SPAs)
// ============================================================================

let lastUrl = window.location.href;
let urlCheckInterval: number | null = null;

/**
 * Monitor URL changes for Single Page Applications (SPAs)
 * Many e-commerce sites use SPAs (React, Vue, etc.) that don't trigger page reloads
 * We need to detect navigation and invalidate cache appropriately
 */
function startUrlChangeMonitoring() {
  // Clear any existing interval
  if (urlCheckInterval) {
    clearInterval(urlCheckInterval);
  }
  
  // Poll for URL changes every second
  urlCheckInterval = window.setInterval(async () => {
    const currentUrl = window.location.href;
    
    if (currentUrl !== lastUrl) {
      console.log('🔄 URL changed (SPA navigation detected)');
      console.log('   From:', lastUrl);
      console.log('   To:', currentUrl);
      
      await handleUrlChange(lastUrl, currentUrl);
      lastUrl = currentUrl;
    }
  }, 1000) as unknown as number;
  
  // Also listen for popstate (browser back/forward)
  window.addEventListener('popstate', async () => {
    console.log('⬅️ Browser navigation detected (back/forward)');
    const currentUrl = window.location.href;
    
    if (currentUrl !== lastUrl) {
      await handleUrlChange(lastUrl, currentUrl);
      lastUrl = currentUrl;
    }
  });
  
  // Listen for pushState and replaceState (SPA routing)
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  
  history.pushState = function(...args) {
    originalPushState.apply(history, args);
    const currentUrl = window.location.href;
    
    if (currentUrl !== lastUrl) {
      console.log('🔀 pushState detected');
      handleUrlChange(lastUrl, currentUrl);
      lastUrl = currentUrl;
    }
  };
  
  history.replaceState = function(...args) {
    originalReplaceState.apply(history, args);
    const currentUrl = window.location.href;
    
    if (currentUrl !== lastUrl) {
      console.log('🔀 replaceState detected');
      handleUrlChange(lastUrl, currentUrl);
      lastUrl = currentUrl;
    }
  };
  
  console.log('👀 URL change monitoring started');
}

/**
 * Handle URL change - invalidate cache if page changed significantly
 */
async function handleUrlChange(oldUrl: string, newUrl: string) {
  try {
    const { StorageService } = await import('../services/storage');
    
    const oldDomain = new URL(oldUrl).hostname.replace(/^www\./, '');
    const newDomain = new URL(newUrl).hostname.replace(/^www\./, '');
    
    if (oldDomain !== newDomain) {
      // Different domain: Clear all caches for the new domain
      console.log('🌐 Domain changed, clearing cache for new domain');
      await StorageService.clearCachedAnalysis(newUrl);
    } else {
      // Same domain: Check if page type changed
      const oldPath = new URL(oldUrl).pathname;
      const newPath = new URL(newUrl).pathname;
      
      // If paths are significantly different, likely a new page
      if (oldPath !== newPath) {
        const oldType = detectPageTypeFromUrl(oldUrl);
        const newType = detectPageTypeFromUrl(newUrl);
        
        if (oldType !== newType) {
          console.log(`📄 Page type changed: ${oldType} → ${newType}, clearing cache`);
          await StorageService.clearCachedAnalysis(newUrl, newType);
        } else {
          // Same page type but different path (e.g., different product)
          // Clear cache for this specific page type
          console.log(`🔄 Path changed within same page type (${newType}), clearing cache`);
          await StorageService.clearCachedAnalysis(newUrl, newType);
        }
      }
    }
  } catch (error) {
    console.error('⚠️ Error handling URL change:', error);
  }
}

/**
 * Detect page type from URL (without needing DOM access)
 */
function detectPageTypeFromUrl(url: string): string {
  const pathname = new URL(url).pathname.toLowerCase();
  
  if (pathname === '/' || pathname === '') return 'home';
  if (pathname.includes('/product/') || pathname.includes('/item/') || pathname.includes('/dp/')) return 'product';
  if (pathname.includes('/cart') || pathname.includes('/basket')) return 'cart';
  if (pathname.includes('/checkout') || pathname.includes('/payment')) return 'checkout';
  if (pathname.includes('/category') || pathname.includes('/shop') || pathname.includes('/browse')) return 'category';
  if (pathname.includes('/privacy') || pathname.includes('/terms') || pathname.includes('/policy')) return 'policy';
  
  return 'other';
}

// Cleanup on page unload
window.addEventListener('beforeunload', async () => {
  try {
    const { StorageService } = await import('../services/storage');
    // Clear progress markers (analysis interrupted by navigation)
    await StorageService.clearAnalysisProgress(window.location.href);
    console.log('🧹 Cleaned up on page unload');
  } catch (error) {
    // Ignore errors during cleanup
  }
});

// ============================================================================
// INITIALIZATION
// ============================================================================

function initializeContentScript() {
  console.log('✅ Shop Sentinel initialized on:', window.location.href);
  
  // Start URL change monitoring for SPAs
  startUrlChangeMonitoring();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeContentScript);
} else {
  initializeContentScript();
}
