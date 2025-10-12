import { createMessageHandler } from '../services/messaging';
import { runDomainSecurityChecks } from '../heuristics/domain';
import { runContentPolicyChecks } from '../heuristics/content';
import { AIService } from '../services/ai';
import { RiskCalculator } from '../services/riskCalculator';
import { displayAnnotations, clearAnnotations, MOCK_ANNOTATIONS } from './annotator';

console.log('🛡️ Shop Sentinel content script loaded on:', window.location.href);

async function handlePing() {
  return { status: 'ready', url: window.location.href };
}

async function handleGetPageInfo() {
  const pageTypeResult = detectPageType();
  return {
    title: document.title,
    url: window.location.href,
    domain: window.location.hostname,
    protocol: window.location.protocol,
    pageType: pageTypeResult.type,
    pageTypeConfidence: pageTypeResult.confidence,
  };
}

/**
 * Page type detection result with confidence score
 */
interface PageTypeResult {
  type: 'home' | 'product' | 'category' | 'checkout' | 'cart' | 'policy' | 'other';
  confidence: number; // 0-100
  signals: string[]; // What made us decide this
}

/**
 * Detect page type using multiple signals (URL, DOM, Schema.org)
 * Returns type with confidence score for better decision making
 */
function detectPageType(): PageTypeResult {
  const path = window.location.pathname.toLowerCase();
  const search = window.location.search.toLowerCase();
  const title = document.title.toLowerCase();
  
  // Score-based detection for better accuracy
  const scores = {
    checkout: 0,
    cart: 0,
    product: 0,
    category: 0,
    policy: 0,
    home: 0,
  };
  const signals: string[] = [];
  
  // === CHECKOUT PAGE DETECTION ===
  if (path.includes('checkout') || path.includes('payment')) {
    scores.checkout += 40;
    signals.push('checkout-url');
  }
  if (title.includes('checkout') || title.includes('payment')) {
    scores.checkout += 20;
    signals.push('checkout-title');
  }
  if (document.querySelector('[class*="checkout"], [id*="checkout"]')) {
    scores.checkout += 20;
    signals.push('checkout-element');
  }
  if (document.querySelector('input[type="text"][placeholder*="card"], [class*="payment"]')) {
    scores.checkout += 30;
    signals.push('payment-input');
  }
  
  // === CART PAGE DETECTION ===
  if (path.includes('cart') || path.includes('basket')) {
    scores.cart += 40;
    signals.push('cart-url');
  }
  if (title.includes('cart') || title.includes('basket')) {
    scores.cart += 20;
    signals.push('cart-title');
  }
  if (document.querySelector('[class*="cart-item"], [class*="basket-item"]')) {
    scores.cart += 30;
    signals.push('cart-items');
  }
  const hasCheckoutButton = document.querySelector('button[class*="checkout"], a[href*="checkout"]');
  if (hasCheckoutButton) {
    scores.cart += 15;
    signals.push('proceed-to-checkout');
  }
  
  // === CATEGORY/LISTING PAGE DETECTION (CHECK FIRST - highest priority after checkout/cart) ===
  const productCards = document.querySelectorAll(
    '.product-card, .product-item, [class*="product-grid"] > *, [data-product-id], [class*="product-base"], ' +
    // Amazon-specific
    '[data-asin], .s-result-item, .sg-col-inner, .a-section.a-spacing-base, ' +
    // eBay-specific
    '.s-item, [class*="srp-item"], ' +
    // Generic
    'article[class*="product"], li[class*="product"], div[data-sku]'
  ).length;
  
  // Strong signal: Many product cards = definitely category
  if (productCards > 8) {
    scores.category += 60;
    signals.push(`${productCards}-product-cards`);
  } else if (productCards > 4) {
    scores.category += 40;
    signals.push(`${productCards}-product-cards`);
  } else if (productCards > 2) {
    scores.category += 20;
    signals.push(`${productCards}-product-cards`);
  }
  
  // URL patterns for category pages
  if (path.includes('/category') || path.includes('/collection') || 
      path.includes('/shop') || path.includes('/search') ||
      path.includes('/b/') || path.includes('/b?') || // Amazon browse nodes
      path.includes('/s?') || path.includes('/s/') || // Amazon search
      path.includes('/sch/') || // eBay search
      /\/(men|women|kids|boys|girls|unisex)[-\/]/.test(path)) { // Gender-specific paths
    scores.category += 35;
    signals.push('category-url');
  }
  
  // Query parameters that indicate category/listing pages
  if (search.includes('node=') || // Amazon category node
      search.includes('category=') || 
      search.includes('search') ||
      search.includes('q=') || // Search query
      search.includes('s=') || // Sort parameter
      search.includes('_nkw=')) { // eBay search
    scores.category += 30;
    signals.push('category-query-params');
  }
  
  // Filter/sort controls are strong category indicators
  const filterControls = document.querySelectorAll(
    '.filter, [class*="filter"], .sort, [class*="sort"], ' +
    // Amazon-specific
    '[id*="filters"], [class*="refinement"], [id*="departments"], ' +
    // Generic
    'select[name*="sort"], [aria-label*="filter"], [aria-label*="sort"]'
  ).length;
  if (filterControls > 0) {
    scores.category += 25;
    signals.push('filter-controls');
  }
  
  // Pagination is a category page indicator
  if (document.querySelector('.pagination, [class*="pagination"], [aria-label*="pagination"]')) {
    scores.category += 20;
    signals.push('pagination');
  }
  
  // === PRODUCT PAGE DETECTION (Lower priority than category) ===
  // Schema.org is the strongest signal for single product
  if (document.querySelector('[itemtype*="Product"]')) {
    scores.product += 50;
    signals.push('product-schema');
  }
  
  // Add to cart button variants (CSS selector only - no text matching here)
  const addToCartButton = document.querySelector(
    'button[name*="add"], button[class*="add-to-cart"], [data-action*="add"], ' +
    'button[class*="addtocart"], button[class*="add_to_cart"], ' +
    '[class*="pdp-add"], [class*="add-to-bag"]'
  );
  if (addToCartButton) {
    // Reduce score if there are many product cards (it's a category page)
    const addToCartScore = productCards > 3 ? 10 : 35;
    scores.product += addToCartScore;
    signals.push('add-to-cart-button');
  }
  
  // Check for "ADD TO BAG/CART/BASKET" text in buttons (case-insensitive)
  const allButtons = Array.from(document.querySelectorAll('button'));
  const hasAddButton = allButtons.some(btn => 
    /add\s+to\s+(cart|bag|basket)/i.test(btn.textContent || '')
  );
  if (hasAddButton && productCards < 3) {
    scores.product += 30;
    signals.push('add-text-button');
  }
  
  // Single price element with product details
  const priceElements = document.querySelectorAll(
    '[itemprop="price"], .price, [class*="product-price"], [class*="pdp-price"], ' +
    '[class*="actual-price"], [class*="selling-price"]'
  ).length;
  if (priceElements === 1) {
    scores.product += 25;
    signals.push('single-price');
  } else if (priceElements > 1 && priceElements < 5 && productCards < 3) {
    scores.product += 15;
    signals.push('few-prices');
  }
  
  // URL patterns for single product (strong signal)
  if (path.includes('/product') || path.includes('/item') || path.includes('/p/') || 
      path.includes('/dp/') || path.includes('/gp/product') || path.includes('/buy')) { // /buy endpoint
    scores.product += 35;
    signals.push('product-url');
  }
  
  // Product ID in URL is a very strong signal (5+ digits)
  if (/\/\d{5,}/.test(path) && productCards < 3) {
    scores.product += 40;
    signals.push('product-id-in-url');
  }
  
  // Product-specific containers
  if (document.querySelector('.product-detail, #product, [class*="product-info"], [class*="pdp-"], [id*="pdp"]')) {
    scores.product += 20;
    signals.push('product-container');
  }
  
  // Size/color selectors (common on product pages, not category pages)
  const hasSizeSelector = document.querySelector(
    '[class*="size-"], [class*="sizebutton"], select[name*="size"], ' +
    'input[name*="size"], [data-size]'
  );
  if (hasSizeSelector && productCards < 3) {
    scores.product += 25;
    signals.push('size-selector');
  }
  
  // Single product title (h1) with price nearby
  const h1Elements = document.querySelectorAll('h1');
  if (h1Elements.length === 1 && priceElements > 0 && priceElements < 3) {
    scores.product += 20;
    signals.push('single-title-with-price');
  }
  
  // === POLICY PAGE DETECTION ===
  const policyKeywords = ['policy', 'terms', 'privacy', 'return', 'shipping', 'refund'];
  if (policyKeywords.some(kw => path.includes(kw))) {
    scores.policy += 50;
    signals.push('policy-url');
  }
  if (policyKeywords.some(kw => title.includes(kw))) {
    scores.policy += 30;
    signals.push('policy-title');
  }
  const textLength = document.body.innerText.length;
  if (textLength > 5000 && document.querySelectorAll('h1, h2, h3').length > 5) {
    scores.policy += 20;
    signals.push('long-text-content');
  }
  
  // === HOME PAGE DETECTION ===
  if (path === '/' || path === '/index' || path === '/home') {
    scores.home += 50;
    signals.push('root-path');
  }
  // Reduce navigation links score (common on all pages)
  if (document.querySelector('nav a[href*="shop"], nav a[href*="product"]') && path.length < 5) {
    scores.home += 15;
    signals.push('navigation-links');
  }
  // Hero section only counts if on short path (likely homepage)
  if (document.querySelector('.hero, [class*="banner"], [class*="carousel"]') && path.length < 10) {
    scores.home += 10;
    signals.push('hero-section');
  }
  
  // === DETERMINE BEST MATCH ===
  const entries = Object.entries(scores) as [keyof typeof scores, number][];
  entries.sort((a, b) => b[1] - a[1]);
  
  const topType = entries[0][0];
  const topScore = entries[0][1];
  
  // If highest score is too low, mark as 'other'
  if (topScore < 15) {
    return { type: 'other', confidence: 0, signals: ['no-clear-signals'] };
  }
  
  return {
    type: topType as any,
    confidence: Math.min(topScore, 100),
    signals,
  };
}

