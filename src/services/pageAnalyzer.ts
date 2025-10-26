/**
 * Page Analysis Service
 * 
 * Central orchestrator for all page analysis operations including:
 * - Page type detection
 * - Heuristic analysis coordination
 * - AI analysis integration
 * - Result aggregation and scoring
 * 
 * This service implements TG-06: Full Heuristic Engine Integration
 * with production-quality error handling, modularity, and performance optimization.
 */

import { runDomainSecurityChecks } from '../heuristics/domain';
import { runContentPolicyChecks } from '../heuristics/content';
import { AIService } from './ai';
import { RiskCalculator } from './riskCalculator';
import { FingerprintService } from './fingerprint';
import { StorageService } from './storage';
import type { AnalysisResult, PageTypeResult, RiskSignal, AnnotationElement } from '../types';

// Configuration constants
const ANALYSIS_CONFIG = {
  AI_MIN_CONFIDENCE_THRESHOLD: 15,
  FINGERPRINT_TEXT_LIMIT: 20000,
  ANALYSIS_TIMEOUT_MS: 45000,
  PARALLEL_BATCH_SIZE: 2,
} as const;

// Configuration constants for page type detection

/**
 * Comprehensive page analysis orchestrator
 * Implements TG-06 with production-quality architecture
 */
export class PageAnalyzer {
  private static instance: PageAnalyzer;
  private activeAnalyses = new Set<string>();

  private constructor() {}

  static getInstance(): PageAnalyzer {
    if (!PageAnalyzer.instance) {
      PageAnalyzer.instance = new PageAnalyzer();
    }
    return PageAnalyzer.instance;
  }

  /**
   * Main analysis entry point
   * Coordinates all analysis phases with proper error handling and performance optimization
   */
  async analyzePage(
    url: string,
    options: {
      includeAI?: boolean;
      includeWhois?: boolean;
      forceRefresh?: boolean;
      timeout?: number;
    } = {}
  ): Promise<AnalysisResult> {
    const startTime = performance.now();
    const analysisId = this.generateAnalysisId(url);
    
    console.log(`🔍 Starting comprehensive page analysis for: ${url}`);
    
    try {
      // Prevent duplicate concurrent analyses
      if (this.activeAnalyses.has(analysisId)) {
        throw new Error('Analysis already in progress for this page');
      }
      
      this.activeAnalyses.add(analysisId);

      // Phase 1: Page Type Detection
      const pageTypeResult = this.detectPageType();
      console.log(`📄 Page Type: ${pageTypeResult.type} (confidence: ${pageTypeResult.confidence}%, signals: ${pageTypeResult.signals.join(', ')})`);

      // Phase 2: Acquire distributed lock and mark progress
      const lockAcquired = await this.acquireAnalysisLock(url, pageTypeResult.type);
      if (!lockAcquired) {
        throw new Error('Analysis already in progress in another tab');
      }
      
      // Mark analysis as in progress so popup polling can detect it
      await StorageService.setAnalysisInProgress(url, pageTypeResult.type, options.includeAI !== false);

      // Phase 3: Parallel Heuristic Analysis
      const heuristicResults = await this.runHeuristicAnalysis(options.includeWhois);
      
      // Phase 4: AI Analysis (if enabled and applicable)
      const aiResults = await this.runAIAnalysis(pageTypeResult, heuristicResults, options.includeAI);
      
      // Phase 5: Fingerprint Analysis
      const fingerprintResults = await this.runFingerprintAnalysis(url);
      
      // Phase 6: Result Aggregation and Scoring
      const finalResult = await this.aggregateAndScoreResults({
        url,
        pageType: pageTypeResult,
        heuristics: heuristicResults,
        ai: aiResults,
        fingerprint: fingerprintResults,
        analysisTime: performance.now() - startTime,
      });

      // Phase 7: Cache and cleanup
      await this.cacheAndCleanup(url, pageTypeResult.type, finalResult);

      const totalTime = performance.now() - startTime;
      console.log('✅ Analysis complete:', {
        riskLevel: finalResult.riskLevel,
        totalRiskScore: finalResult.totalRiskScore,
        signalCount: finalResult.allSignals.length,
        aiSignals: aiResults.signals.length,
        pageType: pageTypeResult.type,
        totalTime: `${totalTime.toFixed(0)}ms`,
      });

      return finalResult;

    } catch (error) {
      console.error('❌ Analysis failed:', error);
      await this.handleAnalysisError(url, error);
      throw error;
    } finally {
      this.activeAnalyses.delete(analysisId);
    }
  }

