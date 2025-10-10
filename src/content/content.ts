import { createMessageHandler } from '../services/messaging';
import { runDomainSecurityChecks } from '../heuristics/domain';
import { runContentPolicyChecks } from '../heuristics/content';

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
    const { security, domain, payment } = await runDomainSecurityChecks();
    const { contact, policies } = await runContentPolicyChecks();
    
    const allSignals = [
      ...security.signals,
      ...domain.signals,
      ...payment.signals,
      ...contact.signals,
      ...policies.signals,
    ];
    
    const totalRiskScore = allSignals.reduce((sum, signal) => sum + signal.score, 0);
    
    let riskLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical' = 'safe';
    if (totalRiskScore >= 76) riskLevel = 'critical';
    else if (totalRiskScore >= 51) riskLevel = 'high';
    else if (totalRiskScore >= 26) riskLevel = 'medium';
    else if (totalRiskScore >= 1) riskLevel = 'low';
    
    const analysis = {
      url: window.location.href,
      timestamp: Date.now(),
      security,
      domain,
      payment,
      contact,
      policies,
      totalRiskScore,
      riskLevel,
      allSignals,
      analysisVersion: '1.0.0',
      isEcommerceSite: true,
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
  return { highlighted: 0 };
}

async function handleClearHighlights() {
  console.log('🧹 Clearing highlights...');
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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeContentScript);
} else {
  initializeContentScript();
}