async function handleAnalyzePage(payload: any) {
  console.log('🔍 Starting page analysis...', payload);
  const startTime = performance.now();
  
  // Import storage service first
  const { StorageService } = await import('../services/storage');
  
  try {
    // Detect page type with confidence scoring
    const pageTypeResult = detectPageType();
    const pageType = pageTypeResult.type;
    console.log(`📄 Page Type: ${pageType} (confidence: ${pageTypeResult.confidence}%, signals: ${pageTypeResult.signals.join(', ')})`);
    
    // Try to acquire distributed lock to prevent duplicate analysis
    const lockAcquired = await StorageService.acquireAnalysisLock(window.location.href, pageType);
    
    if (!lockAcquired) {
      console.log('⏳ Analysis already in progress in another tab');
      return {
        status: 'in_progress',
        message: 'Analysis is already running in another tab. Please wait or check that tab.',
        url: window.location.href,
        pageType,
      };
    }
    
    // Mark analysis as in progress with page context
    await StorageService.setAnalysisInProgress(window.location.href, pageType, payload?.includeAI !== false);
    
    // Run heuristic checks in parallel for better performance
    const [
      { security, domain, payment },
      { contact, policies }
    ] = await Promise.all([
      runDomainSecurityChecks(),
      runContentPolicyChecks()
    ]);


    // Step 2: For each detected pattern, get AI explanation and add to RiskSignal
    
    const aiAvailable = await AIService.checkAvailability();
    console.log(`🤖 AI Available: ${aiAvailable}`);
    
    let aiSignals: any[] = [];
    let aiAnalysisTime = 0;
    
    const shouldRunAI = payload?.includeAI !== false && 
                        aiAvailable && 
                        pageType !== 'policy' &&
                        pageType !== 'other';
    
    if (shouldRunAI) {
      console.log(`🤖 Running AI-powered analysis for ${pageType} page...`);
      const aiStartTime = performance.now();
      
      try {
        // Initialize session first (will reuse if already exists)
        const initialized = await AIService.initializeSession();
        
        if (!initialized) {
          console.warn('⚠️ AI session failed to initialize, skipping AI analysis');
          aiAnalysisTime = performance.now() - aiStartTime;
        } else {
          // Extract page content for AI analysis
          const pageContent = {
            url: window.location.href,
            title: document.title,
            pageType: pageType, // Pass string type for AI
            confidence: pageTypeResult.confidence,
            headings: Array.from(document.querySelectorAll('h1, h2, h3'))
              .map(el => el.textContent?.trim() || '')
              .filter(text => text.length > 0)
              .slice(0, 10), // Limit to reduce token usage
            buttons: Array.from(document.querySelectorAll('button, a.btn, input[type="submit"]'))
              .map(el => el.textContent?.trim() || (el as HTMLInputElement).value || '')
              .filter(text => text.length > 0)
              .slice(0, 20), // Limit to reduce token usage
            forms: Array.from(document.querySelectorAll('form'))
              .map(form => form.id || form.className || 'form')
              .filter(text => text.length > 0)
              .slice(0, 5),
          };
          
          const pageText = document.body.innerText || '';
          
          // Context-aware AI analysis based on page type
          const analyses: Promise<any[]>[] = [];
        
          // Analyze dark patterns with page context
          analyses.push(AIService.analyzeDarkPatterns(pageContent));
          
          // Legitimacy check only on pages where it matters - with full context
          if (pageType === 'product' || pageType === 'checkout' || pageType === 'home') {
            // Extract social media data from profiles
            const socialMediaData = {
              facebook: contact.socialMediaProfiles.find(p => p.platform === 'facebook')?.url || null,
              twitter: contact.socialMediaProfiles.find(p => p.platform === 'twitter')?.url || null,
              instagram: contact.socialMediaProfiles.find(p => p.platform === 'instagram')?.url || null,
              linkedin: contact.socialMediaProfiles.find(p => p.platform === 'linkedin')?.url || null,
              youtube: contact.socialMediaProfiles.find(p => p.platform === 'youtube')?.url || null,
              count: contact.socialMediaProfiles.length,
            };
            
            analyses.push(AIService.analyzeLegitimacy({
              url: window.location.href,
              title: document.title,
              content: pageText.slice(0, 1500),
              hasHTTPS: security.isHttps,
              hasContactInfo: contact.hasContactPage || contact.hasEmail || contact.hasPhoneNumber,
              hasPolicies: policies.hasReturnPolicy || policies.hasPrivacyPolicy,
              
              // Enhanced context: Social media intelligence
              socialMedia: socialMediaData,
              
              // Enhanced context: Domain intelligence from WHOIS
              domainAge: domain.ageInDays,
              domainAgeYears: domain.ageInDays ? Math.floor(domain.ageInDays / 365) : null,
              domainStatus: domain.status,
              domainRegistrar: domain.registrar,
            }));
            
            console.log('🧠 AI Context:', {
              domainAge: domain.ageInDays ? `${domain.ageInDays} days` : 'Unknown',
              registrar: domain.registrar || 'Unknown',
              protectionFlags: domain.status?.length || 0,
              socialMediaCount: socialMediaData.count,
              hasContact: contact.hasContactPage || contact.hasEmail || contact.hasPhoneNumber,
            });
          }
          
          // Run selected analyses in parallel
          const results = await Promise.all(analyses);
          aiSignals = results.flat();
          
          aiAnalysisTime = performance.now() - aiStartTime;
          console.log(`✅ AI found ${aiSignals.length} signals in ${aiAnalysisTime.toFixed(0)}ms`);
        }
      } catch (aiError) {
        aiAnalysisTime = performance.now() - aiStartTime;
        console.error(`⚠️ AI analysis failed after ${aiAnalysisTime.toFixed(0)}ms:`, aiError);
      }
    } else {
      const reason = !aiAvailable ? 'AI not available' : 
                     pageType === 'policy' ? 'policy page' :
                     pageType === 'other' ? 'unknown page type' :
                     'AI disabled';
      console.log(`⏭️ Skipping AI analysis: ${reason}`);
    }
    
    // Collect all signals (heuristics + AI)
    const allSignals = [
      ...security.signals,
      ...domain.signals,
      ...payment.signals,
      ...contact.signals,
      ...policies.signals,
      ...aiSignals,
    ];
    
    // Use smart risk calculator with deduplication and proper normalization
    const riskAnalysis = RiskCalculator.calculateScore(allSignals);
    const totalRiskScore = riskAnalysis.totalScore; // Guaranteed 0-100
    const riskLevel = riskAnalysis.riskLevel;
    
    console.log('📊 Risk Analysis Breakdown:', {
      totalScore: `${riskAnalysis.totalScore}/100`,
      riskLevel: riskAnalysis.riskLevel,
      categories: {
        security: `${riskAnalysis.breakdown.security.percentage}% (${riskAnalysis.breakdown.security.signals.length} signals)`,
        legitimacy: `${riskAnalysis.breakdown.legitimacy.percentage}% (${riskAnalysis.breakdown.legitimacy.signals.length} signals)`,
        darkPatterns: `${riskAnalysis.breakdown.darkPattern.percentage}% (${riskAnalysis.breakdown.darkPattern.signals.length} signals)`,
        policies: `${riskAnalysis.breakdown.policy.percentage}% (${riskAnalysis.breakdown.policy.signals.length} signals)`,
      },
      topConcerns: riskAnalysis.topConcerns.map(s => `${s.reason} (${s.score})`),
    });
    
    const analysis = {
      url: window.location.href,
      timestamp: Date.now(),
      pageType,
      security,
      domain,
      payment,
      contact,
      policies,
      totalRiskScore,
      riskLevel,
      allSignals,
      // Enhanced risk analysis data
      riskBreakdown: riskAnalysis.breakdown,
      topConcerns: riskAnalysis.topConcerns,
      analysisVersion: '2.0.0', // Updated version with smart scoring
      isEcommerceSite: true,
      aiEnabled: aiAvailable,
      aiSignalsCount: aiSignals.length,
    };
    
    const totalTime = performance.now() - startTime;
    console.log('✅ Analysis complete:', {
      riskLevel,
      totalRiskScore,
      signalCount: allSignals.length,
      aiSignals: aiSignals.length,
      pageType,
      totalTime: `${totalTime.toFixed(0)}ms`,
      aiTime: `${aiAnalysisTime.toFixed(0)}ms`,
      heuristicTime: `${(totalTime - aiAnalysisTime).toFixed(0)}ms`,
    });
    
    // Cache the result immediately (before returning to popup)
    // This ensures cache persists even if popup closes during analysis
    try {
      await StorageService.cacheAnalysis(window.location.href, pageType, analysis);
      await StorageService.clearAnalysisProgress(window.location.href);
      console.log(`💾 Analysis cached: ${pageType}`);
    } catch (cacheError) {
      console.warn('⚠️ Failed to cache analysis:', cacheError);
    } finally {
      // Always release the lock, even if caching fails
      await StorageService.releaseAnalysisLock(window.location.href, pageType);
    }
    
    return analysis;
  } catch (error) {
    console.error('❌ Analysis error:', error);
    
    // Detect page type for cleanup (in case error happened before detection)
    const pageTypeResult = detectPageType();
    const pageType = pageTypeResult.type;
    
    // Clear progress and release lock on error (robust cleanup)
    try {
      await StorageService.clearAnalysisProgress(window.location.href);
      await StorageService.releaseAnalysisLock(window.location.href, pageType);
    } catch (cleanupError) {
      console.error('⚠️ Error during cleanup:', cleanupError);
    }
    
    throw error;
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