  /**
   * Detect page type using comprehensive scoring system
   * Extracted from content script for better modularity
   */
  private detectPageType(): PageTypeResult {
    const path = window.location.pathname.toLowerCase();
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
    
    // Checkout page detection (highest priority)
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
    
    // Cart page detection
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
    
    // Category/listing page detection (strong signal for e-commerce)
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
    
    // URL patterns for category pages
    if (path.includes('/category') || path.includes('/collection') || 
        path.includes('/shop') || path.includes('/search') ||
        path.includes('/b/') || path.includes('/b?') ||
        path.includes('/s?') || path.includes('/s/') ||
        path.includes('/sch/') ||
        /\/(men|women|kids|boys|girls|unisex)[-\/]/.test(path)) {
      scores.category += 35;
      signals.push('category-url');
    }
    
    // Filter/sort controls
    const filterControls = document.querySelectorAll(
      '.filter, [class*="filter"], .sort, [class*="sort"], ' +
      '[id*="filters"], [class*="refinement"], [id*="departments"], ' +
      'select[name*="sort"], [aria-label*="filter"], [aria-label*="sort"]'
    ).length;
    if (filterControls > 0) {
      scores.category += 25;
      signals.push('filter-controls');
    }
    
    // Pagination
    if (document.querySelector('.pagination, [class*="pagination"], [aria-label*="pagination"]')) {
      scores.category += 20;
      signals.push('pagination');
    }
    
    // Product page detection
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
    
    // Check for "ADD TO BAG/CART/BASKET" text
    const allButtons = Array.from(document.querySelectorAll('button'));
    const hasAddButton = allButtons.some(btn => 
      /add\s+to\s+(cart|bag|basket)/i.test(btn.textContent || '')
    );
    if (hasAddButton && productCards < 3) {
      scores.product += 30;
      signals.push('add-text-button');
    }
    
    // Product-specific indicators
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
    
    // URL patterns for single product
    if (path.includes('/product') || path.includes('/item') || path.includes('/p/') || 
        path.includes('/dp/') || path.includes('/gp/product') || path.includes('/buy')) {
      scores.product += 35;
      signals.push('product-url');
    }
    
    // Product ID in URL
    if (/\/\d{5,}/.test(path) && productCards < 3) {
      scores.product += 40;
      signals.push('product-id-in-url');
    }
    
    // Product containers
    if (document.querySelector('.product-detail, #product, [class*="product-info"], [class*="pdp-"], [id*="pdp"]')) {
      scores.product += 20;
      signals.push('product-container');
    }
    
    // Size/color selectors
    const hasSizeSelector = document.querySelector(
      '[class*="size-"], [class*="sizebutton"], select[name*="size"], ' +
      'input[name*="size"], [data-size]'
    );
    if (hasSizeSelector && productCards < 3) {
      scores.product += 25;
      signals.push('size-selector');
    }
    
    // Single product title with price
    const h1Elements = document.querySelectorAll('h1');
    if (h1Elements.length === 1 && priceElements > 0 && priceElements < 3) {
      scores.product += 20;
      signals.push('single-title-with-price');
    }
    
    // Policy page detection
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
    
    // Home page detection
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
    
    // Determine best match
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

  /**
   * Run all heuristic checks in parallel for optimal performance
   */
  private async runHeuristicAnalysis(includeWhois: boolean = false) {
    console.log('🔍 Running parallel heuristic analysis...');
    
    try {
      const [domainSecurityResults, contentPolicyResults] = await Promise.all([
        runDomainSecurityChecks(includeWhois),
        runContentPolicyChecks()
      ]);
      
      console.log('✅ Heuristic analysis complete:', {
        securitySignals: domainSecurityResults.security.signals.length,
        domainSignals: domainSecurityResults.domain.signals.length,
        paymentSignals: domainSecurityResults.payment.signals.length,
        contactSignals: contentPolicyResults.contact.signals.length,
        policySignals: contentPolicyResults.policies.signals.length,
        socialProofAudit: contentPolicyResults.contact.socialProofAudit ? {
          total: contentPolicyResults.contact.socialProofAudit.totalProfiles,
          valid: contentPolicyResults.contact.socialProofAudit.validProfiles,
          rate: `${contentPolicyResults.contact.socialProofAudit.validationRate}%`,
        } : null,
      });
      
      return {
        security: domainSecurityResults.security,
        domain: domainSecurityResults.domain,
        payment: domainSecurityResults.payment,
        contact: contentPolicyResults.contact,
        policies: contentPolicyResults.policies,
      };
    } catch (error) {
      console.error('❌ Heuristic analysis failed:', error);
      throw new Error(`Heuristic analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Run AI analysis with proper error handling and fallbacks
   */
  private async runAIAnalysis(
    pageType: PageTypeResult, 
    heuristics: any, 
    includeAI?: boolean
  ) {
    const aiResults = {
      signals: [] as any[],
      analysisTime: 0,
      error: null as string | null,
    };

    if (!includeAI) {
      console.log('⏭️ AI analysis disabled');
      return aiResults;
    }

    try {
      const aiStatus = await AIService.checkAvailability();
      const aiAvailable = aiStatus;
      console.log('🤖 AI Status:', aiStatus);
      
      const shouldRunAI = aiAvailable && 
                         pageType.confidence > ANALYSIS_CONFIG.AI_MIN_CONFIDENCE_THRESHOLD &&
                         pageType.type !== 'policy' &&
                         pageType.type !== 'other';
      
      if (!shouldRunAI) {
        const reason = !aiAvailable ? 'AI not available' : 
                       pageType.confidence <= ANALYSIS_CONFIG.AI_MIN_CONFIDENCE_THRESHOLD ? 'low page type confidence' :
                       pageType.type === 'policy' ? 'policy page' :
                       pageType.type === 'other' ? 'unknown page type' :
                       'AI disabled';
        console.log(`⏭️ Skipping AI analysis: ${reason}`);
        return aiResults;
      }

      console.log(`🤖 Running AI-powered analysis for ${pageType.type} page...`);
      const aiStartTime = performance.now();
      
      // Initialize AI session
      const initialized = await AIService.initializeSession();
      if (!initialized) {
        throw new Error('AI session failed to initialize');
      }

      // Prepare page content for AI analysis
      const pageContent = this.preparePageContentForAI(pageType, heuristics);
      
      // Run AI analyses in parallel
      const analyses: Promise<any[]>[] = [];
      analyses.push(AIService.analyzeDarkPatterns(pageContent));
      
      // Context-aware legitimacy analysis
      if (['product', 'checkout', 'home'].includes(pageType.type)) {
        const legitimacyContext = this.prepareLegitimacyContext(heuristics);
        analyses.push(AIService.analyzeLegitimacy(legitimacyContext));
      }
      
      const results = await Promise.all(analyses);
      aiResults.signals = results.flat();
      aiResults.analysisTime = performance.now() - aiStartTime;
      
      console.log(`✅ AI found ${aiResults.signals.length} signals in ${aiResults.analysisTime.toFixed(0)}ms`);
      
    } catch (error) {
      aiResults.error = error instanceof Error ? error.message : 'Unknown AI error';
      console.error(`⚠️ AI analysis failed:`, error);
    }
    
    return aiResults;
  }

  /**
   * Run fingerprint-based change detection
   */
  private async runFingerprintAnalysis(url: string) {
    const fingerprintResults = {
      signals: [] as any[],
      error: null as string | null,
    };

    try {
      const domainName = window.location.hostname.replace(/^www\./, '');
      const pageText = (document.body?.innerText || '').slice(0, ANALYSIS_CONFIG.FINGERPRINT_TEXT_LIMIT);
      
      fingerprintResults.signals = await FingerprintService.checkDomainChange(
        domainName, 
        pageText, 
        url
      );
      
      console.log(`🔍 Fingerprint analysis found ${fingerprintResults.signals.length} signals`);
      
    } catch (error) {
      fingerprintResults.error = error instanceof Error ? error.message : 'Unknown fingerprint error';
      console.warn('⚠️ Fingerprint analysis failed:', error);
    }
    
    return fingerprintResults;
  }

  /**
   * Aggregate all results and calculate final risk score
   */
  private async aggregateAndScoreResults(data: {
    url: string;
    pageType: PageTypeResult;
    heuristics: any;
    ai: any;
    fingerprint: any;
    analysisTime: number;
  }): Promise<AnalysisResult> {
    // Collect all signals
    const allSignals = [
      ...data.heuristics.security.signals,
      ...data.heuristics.domain.signals,
      ...data.heuristics.payment.signals,
      ...data.heuristics.contact.signals,
      ...data.heuristics.policies.signals,
      ...data.ai.signals,
      ...data.fingerprint.signals,
    ];
    
    // Calculate risk score using smart calculator
    const riskAnalysis = RiskCalculator.calculateScore(allSignals);
    
    // Extract elements from AI dark pattern signals for highlighting using pattern matching
    const elements = this.convertAISignalsToElements(allSignals);
    
    // Build comprehensive analysis result
    const result: AnalysisResult = {
      url: data.url,
      timestamp: Date.now(),
      pageType: data.pageType.type,
      pageTypeConfidence: data.pageType.confidence,
      security: data.heuristics.security,
      domain: data.heuristics.domain,
      payment: data.heuristics.payment,
      contact: data.heuristics.contact,
      policies: data.heuristics.policies,
      totalRiskScore: riskAnalysis.totalScore,
      riskLevel: riskAnalysis.riskLevel,
      allSignals,
      riskBreakdown: riskAnalysis.breakdown,
      topConcerns: riskAnalysis.topConcerns,
      analysisVersion: '2.0.0',
      isEcommerceSite: true,
      aiEnabled: !data.ai.error,
      aiSignalsCount: data.ai.signals.length,
      elements, // Add elements for highlighting
    };
    
    return result;
  }

  /**
   * Prepare page content for AI analysis with enhanced context
   */
  private preparePageContentForAI(pageType: PageTypeResult, _heuristics: any) {
    // Extract text content as before
    const textContent = {
      headings: Array.from(document.querySelectorAll('h1, h2, h3, h4'))
        .map(el => el.textContent?.trim() || '')
        .filter(text => text.length > 0 && text.length < 200)
        .slice(0, 15),
      buttons: Array.from(document.querySelectorAll('button, a.btn, input[type="submit"], [role="button"]'))
        .map(el => {
          const text = el.textContent?.trim() || (el as HTMLInputElement).value || '';
          const ariaLabel = el.getAttribute('aria-label')?.trim() || '';
          return text || ariaLabel;
        })
        .filter(text => text.length > 0 && text.length < 100)
        .slice(0, 25),
      forms: Array.from(document.querySelectorAll('form'))
        .map((form, index) => {
          const id = form.id || form.className || `form-${index}`;
          const inputs = Array.from(form.querySelectorAll('input, select, textarea')).length;
          return `${id} (${inputs} fields)`;
        })
        .filter(text => text.length > 0)
        .slice(0, 8),
    };

    // NEW: Extract HTML snippets with actual selectors for AI analysis
    const htmlSnippets = this.extractRelevantHtmlSnippets(pageType);

    return {
      url: window.location.href,
      title: document.title,
      pageType: pageType.type,
      confidence: pageType.confidence,
      ...textContent,
      htmlSnippets, // Add HTML snippets for accurate selector generation
    };
  }

  /**
   * Extract relevant HTML snippets with actual class names and IDs
   * This gives AI real page structure to generate accurate CSS selectors
   */
  private extractRelevantHtmlSnippets(pageType: PageTypeResult) {
    const snippets: { [key: string]: string[] } = {};

    // Timer and countdown elements (for false urgency)
    snippets.timerElements = Array.from(document.querySelectorAll('[class*="timer"], [class*="countdown"], [id*="timer"], [id*="countdown"]'))
      .slice(0, 5)
      .map(el => this.getElementSnippet(el));

    // Scarcity and urgency elements
    snippets.scarcityElements = Array.from(document.querySelectorAll('[class*="scarcity"], [class*="limited"], [class*="only"], [class*="left"], [class*="remaining"]'))
      .slice(0, 5)
      .map(el => this.getElementSnippet(el));

    // Shipping and cost elements
    snippets.shippingElements = Array.from(document.querySelectorAll('[class*="shipping"], [class*="delivery"], [class*="cost"], [class*="fee"]'))
      .slice(0, 5)
      .map(el => this.getElementSnippet(el));

    // Popup and modal elements
    snippets.popupElements = Array.from(document.querySelectorAll('[class*="popup"], [class*="modal"], [class*="overlay"], [id*="popup"], [id*="modal"]'))
      .slice(0, 5)
      .map(el => this.getElementSnippet(el));

    // Subscription and continuity elements
    snippets.subscriptionElements = Array.from(document.querySelectorAll('[class*="subscribe"], [class*="newsletter"], [class*="continu"], input[type="checkbox"][class*="subscribe"]'))
      .slice(0, 5)
      .map(el => this.getElementSnippet(el));

    // Price and discount elements
    snippets.priceElements = Array.from(document.querySelectorAll('[class*="price"], [class*="discount"], [class*="sale"], [class*="offer"]'))
      .slice(0, 5)
      .map(el => this.getElementSnippet(el));

    // Review and rating elements
    snippets.reviewElements = Array.from(document.querySelectorAll('[class*="review"], [class*="rating"], [class*="star"], [data-rating]'))
      .slice(0, 5)
      .map(el => this.getElementSnippet(el));

    // Page-specific elements based on page type
    if (pageType.type === 'checkout') {
      snippets.checkoutElements = Array.from(document.querySelectorAll('[class*="checkout"], [class*="payment"], [class*="billing"], [class*="shipping"]'))
        .slice(0, 8)
        .map(el => this.getElementSnippet(el));
    } else if (pageType.type === 'product') {
      snippets.productElements = Array.from(document.querySelectorAll('[class*="product"], [data-product], [class*="item"], [class*="variant"]'))
        .slice(0, 8)
        .map(el => this.getElementSnippet(el));
    }

    return snippets;
  }

  /**
   * Get a clean HTML snippet for an element with its selectors
   */
  private getElementSnippet(element: Element): string {
    const tagName = element.tagName.toLowerCase();
    const id = element.id ? ` id="${element.id}"` : '';
    const classes = element.className ? ` class="${element.className}"` : '';
    const text = element.textContent?.trim().slice(0, 100) || '';

    // Get a few key attributes that might be relevant
    const relevantAttrs: string[] = [];
    for (const attr of element.attributes) {
      if (['data-', 'aria-'].some(prefix => attr.name.startsWith(prefix)) ||
          ['role', 'type', 'name', 'value', 'placeholder'].includes(attr.name)) {
        relevantAttrs.push(`${attr.name}="${attr.value}"`);
      }
    }

    const attrs = relevantAttrs.length > 0 ? ' ' + relevantAttrs.join(' ') : '';

    return `<${tagName}${id}${classes}${attrs}>${text}</${tagName}>`;
  }

  /**
   * Prepare legitimacy analysis context with comprehensive data
   */
  private prepareLegitimacyContext(heuristics: any) {
    const pageText = document.body.innerText || '';
    
    // Extract social media data
    const socialMediaData = {
      facebook: heuristics.contact.socialMediaProfiles.find((p: any) => p.platform === 'facebook')?.url || null,
      twitter: heuristics.contact.socialMediaProfiles.find((p: any) => p.platform === 'twitter')?.url || null,
      instagram: heuristics.contact.socialMediaProfiles.find((p: any) => p.platform === 'instagram')?.url || null,
      linkedin: heuristics.contact.socialMediaProfiles.find((p: any) => p.platform === 'linkedin')?.url || null,
      youtube: heuristics.contact.socialMediaProfiles.find((p: any) => p.platform === 'youtube')?.url || null,
      count: heuristics.contact.socialMediaProfiles.length,
    };
    
    return {
      url: window.location.href,
      title: document.title,
      content: pageText.slice(0, 1500),
      hasHTTPS: heuristics.security.isHttps,
      hasContactInfo: heuristics.contact.hasContactPage || heuristics.contact.hasEmail || heuristics.contact.hasPhoneNumber,
      hasPolicies: heuristics.policies.hasReturnPolicy || heuristics.policies.hasPrivacyPolicy,
      socialMedia: socialMediaData,
      domainAge: heuristics.domain.ageInDays,
      domainAgeYears: heuristics.domain.ageInDays ? Math.floor(heuristics.domain.ageInDays / 365) : null,
      domainStatus: heuristics.domain.status,
      domainRegistrar: heuristics.domain.registrar,
    };
  }

  /**
   * Cache analysis result and perform cleanup
   */
  private async cacheAndCleanup(url: string, pageType: string, result: AnalysisResult) {
    try {
      await StorageService.cacheAnalysis(url, pageType, result);
      await StorageService.clearAnalysisProgress(url);
      console.log(`💾 Analysis cached: ${pageType}`);
    } catch (error) {
      console.warn('⚠️ Failed to cache analysis:', error);
    } finally {
      await StorageService.releaseAnalysisLock(url, pageType);
    }
  }

  /**
   * Handle analysis errors with proper cleanup
   */
  private async handleAnalysisError(url: string, _error: any) {
    try {
      const pageTypeResult = this.detectPageType();
      await StorageService.clearAnalysisProgress(url);
      await StorageService.releaseAnalysisLock(url, pageTypeResult.type);
    } catch (cleanupError) {
      console.error('⚠️ Error during cleanup:', cleanupError);
    }
  }

  /**
   * Acquire distributed analysis lock
   */
  private async acquireAnalysisLock(url: string, pageType: string): Promise<boolean> {
    try {
      return await StorageService.acquireAnalysisLock(url, pageType);
    } catch (error) {
      console.error('❌ Failed to acquire analysis lock:', error);
      return false;
    }
  }

  /**
   * Generate unique analysis ID for deduplication
   */
  private generateAnalysisId(url: string): string {
    return `analysis_${url}_${Date.now()}`;
  }

  /**
   * Convert AI dark pattern signals to AnnotationElement objects using pattern matching
   */
  private convertAISignalsToElements(signals: RiskSignal[]): AnnotationElement[] {
    const aiDarkPatternSignals = signals.filter(
      signal => signal.category === 'dark-pattern' && signal.source === 'ai' && signal.pattern
    );

    const elements: AnnotationElement[] = [];

    aiDarkPatternSignals.forEach(signal => {
      // Find actual elements on the page based on pattern type and metadata
      const matchingElements = this.findElementsForPattern(signal);

      matchingElements.forEach((element, index) => {
        // Generate a unique selector for this element
        const selector = this.generateSelectorForElement(element);
        if (selector) {
          elements.push({
            pattern: signal.pattern!,
            reason: signal.reason + (matchingElements.length > 1 ? ` (element ${index + 1})` : ''),
            severity: signal.severity as 'low' | 'medium' | 'high' | 'critical',
            textSnippet: signal.textSnippet,
            elementType: signal.elementType,
            context: signal.context,
            selector: selector, // Add the generated selector
          });
        }
      });
    });

    return elements;
  }

  /**
   * Find DOM elements that match a specific dark pattern
   */
  private findElementsForPattern(signal: RiskSignal): Element[] {
    const { pattern, textSnippet, elementType } = signal;

    switch (pattern) {
      case 'false_urgency':
        return this.findFalseUrgencyElements(textSnippet, elementType);

      case 'forced_continuity':
        return this.findForcedContinuityElements(textSnippet, elementType);

      case 'hidden_costs':
        return this.findHiddenCostsElements(textSnippet, elementType);

      case 'trick_questions':
        return this.findTrickQuestionsElements(textSnippet, elementType);

      case 'confirmshaming':
        return this.findConfirmshamingElements(textSnippet, elementType);

      case 'bait_switch':
        return this.findBaitSwitchElements(textSnippet, elementType);

      case 'social_proof_manipulation':
        return this.findSocialProofElements(textSnippet, elementType);

      default:
        return [];
    }
  }

  /**
   * Find elements related to false urgency patterns
   */
  private findFalseUrgencyElements(_textSnippet?: string, _elementType?: string): Element[] {
    const elements: Element[] = [];

    // Look for countdown timers - these are more reliable indicators
    const timerSelectors = [
      '[class*="timer"]', '[class*="countdown"]', '[id*="timer"]', '[id*="countdown"]',
      '[class*="clock"]', '[class*="time"]', 'time', '[data-countdown]',
      '[class*="urgent"]', '[class*="limited-time"]'
    ];

    timerSelectors.forEach(selector => {
      try {
        const found = document.querySelectorAll(selector);
        if (found.length > 0) {
          console.log(`🕐 Found ${found.length} timer elements with selector: ${selector}`);
          elements.push(...Array.from(found));
        }
      } catch (e) {
        // Invalid selector, skip
      }
    });

    // Look for scarcity text patterns, but be more specific
    // Include more UI element types that might contain dark patterns
    const uiSelectors = [
      'button', 'a', '.btn', '[role="button"]', '.button',
      '.badge', '.tag', '.label', '.notification',
      '.alert', '.warning', '.urgent', '.scarcity',
      '[class*="stock"]', '[class*="quantity"]', '[class*="remaining"]',
      'span', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      '[class*="price"]', '[class*="offer"]', '[class*="deal"]',
      '[class*="timer"]', '[class*="countdown"]', '[class*="time"]',
      '[class*="limited"]', '[class*="urgent"]', '[class*="flash"]'
    ];

    uiSelectors.forEach(selector => {
      try {
        const uiElements = document.querySelectorAll(selector);
        uiElements.forEach(element => {
          const text = element.textContent?.toLowerCase() || '';
          // More permissive patterns that are likely dark patterns
          const scarcityPatterns = [
            /\bonly\s+\d+/i,  // "only 3", "Only 5"
            /\bjust\s+\d+/i,  // "just 2", "Just 1"
            /\d+\s+left/i,    // "3 left", "5 left"
            /\d+\s+remaining/i, // "2 remaining"
            /\blimited/i,     // "limited"
            /\bselling\s+fast/i, // "selling fast"
            /\balmost\s+sold/i, // "almost sold"
            /\bhurry/i,       // "hurry"
            /\bonly\s+few/i,  // "only few"
            /\blast\s+chance/i, // "last chance"
            /\bending\s+soon/i, // "ending soon"
            /\b\d+\s+left/i,  // "3 left"
            /\bstock/i,       // "stock"
            /\bavailable/i    // "available"
          ];

          if (scarcityPatterns.some(pattern => pattern.test(text))) {
            console.log(`🚨 Found scarcity element: "${text}" in ${selector}`);
            elements.push(element);
          }
        });
      } catch (e) {
        // Invalid selector, skip
      }
    });

    console.log(`⏰ False urgency elements found: ${[...new Set(elements)].length}`);
    return [...new Set(elements)].slice(0, 5); // Limit to 5 elements per pattern
  }

  /**
   * Find elements related to forced continuity patterns
   */
  private findForcedContinuityElements(_textSnippet?: string, _elementType?: string): Element[] {
    const elements: Element[] = [];

    // Look for subscription/auto-renewal related elements
    const subscriptionSelectors = [
      '[class*="subscribe"]', '[class*="renewal"]', '[class*="continu"]', '[class*="auto"]',
      'input[type="checkbox"][class*="subscribe"]', '[class*="membership"]'
    ];

    subscriptionSelectors.forEach(selector => {
      try {
        const found = document.querySelectorAll(selector);
        elements.push(...Array.from(found));
      } catch (e) {
        // Invalid selector, skip
      }
    });

    return [...new Set(elements)].slice(0, 3); // Limit to 3 elements per pattern
  }

  /**
   * Find elements related to hidden costs patterns
   */
  private findHiddenCostsElements(_textSnippet?: string, _elementType?: string): Element[] {
    const elements: Element[] = [];

    // Look for price/fee related elements
    const costSelectors = [
      '[class*="fee"]', '[class*="cost"]', '[class*="price"]', '[class*="charge"]',
      '[class*="total"]', '[class*="tax"]', '[class*="shipping"]'
    ];

    costSelectors.forEach(selector => {
      try {
        const found = document.querySelectorAll(selector);
        elements.push(...Array.from(found));
      } catch (e) {
        // Invalid selector, skip
      }
    });

    return [...new Set(elements)].slice(0, 3); // Limit to 3 elements per pattern
  }

  /**
   * Find elements related to trick questions patterns
   */
  private findTrickQuestionsElements(_textSnippet?: string, _elementType?: string): Element[] {
    const elements: Element[] = [];

    // Look for form inputs, especially checkboxes and radio buttons
    const formSelectors = [
      'input[type="checkbox"]', 'input[type="radio"]', 'select',
      '[class*="opt"]', '[class*="choice"]', '[class*="question"]'
    ];

    formSelectors.forEach(selector => {
      try {
        const found = document.querySelectorAll(selector);
        elements.push(...Array.from(found));
      } catch (e) {
        // Invalid selector, skip
      }
    });

    return [...new Set(elements)].slice(0, 3); // Limit to 3 elements per pattern
  }

  /**
   * Find elements related to confirmshaming patterns
   */
  private findConfirmshamingElements(_textSnippet?: string, _elementType?: string): Element[] {
    const elements: Element[] = [];

    // Look for buttons with negative/shaming text
    const buttonSelectors = ['button', '[role="button"]', 'input[type="submit"]', 'input[type="button"]'];

    buttonSelectors.forEach(selector => {
      try {
        const buttons = document.querySelectorAll(selector);
        buttons.forEach(button => {
          const text = button.textContent?.toLowerCase() || '';
          // Look for shaming language
          if (text.includes('no thanks') || text.includes('skip') || text.includes('decline') ||
              text.includes('don\'t want') || text.includes('refuse')) {
            elements.push(button);
          }
        });
      } catch (e) {
        // Invalid selector, skip
      }
    });

    return [...new Set(elements)].slice(0, 3); // Limit to 3 elements per pattern
  }

  /**
   * Find elements related to bait and switch patterns
   */
  private findBaitSwitchElements(_textSnippet?: string, _elementType?: string): Element[] {
    const elements: Element[] = [];

    // Look for price comparison elements
    const priceSelectors = [
      '[class*="price"]', '[class*="discount"]', '[class*="sale"]', '[class*="offer"]',
      '[class*="original"]', '[class*="strikethrough"]'
    ];

    priceSelectors.forEach(selector => {
      try {
        const found = document.querySelectorAll(selector);
        elements.push(...Array.from(found));
      } catch (e) {
        // Invalid selector, skip
      }
    });

    return [...new Set(elements)].slice(0, 3); // Limit to 3 elements per pattern
  }

  /**
   * Find elements related to social proof manipulation patterns
   */
  private findSocialProofElements(_textSnippet?: string, _elementType?: string): Element[] {
    const elements: Element[] = [];

    // Look for review/rating elements
    const reviewSelectors = [
      '[class*="review"]', '[class*="rating"]', '[class*="star"]', '[data-rating]',
      '[class*="testimonial"]', '[class*="feedback"]'
    ];

    reviewSelectors.forEach(selector => {
      try {
        const found = document.querySelectorAll(selector);
        elements.push(...Array.from(found));
      } catch (e) {
        // Invalid selector, skip
      }
    });

    return [...new Set(elements)].slice(0, 3); // Limit to 3 elements per pattern
  }

  /**
   * Get cached analysis result if available
   */
  async getCachedAnalysis(url: string, pageType?: string): Promise<AnalysisResult | null> {
    try {
      let resolvedPageType = pageType;
      if (!resolvedPageType) {
        const pageTypeResult = this.detectPageType();
        resolvedPageType = pageTypeResult.type;
      }
      return await StorageService.getCachedAnalysis(url, resolvedPageType);
    } catch (error) {
      console.error('❌ Failed to get cached analysis:', error);
      return null;
    }
  }

  /**
   * Check if analysis is currently in progress
   */
  async isAnalysisInProgress(url: string, pageType?: string): Promise<boolean> {
    try {
      let resolvedPageType = pageType;
      if (!resolvedPageType) {
        const pageTypeResult = this.detectPageType();
        resolvedPageType = pageTypeResult.type;
      }
      return await StorageService.isAnalysisInProgress(url, resolvedPageType);
    } catch (error) {
      console.error('❌ Failed to check analysis progress:', error);
      return false;
    }
  }

  /**
   * Generate a unique CSS selector for a DOM element
   */
  private generateSelectorForElement(element: Element): string | null {
    try {
      // Try to generate a unique selector using existing page structure
      if (element.id) {
        // Check if ID is unique
        const idElements = document.querySelectorAll(`#${element.id}`);
        if (idElements.length === 1) {
          return `#${element.id}`;
        }
      }

      // Try class-based selector with more specificity
      if (element.className && typeof element.className === 'string') {
        const classes = element.className.trim().split(/\s+/).filter(c => c && !c.startsWith('shop-sentinel'));
        if (classes.length > 0) {
          // Try with tag name for more specificity
          const tagName = element.tagName.toLowerCase();
          const classSelector = `${tagName}.${classes.join('.')}`;

          const matches = document.querySelectorAll(classSelector);
          if (matches.length === 1) {
            return classSelector;
          }

          // Try just classes
          const justClasses = `.${classes.join('.')}`;
          const classMatches = document.querySelectorAll(justClasses);
          if (classMatches.length === 1) {
            return justClasses;
          }
        }
      }

      // Try tag name + text content (for buttons/links)
      const tagName = element.tagName.toLowerCase();
      const text = element.textContent?.trim();
      if (text && text.length > 0 && text.length < 50) {
        // Check if text is unique for this tag
        const elementsWithSameText = Array.from(document.querySelectorAll(tagName))
          .filter(el => el.textContent?.trim() === text);

        if (elementsWithSameText.length === 1) {
          // Create a more specific selector
          const path = this.getElementPath(element);
          if (path) {
            return path;
          }
        }
      }

      // Try nth-child with parent context
      const path = this.getElementPath(element);
      if (path) {
        return path;
      }

      // Last resort: add a stable data attribute that won't conflict
      const uniqueId = `shop-sentinel-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      element.setAttribute('data-shop-sentinel-target', uniqueId);
      return `[data-shop-sentinel-target="${uniqueId}"]`;

    } catch (error) {
      console.warn('Failed to generate selector for element:', error);
      return null;
    }
  }

  /**
   * Get a CSS path to an element using nth-child selectors
   */
  private getElementPath(element: Element): string | null {
    try {
      const parts: string[] = [];
      let current: Element | null = element;

      while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
        let selector = current.tagName.toLowerCase();

        if (current.id) {
          selector = `#${current.id}`;
          parts.unshift(selector);
          break; // ID is unique, no need to go further
        }

        if (current.className && typeof current.className === 'string') {
          const classes = current.className.trim().split(/\s+/).filter(c => c && !c.startsWith('shop-sentinel'));
          if (classes.length > 0) {
            selector += `.${classes[0]}`; // Just use first class
          }
        }

        // Add nth-child if there are siblings
        const siblings = Array.from(current.parentElement?.children || []);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-child(${index})`;
        }

        parts.unshift(selector);
        current = current.parentElement;

        // Stop if we hit body
        if (current?.tagName.toLowerCase() === 'body') {
          break;
        }
      }

      return parts.join(' > ');
    } catch (error) {
      return null;
    }
  }
}

// Export singleton instance
export const pageAnalyzer = PageAnalyzer.getInstance();
