import { createMessageHandler } from '../services/messaging';
import { runDomainSecurityChecks } from '../heuristics/domain';

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
    // TG-03: Run domain & security checks
    const { security, domain, payment } = await runDomainSecurityChecks();
    
    // Collect all signals
    const allSignals = [
      ...security.signals,
      ...domain.signals,
      ...payment.signals,
    ];
    
    // Calculate total risk score
    const totalRiskScore = allSignals.reduce((sum, signal) => sum + signal.score, 0);
    
    // Determine risk level based on score
    let riskLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical' = 'safe';
    if (totalRiskScore >= 76) riskLevel = 'critical';
    else if (totalRiskScore >= 51) riskLevel = 'high';
    else if (totalRiskScore >= 26) riskLevel = 'medium';
    else if (totalRiskScore >= 1) riskLevel = 'low';
    
    // TODO: TG-04 will populate contact and policies
    const analysis = {
      url: window.location.href,
      timestamp: Date.now(),
      security,
      domain,
      payment,
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
      totalRiskScore,
      riskLevel,
      allSignals,
      analysisVersion: '1.0.0',
      isEcommerceSite: true, // TODO: Detect if it's actually e-commerce
    };
    
    console.log('✅ Analysis complete:', {
      riskLevel,
      totalRiskScore,
      signalCount: allSignals.length,
    });
    
    return analysis;
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
