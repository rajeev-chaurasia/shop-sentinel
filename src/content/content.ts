import { createMessageHandler } from '../services/messaging';
import { runDomainSecurityChecks } from '../heuristics/domain';
import { runContentPolicyChecks } from '../heuristics/content';
import { AIService } from '../services/ai';
import { RiskCalculator } from '../services/riskCalculator';
import { crossTabSync } from '../services/crossTabSync';
import { PolicyDetectionService } from '../services/policyDetection';
import { enhanceDomainAnalysisWithAI } from '../services/aiDomainAnalyzer';
import { seedImpersonationPatterns } from '../services/impersonationPatterns';
import { progressCache } from '../services/progressCache';
import type { PhaseResult } from '../types/messages';
import { getApiUrl } from '../config/env';

/**
 * Send progress update to popup for real-time UI feedback
 */
function sendProgressUpdate(
  url: string,
  phase: string,
  subPhase: string,
  status: 'started' | 'processing' | 'completed',
  progress: number,
  elapsedMs?: number,
  findings?: { signalsFound: number; topFinding?: string }
): void {
  const phaseResult: PhaseResult = {
    phase,
    subPhase,
    status,
    progress,
    elapsedMs,
    timestamp: Date.now(),
    findings,
  };

  progressCache.savePhaseResult(url, phaseResult);

  chrome.runtime.sendMessage({
    action: 'ANALYSIS_PROGRESS',
    payload: {
      url,
      phase,
      subPhase,
      status,
      progress,
      elapsedMs,
      findings,
    },
  }).catch(err => {
    if (!err.message?.includes('Receiving end does not exist')) {
      console.warn('Failed to send progress update:', err);
    }
  });
}

async function handlePing() {
  return { status: 'ready', url: window.location.href };
}

async function handleGetPageInfo() {
  const pageTypeResult = detectPageType();
  const policyDetection = PolicyDetectionService.detectPolicyPage();
  
  return {
    title: document.title,
    url: window.location.href,
    domain: window.location.hostname,
    protocol: window.location.protocol,
    pageType: pageTypeResult.type,
    pageTypeConfidence: pageTypeResult.confidence,
    pageTypeSignals: pageTypeResult.signals,
    isPolicyPage: policyDetection.isPolicyPage,
    policyType: policyDetection.policyType,
    policyConfidence: policyDetection.confidence,
    policyLegitimacy: policyDetection.legitimacy || null,
  };
}

interface PageTypeResult {
  type: 'home' | 'product' | 'category' | 'checkout' | 'cart' | 'policy' | 'other';
  confidence: number;
  signals: string[];
}

