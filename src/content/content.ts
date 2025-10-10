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
        signals: window.location.protocol !== 'https:' ? [{
          id: 'sec-001',
          score: 15,
          reason: 'Website does not use HTTPS',
          severity: 'medium' as const,
          category: 'security' as const,
          source: 'heuristic' as const,
          details: 'Unencrypted connections can be intercepted by attackers',
        }] : [],
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
        signals: [{
          id: 'con-001',
          score: 10,
          reason: 'No contact information found',
          severity: 'low' as const,
          category: 'legitimacy' as const,
          source: 'heuristic' as const,
          details: 'Legitimate stores typically provide multiple contact methods',
        }],
      },
      policies: {
        hasReturnPolicy: true,
        hasShippingPolicy: false,
        hasRefundPolicy: true,
        hasTermsOfService: true,
        hasPrivacyPolicy: false,
        policyUrls: {
          returns: '#returns',
          refund: '#refund',
          terms: '#terms',
        },
        signals: [{
          id: 'pol-001',
          score: 8,
          reason: 'Missing shipping policy',
          severity: 'low' as const,
          category: 'policy' as const,
          source: 'heuristic' as const,
        }, {
          id: 'pol-002',
          score: 12,
          reason: 'No privacy policy found',
          severity: 'medium' as const,
          category: 'policy' as const,
          source: 'heuristic' as const,
          details: 'Privacy policies are required by law in many jurisdictions',
        }],
      },
      payment: {
        acceptedMethods: [],
        hasReversibleMethods: false,
        hasIrreversibleOnly: false,
        signals: [],
      },
      totalRiskScore: 0,
      riskLevel: 'safe' as 'safe' | 'low' | 'medium' | 'high' | 'critical',
      allSignals: [] as any[],
      analysisVersion: '1.0.0',
      isEcommerceSite: true,
    };
    
    // Collect all signals
    const allSignals = [
      ...mockAnalysis.security.signals,
      ...mockAnalysis.domain.signals,
      ...mockAnalysis.contact.signals,
      ...mockAnalysis.policies.signals,
      ...mockAnalysis.payment.signals,
    ];
    
    // Calculate total risk score
    const totalRiskScore = allSignals.reduce((sum, signal) => sum + signal.score, 0);
    
    // Determine risk level
    let riskLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical' = 'safe';
    if (totalRiskScore >= 76) riskLevel = 'critical';
    else if (totalRiskScore >= 51) riskLevel = 'high';
    else if (totalRiskScore >= 26) riskLevel = 'medium';
    else if (totalRiskScore >= 1) riskLevel = 'low';
    
    mockAnalysis.allSignals = allSignals;
    mockAnalysis.totalRiskScore = totalRiskScore;
    mockAnalysis.riskLevel = riskLevel;
    
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
