import { createMessageHandler } from '../services/messaging';

console.log('🛡️ Shop Sentinel content script loaded on:', window.location.href);

async function handlePing() {
  return { status: 'ready', url: window.location.href };
}

async function handleGetPageInfo() {
  return {
    title: document.title,
    url: window.location.href,
    domain: window.location.hostname,
    protocol: window.location.protocol,
  };
}

async function handleAnalyzePage(payload: any) {
  console.log('🔍 Starting page analysis...', payload);
  
  try {
    // TODO: This will be implemented in TG-03, TG-04
    const mockAnalysis = {
      url: window.location.href,
      timestamp: Date.now(),
      security: {
        isHttps: window.location.protocol === 'https:',
        hasMixedContent: false,
        hasValidCertificate: true,
        signals: [],
      },
      domain: {
        domain: window.location.hostname,
        ageInDays: 365,
        registrar: null,
        isSuspicious: false,
        signals: [],
      },
      contact: {
        hasContactPage: false,
        hasPhoneNumber: false,
        hasPhysicalAddress: false,
        hasEmail: false,
        socialMediaLinks: [],
        signals: [],
      },
      policies: {
        hasReturnPolicy: false,
        hasShippingPolicy: false,
        hasRefundPolicy: false,
        hasTermsOfService: false,
        hasPrivacyPolicy: false,
        policyUrls: {},
        signals: [],
      },
      payment: {
        acceptedMethods: [],
        hasReversibleMethods: false,
        hasIrreversibleOnly: false,
        signals: [],
      },
      totalRiskScore: 15,
      riskLevel: 'low' as const,
      allSignals: [],
      analysisVersion: '1.0.0',
      isEcommerceSite: true,
    };
    
    return mockAnalysis;
  } catch (error) {
    console.error('❌ Analysis error:', error);
    throw error;
  }
}

async function handleHighlightElements(payload: any) {
  console.log('🎨 Highlighting elements...', payload);
  // TODO: Implement in TG-09
  return { highlighted: 0 };
}

async function handleClearHighlights() {
  console.log('🧹 Clearing highlights...');
  // TODO: Implement in TG-09
  return { cleared: 0 };
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

function initializeContentScript() {
  console.log('✅ Shop Sentinel initialized on:', window.location.href);
  // TODO: Add auto-scan logic here if enabled
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeContentScript);
} else {
  initializeContentScript();
}