function detectPageType(): PageTypeResult {
  const path = window.location.pathname.toLowerCase();
  const search = window.location.search.toLowerCase();
  const title = document.title.toLowerCase();
  
  const scores = {
    checkout: 0,
    cart: 0,
    product: 0,
    category: 0,
    policy: 0,
    home: 0,
  };
  const signals: string[] = [];
  
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
  
  const productCards = document.querySelectorAll(
    '.product-card, .product-item, [class*="product-grid"] > *, [data-product-id], [class*="product-base"], ' +
    '[data-asin], .s-result-item, .sg-col-inner, .a-section.a-spacing-base, ' +
    '.s-item, [class*="srp-item"], ' +
    'article[class*="product"], li[class*="product"], div[data-sku]'
  ).length;
  
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
  
  if (path.includes('/category') || path.includes('/collection') || 
      path.includes('/shop') || path.includes('/search') ||
      path.includes('/b/') || path.includes('/b?') ||
      path.includes('/s?') || path.includes('/s/') ||
      path.includes('/sch/') ||
      /\/(men|women|kids|boys|girls|unisex)[-\/]/.test(path)) {
    scores.category += 35;
    signals.push('category-url');
  }
  
  if (search.includes('node=') ||
      search.includes('category=') || 
      search.includes('search') ||
      search.includes('q=') ||
      search.includes('s=') ||
      search.includes('_nkw=')) {
    scores.category += 30;
    signals.push('category-query-params');
  }
  
  const filterControls = document.querySelectorAll(
    '.filter, [class*="filter"], .sort, [class*="sort"], ' +
    '[id*="filters"], [class*="refinement"], [id*="departments"], ' +
    'select[name*="sort"], [aria-label*="filter"], [aria-label*="sort"]'
  ).length;
  if (filterControls > 0) {
    scores.category += 25;
    signals.push('filter-controls');
  }
  
  if (document.querySelector('.pagination, [class*="pagination"], [aria-label*="pagination"]')) {
    scores.category += 20;
    signals.push('pagination');
  }
  
  if (document.querySelector('[itemtype*="Product"]')) {
    scores.product += 50;
    signals.push('product-schema');
  }
  
  const addToCartButton = document.querySelector(
    'button[name*="add"], button[class*="add-to-cart"], [data-action*="add"], ' +
    'button[class*="addtocart"], button[class*="add_to_cart"], ' +
    '[class*="pdp-add"], [class*="add-to-bag"]'
  );
  if (addToCartButton) {
    const addToCartScore = productCards > 3 ? 10 : 35;
    scores.product += addToCartScore;
    signals.push('add-to-cart-button');
  }
  
  const allButtons = Array.from(document.querySelectorAll('button'));
  const hasAddButton = allButtons.some(btn => 
    /add\s+to\s+(cart|bag|basket)/i.test(btn.textContent || '')
  );
  if (hasAddButton && productCards < 3) {
    scores.product += 30;
    signals.push('add-text-button');
  }
  
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
  
  if (path.includes('/product') || path.includes('/item') || path.includes('/p/') || 
      path.includes('/dp/') || path.includes('/gp/product') || path.includes('/buy')) {
    scores.product += 35;
    signals.push('product-url');
  }
  
  if (/\/\d{5,}/.test(path) && productCards < 3) {
    scores.product += 40;
    signals.push('product-id-in-url');
  }
  
  if (document.querySelector('.product-detail, #product, [class*="product-info"], [class*="pdp-"], [id*="pdp"]')) {
    scores.product += 20;
    signals.push('product-container');
  }
  
  const hasSizeSelector = document.querySelector(
    '[class*="size-"], [class*="sizebutton"], select[name*="size"], ' +
    'input[name*="size"], [data-size]'
  );
  if (hasSizeSelector && productCards < 3) {
    scores.product += 25;
    signals.push('size-selector');
  }
  
  const h1Elements = document.querySelectorAll('h1');
  if (h1Elements.length === 1 && priceElements > 0 && priceElements < 3) {
    scores.product += 20;
    signals.push('single-title-with-price');
  }
  
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
  
  if (path === '/' || path === '/index' || path === '/home') {
    scores.home += 50;
    signals.push('root-path');
  }
  if (document.querySelector('nav a[href*="shop"], nav a[href*="product"]') && path.length < 5) {
    scores.home += 15;
    signals.push('navigation-links');
  }
  if (document.querySelector('.hero, [class*="banner"], [class*="carousel"]') && path.length < 10) {
    scores.home += 10;
    signals.push('hero-section');
  }
  
  const entries = Object.entries(scores) as [keyof typeof scores, number][];
  entries.sort((a, b) => b[1] - a[1]);
  
  const topType = entries[0][0];
  const topScore = entries[0][1];
  
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
  const startTime = performance.now();
  
  const { StorageService } = await import('../services/storage');
  
  try {
    try {
      await seedImpersonationPatterns();
    } catch (seedError) {
      console.warn('Failed to seed impersonation patterns:', seedError);
    }
    
    const pageTypeResult = detectPageType();
    const pageType = pageTypeResult.type;
    
    const lockAcquired = await StorageService.acquireAnalysisLock(window.location.href, pageType);
    
    if (!lockAcquired) {
      return {
        status: 'in_progress',
        message: 'Analysis is already running in another tab. Please wait or check that tab.',
        url: window.location.href,
        pageType,
      };
    }
    
    await StorageService.setAnalysisInProgress(window.location.href, pageType, payload?.includeAI !== false);
    
    crossTabSync.broadcastAnalysisStart(window.location.href, pageType);
    
    let backendJobId: string | null = null;
    const sessionId = `${Date.now()}-${Math.random()}`;
    
    try {
      const jobResponse = await fetch(getApiUrl('/api/jobs'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: window.location.href,
          pageType,
          options: { sessionId },
          status: 'created',
          progress: 0,
        })
      });
      
      if (jobResponse.ok) {
        const jobData = await jobResponse.json();
        backendJobId = jobData.job?.id;
        if (backendJobId) {
          chrome.runtime.sendMessage({
            action: 'BACKEND_JOB_CREATED',
            payload: { jobId: backendJobId, url: window.location.href, pageType, sessionId }
          }).catch(err => console.warn('Failed to notify service worker:', err));
        }
      } else {
        console.warn('Backend job creation failed:', jobResponse.status);
      }
    } catch (jobError) {
      console.warn('Failed to create backend job:', jobError);
    }
    
    const updateBackendJobProgress = async (progress: number, stage: string, data?: any) => {
      if (!backendJobId) return;
      
      try {
        await fetch(getApiUrl(`/api/jobs/${backendJobId}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            progress: Math.min(Math.max(progress, 0), 100),
            status: 'in_progress',
            stage,
            sessionId,
            ...data,
          })
        }).catch(err => console.warn(`Failed to update job progress:`, err));
      } catch (error) {
        console.warn('Error updating backend job progress:', error);
      }
    };
    
    const sendPartialResult = async (partialData: any, phase: string) => {
      try {
        const partialResult = {
          ...partialData,
          status: 'partial',
          phase,
          url: window.location.href,
          timestamp: Date.now(),
          pageType,
          analysisVersion: '2.0.0',
          isEcommerceSite: true,
        };
        
        chrome.runtime.sendMessage({
          action: 'PARTIAL_ANALYSIS_RESULT',
          payload: partialResult
        }).catch(err => console.warn('Failed to send partial result:', err));
      } catch (error) {
        console.warn(`Failed to send partial result for ${phase}:`, error);
      }
    };
    
    const aiAvailable = await AIService.checkAvailability();
    
    // ========================================================================
    // PHASE 1: HEURISTIC ANALYSIS (Immediate, parallel)
    // ========================================================================
    const [
      { security, domain, payment },
      { contact, policies }
    ] = await Promise.all([
      runDomainSecurityChecks(),
      runContentPolicyChecks()
    ]);
    
    await updateBackendJobProgress(30, 'heuristics', {
      heuristicsFinished: true,
      hasSecurityIssues: security.signals.length > 0,
      hasDomainIssues: domain.signals.length > 0,
    });

    const heuristicSignals = [
      ...security.signals,
      ...domain.signals,
      ...payment.signals,
      ...contact.signals,
      ...policies.signals,
    ];
    
    const heuristicRiskAnalysis = RiskCalculator.calculateScore(heuristicSignals, domain?.ageInDays || null, contact);
    
    await sendPartialResult({
      security,
      domain,
      contact,
      policies,
      payment,
      totalRiskScore: heuristicRiskAnalysis.totalScore,
      riskLevel: heuristicRiskAnalysis.riskLevel,
      allSignals: heuristicSignals,
      riskBreakdown: heuristicRiskAnalysis.breakdown,
      topConcerns: heuristicRiskAnalysis.topConcerns,
      aiEnabled: false,
      aiSignalsCount: 0,
      offlineMode: !aiAvailable,
    }, 'heuristic');
    
    let aiSignals: any[] = [];
    let aiAnalysisTime = 0;
    
    const shouldRunAI = payload?.includeAI !== false && 
                        aiAvailable && 
                        pageType !== 'policy' &&
                        pageType !== 'other';
    
    if (shouldRunAI) {
      sendProgressUpdate(window.location.href, 'ai_init', 'Initializing', 'started', 30);
      
      const phase2Start = performance.now();
      const aiStartTime = performance.now();

      try {
        sendProgressUpdate(window.location.href, 'ai_init', 'Downloading AI model...', 'processing', 32);
        const initialized = await AIService.initializeSession();
        
        const phase2Duration = performance.now() - phase2Start;

        if (!initialized) {
          console.warn('AI session initialization failed');
          aiAnalysisTime = performance.now() - aiStartTime;
          sendProgressUpdate(window.location.href, 'ai_init', 'Failed', 'completed', 35, phase2Duration);
        } else {
          sendProgressUpdate(window.location.href, 'ai_init', 'Ready', 'completed', 35, phase2Duration);
          
          sendProgressUpdate(window.location.href, 'ai_domain', 'Initializing', 'started', 40);
          const phase3aStart = performance.now();
          try {
            sendProgressUpdate(window.location.href, 'ai_domain', 'Analyzing for brand impersonation...', 'processing', 42);
            const domainSignal = await enhanceDomainAnalysisWithAI(window.location.hostname, {
              domain,
              contact,
              security,
              policies,
            });
            const phase3aDuration = performance.now() - phase3aStart;
            
            if (domainSignal) {
              sendProgressUpdate(
                window.location.href,
                'ai_domain',
                'Brand impersonation detected',
                'completed',
                50,
                phase3aDuration,
                { signalsFound: 1, topFinding: domainSignal.reason }
              );
              aiSignals.push(domainSignal);
            } else {
              sendProgressUpdate(
                window.location.href,
                'ai_domain',
                'No impersonation detected',
                'completed',
                50,
                phase3aDuration,
                { signalsFound: 0, topFinding: 'Domain appears legitimate' }
              );
            }
          } catch (domainAIError) {
            console.warn('Domain AI error:', domainAIError);
            sendProgressUpdate(window.location.href, 'ai_domain', 'Error', 'completed', 50);
          }
          
          sendProgressUpdate(window.location.href, 'ai_darkpattern', 'Initializing', 'started', 55);
          const phase3bStart = performance.now();
          
          const pageContent = {
            url: window.location.href,
            title: document.title,
            pageType: pageType,
            confidence: pageTypeResult.confidence,
            headings: Array.from(document.querySelectorAll('h1, h2, h3'))
              .map(el => el.textContent?.trim() || '')
              .filter(text => text.length > 0)
              .slice(0, 10),
            buttons: Array.from(document.querySelectorAll('button, a.btn, input[type="submit"]'))
              .map(el => el.textContent?.trim() || (el as HTMLInputElement).value || '')
              .filter(text => text.length > 0)
              .slice(0, 20),
            forms: Array.from(document.querySelectorAll('form'))
              .map(form => form.id || form.className || 'form')
              .filter(text => text.length > 0)
              .slice(0, 5),
          };
          
          try {
            sendProgressUpdate(window.location.href, 'ai_darkpattern', 'Scanning for deceptive practices...', 'processing', 60);
            const darkPatternSignals = await AIService.analyzeDarkPatterns(pageContent);
            const phase3bDuration = performance.now() - phase3bStart;
            
            sendProgressUpdate(
              window.location.href,
              'ai_darkpattern',
              `Found ${darkPatternSignals.length} dark patterns`,
              'completed',
              70,
              phase3bDuration,
              { signalsFound: darkPatternSignals.length, topFinding: darkPatternSignals[0]?.reason }
            );
            
            aiSignals.push(...darkPatternSignals);
          } catch (darkPatternsError) {
            console.warn('Dark patterns analysis error:', darkPatternsError);
            sendProgressUpdate(window.location.href, 'ai_darkpattern', 'Error', 'completed', 70);
          }
          
          sendProgressUpdate(window.location.href, 'ai_legitimacy', 'Checking', 'started', 75);
          const phase3cStart = performance.now();
          
          if (pageType === 'product' || pageType === 'checkout' || pageType === 'home') {
            sendProgressUpdate(window.location.href, 'ai_legitimacy', 'Analyzing brand presence...', 'processing', 80);
            const pageText = document.body.innerText || '';
            
            const socialMediaData = {
              facebook: contact.socialMediaProfiles.find(p => p.platform === 'facebook')?.url || null,
              twitter: contact.socialMediaProfiles.find(p => p.platform === 'twitter')?.url || null,
              instagram: contact.socialMediaProfiles.find(p => p.platform === 'instagram')?.url || null,
              linkedin: contact.socialMediaProfiles.find(p => p.platform === 'linkedin')?.url || null,
              youtube: contact.socialMediaProfiles.find(p => p.platform === 'youtube')?.url || null,
              count: contact.socialMediaProfiles.length,
            };
            
            try {
              const legitimacySignals = await AIService.analyzeLegitimacy({
                url: window.location.href,
                title: document.title,
                content: pageText.slice(0, 1500),
                hasHTTPS: security.isHttps,
                hasContactInfo: contact.hasContactPage || contact.hasEmail || contact.hasPhoneNumber,
                hasPolicies: policies.hasReturnRefundPolicy || policies.hasPrivacyPolicy,
                socialMedia: socialMediaData,
                domainAge: domain.ageInDays,
                domainAgeYears: domain.ageInDays ? Math.floor(domain.ageInDays / 365) : null,
                domainStatus: domain.status,
                domainRegistrar: domain.registrar,
              });
              const phase3cDuration = performance.now() - phase3cStart;
              
              sendProgressUpdate(
                window.location.href,
                'ai_legitimacy',
                'Completed',
                'completed',
                85,
                phase3cDuration,
                { signalsFound: legitimacySignals.length }
              );
              
              aiSignals.push(...legitimacySignals);
            } catch (legitimacyError) {
              console.warn('Legitimacy analysis error:', legitimacyError);
              sendProgressUpdate(window.location.href, 'ai_legitimacy', 'Error', 'completed', 85);
            }
          } else {
            sendProgressUpdate(
              window.location.href,
              'ai_legitimacy',
              'Skipped for this page type',
              'completed',
              85,
              0
            );
          }
          
          aiAnalysisTime = performance.now() - aiStartTime;
          sendProgressUpdate(window.location.href, 'consolidation', 'Consolidating signals...', 'started', 90);
          
          const phase4Start = performance.now();
          
          const allSignalsWithAI = [...heuristicSignals, ...aiSignals];
          
          sendProgressUpdate(window.location.href, 'consolidation', 'Calculating final score...', 'processing', 95);
          const aiRiskAnalysis = RiskCalculator.calculateScore(allSignalsWithAI, domain?.ageInDays || null, contact);
          
          const phase4Duration = performance.now() - phase4Start;
          
          sendProgressUpdate(
            window.location.href,
            'consolidation',
            'Complete',
            'completed',
            100,
            phase4Duration,
            { signalsFound: allSignalsWithAI.length, topFinding: `Risk: ${aiRiskAnalysis.riskLevel} (${aiRiskAnalysis.totalScore}/100)` }
          );
          
          const allPhases = progressCache.getPhaseResults(window.location.href) || [];
          progressCache.saveToHistory(
            window.location.href,
            allPhases,
            aiRiskAnalysis.totalScore,
            aiRiskAnalysis.riskLevel
          );
          
          await updateBackendJobProgress(65, 'ai_analysis', {
            aiFinished: true,
            aiSignalsFound: aiSignals.length,
          });
          
          await sendPartialResult({
            security,
            domain,
            contact,
            policies,
            payment,
            totalRiskScore: aiRiskAnalysis.totalScore,
            riskLevel: aiRiskAnalysis.riskLevel,
            allSignals: allSignalsWithAI,
            riskBreakdown: aiRiskAnalysis.breakdown,
            topConcerns: aiRiskAnalysis.topConcerns,
            aiEnabled: true,
            aiSignalsCount: aiSignals.length,
          }, 'ai');
        }
      } catch (aiError) {
        aiAnalysisTime = performance.now() - aiStartTime;
        console.error('AI analysis failed:', aiError);
        
        try {
          AIService.destroySession();
        } catch (cleanupError) {
          console.warn('Failed to cleanup AI session:', cleanupError);
        }
      }
    }
    
    const allSignals = [
      ...security.signals,
      ...domain.signals,
      ...payment.signals,
      ...contact.signals,
      ...policies.signals,
      ...aiSignals,
    ];
    
    const domainAgeInDays = domain?.ageInDays || null;
    const riskAnalysis = RiskCalculator.calculateScore(allSignals, domainAgeInDays, contact);
    const totalRiskScore = riskAnalysis.totalScore;
    const riskLevel = riskAnalysis.riskLevel;
    
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
      offlineMode: !aiAvailable,
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
    
    // Update extension icon based on risk level (TG-08)
    try {
      const badgeText = totalRiskScore > 0 ? String(totalRiskScore) : '';
      chrome.runtime.sendMessage({
        action: 'UPDATE_ICON',
        payload: { riskLevel, badgeText },
      }).catch(error => {
        console.warn('⚠️ Could not update icon:', error);
      });
      console.log('✅ Icon update requested');
    } catch (error) {
      console.warn('⚠️ Could not update icon:', error);
    }
    
    // Cache the result immediately (before returning to popup)
    // This ensures cache persists even if popup closes during analysis
    try {
      await StorageService.cacheAnalysis(window.location.href, pageType, analysis);
      await StorageService.clearAnalysisProgress(window.location.href);
      console.log(`💾 Analysis cached: ${pageType}`);
      
      // ============================================================================
      // STEP 5: Finalize backend job with complete analysis results
      // ============================================================================
      if (backendJobId) {
        try {
          console.log('📤 Finalizing backend job with complete results...');
          const finalizeResponse = await fetch(getApiUrl(`/api/jobs/${backendJobId}`), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'completed',
              progress: 100,
              phase: 'completed',
              // Ensure backend's current_stage is set so UI can render final stage
              stage: 'completed',
              result: analysis,
              sessionId,
              completedAt: new Date().toISOString(),
            })
          });
          
          if (finalizeResponse.ok) {
            console.log(`✅ Backend job finalized: ${backendJobId}`);
          } else {
            console.warn('⚠️ Failed to finalize backend job:', finalizeResponse.status);
          }
        } catch (finalizeError) {
          console.error('⚠️ Failed to finalize backend job:', finalizeError);
          // Don't fail analysis if backend finalization fails (graceful degradation)
        }
      }
      
      // Broadcast analysis completion to other tabs
      crossTabSync.broadcastAnalysisUpdate(window.location.href, analysis);
      
      // Send direct message to popup to notify completion immediately
      // This ensures popup gets notified even if storage events are missed
      try {
        chrome.runtime.sendMessage({
          action: 'ANALYSIS_COMPLETE',
          payload: analysis
        }).catch(err => console.warn('⚠️ Popup not open or message failed:', err));
        console.log('📢 Analysis completion message sent to popup');
      } catch (messageError) {
        console.warn('⚠️ Failed to send completion message:', messageError);
      }
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

async function handleUpdateIcon(payload: { riskLevel: string; badgeText: string }) {
  console.log('🎯 Content script received UPDATE_ICON:', payload);
  
  // Forward the message to the service worker
  try {
    await chrome.runtime.sendMessage({
      action: 'UPDATE_ICON',
      payload: payload
    });
    console.log('✅ UPDATE_ICON forwarded to service worker');
  } catch (error) {
    console.error('❌ Failed to forward UPDATE_ICON to service worker:', error);
  }
}

async function handleAnalyzePolicy() {
  console.log('📄 POLICY_ANALYSIS message received in content script');
  
  try {
    // Detect if current page is a policy page
    const policyDetection = PolicyDetectionService.detectPolicyPage();
    
    if (!policyDetection.isPolicyPage) {
      return {
        status: 'error',
        message: 'Current page is not detected as a policy page',
        url: window.location.href,
      };
    }

    console.log(`📄 Detected policy page: ${policyDetection.policyType} (confidence: ${policyDetection.confidence}%)`);

    // Generate AI-powered policy summary
    const policySummary = await PolicyDetectionService.generatePolicySummary(policyDetection);
    
    if (!policySummary) {
      return {
        status: 'error',
        message: 'Failed to generate policy summary',
        url: window.location.href,
      };
    }

    console.log('✅ Policy summary generated successfully');

    return {
      status: 'success',
      url: window.location.href,
      policyDetection,
      policySummary,
      timestamp: Date.now(),
    };

  } catch (error) {
    console.error('❌ Policy analysis failed:', error);
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error occurred',
      url: window.location.href,
    };
  }
}

// ============================================================================
// URL CHANGE MONITORING (for SPAs)
// ============================================================================

let lastUrl = window.location.href;
let urlCheckInterval: number | null = null;
let originalPushState: ((...args: any[]) => void) | null = null;
let originalReplaceState: ((...args: any[]) => void) | null = null;

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
  originalPushState = history.pushState;
  originalReplaceState = history.replaceState;
  
  history.pushState = function(...args) {
    if (originalPushState) {
      originalPushState.apply(history, args);
    }
    const currentUrl = window.location.href;
    
    if (currentUrl !== lastUrl) {
      console.log('🔀 pushState detected');
      handleUrlChange(lastUrl, currentUrl);
      lastUrl = currentUrl;
    }
  };
  
  history.replaceState = function(...args) {
    if (originalReplaceState) {
      originalReplaceState.apply(history, args);
    }
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
 * Stop URL change monitoring and cleanup all listeners
 */
function stopUrlChangeMonitoring() {
  // Clear the polling interval
  if (urlCheckInterval) {
    clearInterval(urlCheckInterval);
    urlCheckInterval = null;
  }
  
  // Restore original history methods
  if (originalPushState) {
    history.pushState = originalPushState;
    originalPushState = null;
  }
  if (originalReplaceState) {
    history.replaceState = originalReplaceState;
    originalReplaceState = null;
  }
  
  console.log('🧹 URL change monitoring stopped and cleaned up');
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
    
    // Detect if new page is a policy page and notify popup
    const policyDetection = PolicyDetectionService.detectPolicyPage();
    if (policyDetection.isPolicyPage) {
      console.log(`📄 Navigated to policy page: ${policyDetection.policyType}`);
      // Send message to runtime (popup will receive if open)
      chrome.runtime.sendMessage({
        action: 'POLICY_PAGE_DETECTED',
        payload: {
          isPolicyPage: true,
          policyType: policyDetection.policyType,
          policyConfidence: policyDetection.confidence,
          url: newUrl,
        }
      }).catch(() => {
        // Ignore errors if popup is not open
      });
    } else {
      // Notify that we're no longer on a policy page
      chrome.runtime.sendMessage({
        action: 'POLICY_PAGE_DETECTED',
        payload: {
          isPolicyPage: false,
          policyType: 'other',
          policyConfidence: 0,
          url: newUrl,
        }
      }).catch(() => {
        // Ignore errors if popup is not open
      });
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
    // Stop URL monitoring and cleanup listeners
    stopUrlChangeMonitoring();
    
    // Cleanup AI session
    const { AIService } = await import('../services/ai');
    AIService.destroySession();
    
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
  
  // Initialize cross-tab sync
  crossTabSync.initialize();
  
  // Set up message handlers
  const messageHandler = createMessageHandler({
    PING: handlePing,
    GET_PAGE_INFO: handleGetPageInfo,
    ANALYZE_PAGE: handleAnalyzePage,
    ANALYZE_POLICY: handleAnalyzePolicy,
    UPDATE_ICON: handleUpdateIcon,
  });
  
  chrome.runtime.onMessage.addListener(messageHandler);
  
  // Start URL change monitoring for SPAs
  startUrlChangeMonitoring();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeContentScript);
} else {
  initializeContentScript();
}
