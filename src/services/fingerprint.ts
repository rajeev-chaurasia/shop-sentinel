// FingerprintService: Advanced site change detection using multi-layered fingerprinting
// Uses semantic similarity, domain context, and intelligent thresholds to detect genuine site purpose changes
// while avoiding false positives from normal e-commerce navigation

import { StorageService } from './storage';
import type { RiskSignal } from '../types/analysis';

// Minimal typings for Chrome AI APIs
interface SummarizerSession {
  summarize: (text: string, options?: any) => Promise<string>;
  destroy?: () => void;
}

interface SummarizerModel {
  availability: () => Promise<unknown>;
  create: (options?: any) => Promise<SummarizerSession>;
}

interface DomainFingerprint {
  domain: string;
  brand: string;
  category: string;
  semanticSummary: string;
  pageTypes: Set<string>;
  lastUpdated: number;
  visitCount: number;
  confidence: number;
}

interface PageContext {
  pageType: 'home' | 'category' | 'product' | 'checkout' | 'search' | 'other';
  confidence: number;
  url: string;
  title: string;
}

declare global {
  var Summarizer: SummarizerModel | undefined;
}

export class FingerprintService {
  private static readonly DOMAIN_CONTEXT_KEY = 'domain_context_';
  
  private static readonly MIN_TEXT_LENGTH = 1000;
  private static readonly MAX_BRAND_LENGTH = 50;

  // Trusted domains that are less likely to be compromised
  private static readonly TRUSTED_DOMAINS = new Set([
    'amazon.com', 'walmart.com', 'target.com', 'bestbuy.com', 'home-depot.com',
    'myntra.com', 'flipkart.com', 'ajio.com', 'nykaa.com', 'firstcry.com',
    'paytm.com', 'phonepe.com', 'gpay.com', 'paypal.com', 'stripe.com',
    'google.com', 'microsoft.com', 'apple.com', 'facebook.com', 'instagram.com',
    'twitter.com', 'linkedin.com', 'github.com', 'stackoverflow.com'
  ]);

  // Known brand variations to reduce false positives
  private static readonly BRAND_VARIATIONS = new Map([
    ['amazon', ['amazon prime', 'amazon web services', 'aws']],
    ['google', ['google drive', 'google docs', 'gmail', 'youtube']],
    ['microsoft', ['office 365', 'azure', 'bing']],
    ['apple', ['icloud', 'app store', 'itunes']]
  ]);

  /**
   * Main entry point for domain change detection
   * Returns risk signals only for genuine site purpose changes
   */
  static async checkDomainChange(domain: string, pageText: string, url: string = ''): Promise<RiskSignal[]> {
    try {
      console.log('🔍 FingerprintService: Analyzing domain change for', domain);
      
      // Step 1: Analyze page context
      const pageContext = this.analyzePageContext(pageText, url);
      console.log('📄 Page context:', pageContext);

      // Step 2: Extract stable domain-level fingerprint
      const currentFingerprint = await this.createDomainFingerprint(pageText, pageContext);
      if (!currentFingerprint) {
        console.log('⚠️ FingerprintService: Insufficient content for fingerprinting');
        return [];
      }

      // Step 3: Load existing domain context
      const existingContext = await this.loadDomainContext(domain);
      
      if (!existingContext) {
        // First visit - store context and return
        await this.saveDomainContext(domain, currentFingerprint);
        console.log('🆕 FingerprintService: First visit to domain, context stored');
        return [];
      }

      // Step 4: Multi-layered similarity analysis
      const analysis = this.analyzeChange(existingContext, currentFingerprint, pageContext);
      console.log('📊 Change analysis:', analysis);

      // Step 5: Update domain context
      await this.updateDomainContext(domain, currentFingerprint, pageContext);

      // Step 6: Generate risk signals only for genuine concerns
      return this.generateRiskSignals(analysis, existingContext, currentFingerprint);

    } catch (error) {
      console.error('❌ FingerprintService: Analysis failed:', error);
      return [];
    }
  }

  /**
   * Create a stable, semantic domain-level fingerprint
   */
  private static async createDomainFingerprint(text: string, pageContext: PageContext): Promise<DomainFingerprint | null> {
    const normalizedText = this.normalizeText(text);
    
    if (normalizedText.length < this.MIN_TEXT_LENGTH) {
      return null;
    }

    console.log('🤖 Creating domain fingerprint from text (length:', normalizedText.length, ')');

    // Extract brand using multiple strategies
    const brand = await this.extractBrand(normalizedText, pageContext);
    
    // Extract category using pattern matching
    const category = this.extractCategory(normalizedText);
    
    // Create semantic summary using AI
    const semanticSummary = await this.createSemanticSummary(normalizedText, brand, category);
    
    return {
      domain: pageContext.url ? new URL(pageContext.url).hostname : '',
      brand,
      category,
      semanticSummary,
      pageTypes: new Set([pageContext.pageType]),
      lastUpdated: Date.now(),
      visitCount: 1,
      confidence: this.calculateConfidence(brand, category, semanticSummary)
    };
  }

  /**
   * Extract brand name using multiple reliable strategies
   */
  private static async extractBrand(text: string, pageContext: PageContext): Promise<string> {
    // Strategy 1: Extract from URL domain (most reliable)
    if (pageContext.url) {
      try {
        const hostname = new URL(pageContext.url).hostname;
        const domainParts = hostname.replace(/^www\./, '').split('.');
        const mainDomain = domainParts[0];
        
        // Enhanced domain processing for better brand extraction
        const cleanDomain = this.cleanDomainForBrand(mainDomain);
        
        if (cleanDomain.length >= 3 && cleanDomain.length <= 30) {
          console.log('🎯 Brand from domain:', cleanDomain);
          return this.capitalizeBrand(cleanDomain);
        }
      } catch (e) {
        // Invalid URL, continue to other strategies
      }
    }

    // Strategy 2: Extract from page title
    if (pageContext.title) {
      const titleBrand = this.extractBrandFromTitle(pageContext.title);
      if (titleBrand) {
        console.log('🎯 Brand from title:', titleBrand);
        return titleBrand;
      }
    }

    // Strategy 3: Pattern-based extraction from content
    const contentBrand = this.extractBrandFromContent(text);
    if (contentBrand) {
      console.log('🎯 Brand from content:', contentBrand);
      return contentBrand;
    }

    // Strategy 4: AI-assisted extraction
    const aiBrand = await this.extractBrandWithAI(text);
    if (aiBrand) {
      console.log('🎯 Brand from AI:', aiBrand);
      return aiBrand;
    }

    console.log('⚠️ No brand extracted, using generic fallback');
    return 'Unknown Brand';
  }

  /**
   * Extract brand from page title
   */
  private static extractBrandFromTitle(title: string): string | null {
    // Common patterns in e-commerce titles
    const patterns = [
      /^([^|–-]+?)\s*[|–-]/, // "Brand | Product" or "Brand - Product"
      /^([A-Z][a-zA-Z0-9\s&]{2,30})\s+(?:official|store|shop)/i,
      /(?:buy|shop|get)\s+([A-Z][a-zA-Z0-9\s&]{2,30})/i,
      /([A-Z][a-zA-Z0-9\s&]{2,30})\s+(?:online|website)/i
    ];

    for (const pattern of patterns) {
      const match = title.match(pattern);
      if (match && match[1]) {
        const brand = match[1].trim();
        if (brand.length >= 3 && brand.length <= this.MAX_BRAND_LENGTH) {
          return this.capitalizeBrand(brand);
        }
      }
    }

    // Fallback: take first meaningful words
    const words = title.split(/\s+/).filter(word => 
      word.length >= 3 && 
      /^[A-Z]/.test(word) &&
      !['Buy', 'Shop', 'Get', 'Online', 'Official', 'Store', 'Website'].includes(word)
    );

    if (words.length > 0) {
      return this.capitalizeBrand(words.slice(0, 2).join(' '));
    }

    return null;
  }

  /**
   * Extract brand from page content using pattern matching
   */
  private static extractBrandFromContent(text: string): string | null {
    const patterns = [
      /(?:brand|from|by)\s+([A-Z][a-zA-Z0-9\s&]{2,30})/gi,
      /([A-Z][a-zA-Z0-9\s&]{2,30})\s+(?:brand|collection|store|shop)/gi,
      /(?:visit|shop|buy)\s+([A-Z][a-zA-Z0-9\s&]{2,30})/gi,
      /([A-Z][a-zA-Z0-9\s&]{2,30})\s+(?:official|website|online)/gi,
    ];

    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches && matches.length > 0) {
        for (const match of matches) {
          const brand = match.replace(/(?:brand|from|by|collection|store|shop|visit|official|website|online)/gi, '').trim();
          if (brand.length >= 3 && brand.length <= this.MAX_BRAND_LENGTH) {
            return this.capitalizeBrand(brand);
          }
        }
      }
    }

    // Frequency-based extraction
    const words = text.split(/\s+/).filter(word => 
      word.length >= 3 && 
      /^[A-Z]/.test(word) && 
      !['The', 'And', 'For', 'With', 'From', 'This', 'That', 'They', 'Have', 'Been', 'Your', 'Our', 'Get', 'Buy', 'Shop', 'Now', 'Free', 'New', 'Best'].includes(word)
    );
    
    const wordCounts = words.reduce((acc, word) => {
      acc[word] = (acc[word] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const mostFrequent = Object.entries(wordCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 2)
      .map(([word]) => word)
      .join(' ');

    if (mostFrequent.length >= 3 && mostFrequent.length <= this.MAX_BRAND_LENGTH) {
      return this.capitalizeBrand(mostFrequent);
    }

    return null;
  }

  /**
   * Extract brand using AI for complex cases
   */
  private static async extractBrandWithAI(text: string): Promise<string | null> {
    try {
      if (typeof (globalThis as any).LanguageModel !== 'undefined') {
        const { LanguageModel } = globalThis as any;
        const session = await LanguageModel.create({ temperature: 0.0, topK: 1 });
        
        const prompt = 'Extract the main brand or company name from this text. Return only the brand name, nothing else. Maximum 30 characters.';
        
        const response = await session.prompt([
          { role: 'system', content: prompt },
          { role: 'user', content: text.slice(0, 5000) },
        ], { language: 'en' });
        
        session.destroy?.();
        
        const brand = response.trim().slice(0, this.MAX_BRAND_LENGTH);
        if (brand.length >= 3) {
          return this.capitalizeBrand(brand);
        }
      }
    } catch (e) {
      console.log('⚠️ AI brand extraction failed:', e);
    }

    return null;
  }

  /**
   * Extract product category from text
   */
  private static extractCategory(text: string): string {
    const categories = {
      fashion: /(?:fashion|clothing|apparel|wear|shirt|dress|pants|shoes|accessories|t-shirt|polo|cotton|fabric|garment|outfit)/gi,
      electronics: /(?:electronics|gadgets|phones|laptops|computers|tech|mobile|smartphone|device|hardware)/gi,
      home: /(?:home|furniture|decor|kitchen|bedroom|living|household|appliance|interior)/gi,
      beauty: /(?:beauty|cosmetics|makeup|skincare|perfume|grooming|personal|care)/gi,
      sports: /(?:sports|fitness|gym|outdoor|athletic|exercise|equipment|training)/gi,
      books: /(?:books|reading|literature|novels|education|learning|publishing|academic)/gi,
      toys: /(?:toys|games|children|kids|play|entertainment|gaming|board)/gi,
      automotive: /(?:car|auto|vehicle|automotive|motor|bike|transportation)/gi,
      health: /(?:health|medical|pharmacy|wellness|supplements|medicine)/gi,
      food: /(?:food|grocery|restaurant|dining|cuisine|cooking|ingredients)/gi
    };

    for (const [category, pattern] of Object.entries(categories)) {
      if (pattern.test(text)) {
        console.log('🎯 Extracted category:', category);
        return category;
      }
    }

    return 'retail';
  }

  /**
   * Create semantic summary using AI
   */
  private static async createSemanticSummary(text: string, brand: string, category: string): Promise<string> {
    try {
      // Try Summarizer first (more reliable)
      if (typeof (globalThis as any).Summarizer !== 'undefined') {
        const summarizer: SummarizerModel = (globalThis as any).Summarizer;
        try {
          await summarizer.availability();
          const session = await summarizer.create({
            type: 'key-points',
            length: 'short',
          });
          const result = await session.summarize(
            text.slice(0, 15000),
            { maxOutputTokens: 100 }
          );
          session.destroy?.();
          console.log('✅ Summarizer semantic summary created');
          return this.cleanSummary(result);
        } catch (e) {
          console.log('⚠️ Summarizer failed, falling back to LanguageModel');
        }
      }

      // Fallback to LanguageModel
      if (typeof (globalThis as any).LanguageModel !== 'undefined') {
        const { LanguageModel } = globalThis as any;
        const session = await LanguageModel.create({ temperature: 0.1, topK: 1 });
        
        const prompt = `Summarize this ${category} website content in 1-2 sentences. Focus on the main purpose, target audience, and key offerings. Ignore specific products, prices, or promotional content.`;
        
        const response = await session.prompt([
          { role: 'system', content: prompt },
          { role: 'user', content: text.slice(0, 10000) },
        ], { language: 'en' });
        
        session.destroy?.();
        console.log('✅ LanguageModel semantic summary created');
        return this.cleanSummary(response);
      }
    } catch (e) {
      console.log('⚠️ AI summary creation failed:', e);
    }

    // Fallback: extract key phrases
    return this.extractKeyPhrases(text, brand, category);
  }

  /**
   * Analyze page context (type, confidence, etc.)
   */
  private static analyzePageContext(text: string, url: string): PageContext {
    const title = this.extractTitle(text);
    const pageType = this.detectPageType(text, url, title);
    const confidence = this.calculatePageTypeConfidence(text, pageType);

    return {
      pageType,
      confidence,
      url,
      title
    };
  }

  /**
   * Detect page type based on content and URL patterns
   */
  private static detectPageType(text: string, url: string, _title: string): PageContext['pageType'] {
    const lowerText = text.toLowerCase();
    const lowerUrl = url.toLowerCase();

    // URL-based detection (most reliable)
    if (lowerUrl.includes('/checkout') || lowerUrl.includes('/cart') || lowerUrl.includes('/payment')) {
      return 'checkout';
    }
    if (lowerUrl.includes('/product') || lowerUrl.includes('/item') || lowerUrl.includes('/detail')) {
      return 'product';
    }
    if (lowerUrl.includes('/category') || lowerUrl.includes('/collection') || lowerUrl.includes('/shop')) {
      return 'category';
    }
    if (lowerUrl.includes('/search') || lowerUrl.includes('?q=') || lowerUrl.includes('&search=')) {
      return 'search';
    }
    if (lowerUrl === '/' || lowerUrl.endsWith('/') || lowerUrl.split('/').length <= 3) {
      return 'home';
    }

    // Content-based detection
    const homeIndicators = ['welcome', 'homepage', 'main page', 'featured products', 'new arrivals'];
    const productIndicators = ['add to cart', 'buy now', 'price', 'in stock', 'product details'];
    const categoryIndicators = ['browse', 'category', 'collection', 'shop by', 'filter by'];
    const checkoutIndicators = ['checkout', 'payment', 'shipping', 'billing', 'order summary'];
    const searchIndicators = ['search results', 'no results found', 'search for', 'query'];

    if (checkoutIndicators.some(indicator => lowerText.includes(indicator))) return 'checkout';
    if (searchIndicators.some(indicator => lowerText.includes(indicator))) return 'search';
    if (productIndicators.some(indicator => lowerText.includes(indicator))) return 'product';
    if (categoryIndicators.some(indicator => lowerText.includes(indicator))) return 'category';
    if (homeIndicators.some(indicator => lowerText.includes(indicator))) return 'home';

    return 'other';
  }

  /**
   * Multi-layered change analysis with enhanced intelligence
   */
  private static analyzeChange(existing: DomainFingerprint, current: DomainFingerprint, pageContext: PageContext) {
    const analysis = {
      brandSimilarity: this.calculateBrandSimilarity(existing.brand, current.brand),
      categoryMatch: existing.category === current.category,
      semanticSimilarity: this.calculateSemanticSimilarity(existing.semanticSummary, current.semanticSummary),
      pageTypeConsistency: this.isPageTypeConsistent(existing.pageTypes, pageContext.pageType),
      domainChange: existing.domain !== current.domain,
      visitCountFactor: this.calculateVisitCountFactor(existing.visitCount),
      timeFactor: this.calculateTimeFactor(existing.lastUpdated),
      overallSimilarity: 0,
      riskLevel: 'low' as 'low' | 'medium' | 'high',
      confidenceScore: 0
    };

    // Enhanced similarity calculation with adaptive weights
    const weights = this.calculateAdaptiveWeights(existing, current, pageContext);
    
    analysis.overallSimilarity = (
      analysis.brandSimilarity * weights.brand +
      (analysis.categoryMatch ? 1 : 0) * weights.category +
      analysis.semanticSimilarity * weights.semantic +
      (analysis.pageTypeConsistency ? 1 : 0) * weights.pageType +
      (analysis.domainChange ? 0 : 1) * weights.domain +
      analysis.visitCountFactor * weights.visitCount
    );

    // Calculate confidence score
    analysis.confidenceScore = this.calculateAnalysisConfidence(analysis, existing, current);

    // Enhanced risk determination with context awareness
    analysis.riskLevel = this.determineRiskLevel(analysis, existing, current);

    return analysis;
  }

  /**
   * Calculate adaptive weights based on context
   */
  private static calculateAdaptiveWeights(existing: DomainFingerprint, _current: DomainFingerprint, pageContext: PageContext) {
    const baseWeights = {
      brand: 0.4,
      category: 0.25,
      semantic: 0.15,
      pageType: 0.1,
      domain: 0.05,
      visitCount: 0.05
    };

    // Adjust weights based on context
    if (existing.visitCount < 3) {
      // New site - be more lenient
      baseWeights.brand = 0.3;
      baseWeights.category = 0.2;
      baseWeights.pageType = 0.2;
    } else if (existing.visitCount > 10) {
      // Established site - be more strict
      baseWeights.brand = 0.5;
      baseWeights.category = 0.3;
    }

    // Adjust for page type
    if (pageContext.pageType === 'checkout') {
      baseWeights.brand = 0.6; // Brand is critical for checkout
      baseWeights.domain = 0.1; // Domain change is suspicious
    }

    return baseWeights;
  }

  /**
   * Calculate visit count factor (more visits = more established)
   */
  private static calculateVisitCountFactor(visitCount: number): number {
    if (visitCount <= 1) return 0.5; // New site
    if (visitCount <= 3) return 0.7; // Recently visited
    if (visitCount <= 10) return 0.9; // Regular site
    return 1.0; // Established site
  }

  /**
   * Calculate time factor (recent visits are more relevant)
   */
  private static calculateTimeFactor(lastUpdated: number): number {
    const hoursSinceUpdate = (Date.now() - lastUpdated) / (1000 * 60 * 60);
    
    if (hoursSinceUpdate < 1) return 1.0; // Very recent
    if (hoursSinceUpdate < 24) return 0.9; // Same day
    if (hoursSinceUpdate < 168) return 0.8; // Same week
    if (hoursSinceUpdate < 720) return 0.7; // Same month
    return 0.6; // Older
  }

  /**
   * Calculate confidence in the analysis
   */
  private static calculateAnalysisConfidence(analysis: any, existing: DomainFingerprint, current: DomainFingerprint): number {
    let confidence = 0;
    
    // High confidence if we have established patterns
    if (existing.visitCount > 5) confidence += 0.3;
    if (existing.confidence > 0.8) confidence += 0.2;
    
    // High confidence if current fingerprint is clear
    if (current.confidence > 0.8) confidence += 0.2;
    
    // High confidence if analysis is consistent
    if (analysis.brandSimilarity > 0.8 || analysis.brandSimilarity < 0.2) confidence += 0.2;
    if (analysis.semanticSimilarity > 0.7 || analysis.semanticSimilarity < 0.3) confidence += 0.1;
    
    return Math.min(confidence, 1.0);
  }

  /**
   * Enhanced risk level determination
   */
  private static determineRiskLevel(analysis: any, _existing: DomainFingerprint, _current: DomainFingerprint): 'low' | 'medium' | 'high' {
    // High risk scenarios
    if (analysis.domainChange && analysis.brandSimilarity < 0.5) {
      return 'high'; // Different domain with different brand
    }
    
    if (analysis.brandSimilarity < 0.2) {
      return 'high'; // Completely different brand
    }
    
    if (analysis.domainChange && !analysis.categoryMatch) {
      return 'high'; // Domain change + category change
    }
    
    // Medium risk scenarios
    if (analysis.overallSimilarity < 0.3) {
      return 'medium'; // Low overall similarity
    }
    
    if (analysis.brandSimilarity < 0.4 && !analysis.categoryMatch) {
      return 'medium'; // Brand change + category change
    }
    
    if (analysis.domainChange && analysis.overallSimilarity < 0.5) {
      return 'medium'; // Domain change with moderate similarity
    }
    
    // Low risk scenarios
    if (analysis.overallSimilarity > 0.6) {
      return 'low'; // High similarity
    }
    
    if (analysis.brandSimilarity > 0.7 && analysis.pageTypeConsistency) {
      return 'low'; // Same brand, consistent navigation
    }
    
    return 'low'; // Default to low risk
  }

  /**
   * Calculate brand name similarity with enhanced intelligence
   */
  private static calculateBrandSimilarity(brand1: string, brand2: string): number {
    if (brand1 === brand2) return 1.0;
    
    const normalized1 = brand1.toLowerCase().replace(/[^a-z0-9\s]/g, '');
    const normalized2 = brand2.toLowerCase().replace(/[^a-z0-9\s]/g, '');
    
    if (normalized1 === normalized2) return 0.95;
    
    // Check for known brand variations
    const variationSimilarity = this.checkBrandVariations(normalized1, normalized2);
    if (variationSimilarity > 0) return variationSimilarity;
    
    // Check for partial matches (e.g., "Lux Cozi" vs "LuxCozi")
    if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) {
      return 0.8;
    }
    
    // Check for word overlap with enhanced scoring
    const words1 = new Set(normalized1.split(/\s+/).filter(w => w.length > 1));
    const words2 = new Set(normalized2.split(/\s+/).filter(w => w.length > 1));
    
    if (words1.size === 0 || words2.size === 0) return 0;
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    const baseSimilarity = intersection.size / union.size;
    
    // Boost similarity if there's a significant word overlap
    if (intersection.size > 0) {
      const overlapRatio = intersection.size / Math.min(words1.size, words2.size);
      if (overlapRatio > 0.5) {
        return Math.min(baseSimilarity + 0.2, 0.9);
      }
    }
    
    return baseSimilarity;
  }

  /**
   * Check for known brand variations
   */
  private static checkBrandVariations(brand1: string, brand2: string): number {
    for (const [baseBrand, variations] of this.BRAND_VARIATIONS) {
      const isBrand1Base = brand1.includes(baseBrand);
      const isBrand2Base = brand2.includes(baseBrand);
      
      if (isBrand1Base && isBrand2Base) {
        return 0.95; // Both are variations of the same base brand
      }
      
      if (isBrand1Base) {
        for (const variation of variations) {
          if (brand2.includes(variation)) return 0.9;
        }
      }
      
      if (isBrand2Base) {
        for (const variation of variations) {
          if (brand1.includes(variation)) return 0.9;
        }
      }
    }
    
    return 0;
  }

  /**
   * Calculate semantic similarity using token-based approach
   */
  private static calculateSemanticSimilarity(text1: string, text2: string): number {
    const tokens1 = this.tokenize(text1);
    const tokens2 = this.tokenize(text2);
    
    if (tokens1.size === 0 || tokens2.size === 0) return 0;
    
    const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
    const union = new Set([...tokens1, ...tokens2]);
    
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  /**
   * Check if page type is consistent with existing context
   */
  private static isPageTypeConsistent(existingTypes: Set<string>, currentType: string): boolean {
    // Allow any page type for first few visits
    if (existingTypes.size <= 2) return true;
    
    // Check if current type is already seen or compatible
    if (existingTypes.has(currentType)) return true;
    
    // Define compatible page types
    const compatibleTypes: Record<string, string[]> = {
      home: ['category', 'product', 'search'],
      category: ['home', 'product', 'search'],
      product: ['home', 'category', 'checkout'],
      search: ['home', 'category', 'product'],
      checkout: ['product'],
      other: ['home', 'category', 'product']
    };
    
    return [...existingTypes].some(type => 
      compatibleTypes[type]?.includes(currentType)
    );
  }

  /**
   * Generate risk signals only for genuine concerns with enhanced context
   */
  private static generateRiskSignals(analysis: any, existing: DomainFingerprint, current: DomainFingerprint): RiskSignal[] {
    if (analysis.riskLevel === 'low') {
      return [];
    }

    const signals: RiskSignal[] = [];
    const isTrustedDomain = this.TRUSTED_DOMAINS.has(existing.domain);
    const confidenceBonus = analysis.confidenceScore > 0.8 ? 10 : 0;
    
    // High-risk scenarios
    if (analysis.riskLevel === 'high') {
      let reason = 'Site appears to have changed significantly';
      let details = '';
      
      if (analysis.domainChange && analysis.brandSimilarity < 0.3) {
        reason = 'You appear to have navigated to a completely different website';
        details = `From: ${existing.brand} (${existing.domain}) → To: ${current.brand} (${current.domain})`;
      } else if (analysis.brandSimilarity < 0.2) {
        reason = 'Site brand appears to have changed completely';
        details = `Brand changed from "${existing.brand}" to "${current.brand}"`;
      } else if (analysis.domainChange && !analysis.categoryMatch) {
        reason = 'Domain and business type have both changed';
        details = `Domain: ${existing.domain} → ${current.domain}, Category: ${existing.category} → ${current.category}`;
      } else {
        reason = 'Site purpose appears to have changed significantly - possible phishing or takeover';
        details = `Similarity: ${(analysis.overallSimilarity * 100).toFixed(0)}%, Confidence: ${(analysis.confidenceScore * 100).toFixed(0)}%`;
      }
      
      signals.push({
        id: 'site-purpose-change',
        score: Math.round((1 - analysis.overallSimilarity) * 100) + confidenceBonus,
        reason,
        severity: 'high',
        category: 'legitimacy',
        source: 'heuristic',
        details
      });
    }
    
    // Medium-risk scenarios
    else if (analysis.riskLevel === 'medium') {
      let reason = 'Site content has changed noticeably since last visit';
      let details = '';
      
      if (analysis.brandSimilarity < 0.4 && !analysis.categoryMatch) {
        reason = 'Both brand and business type have changed';
        details = `Brand: ${existing.brand} → ${current.brand}, Category: ${existing.category} → ${current.category}`;
      } else if (analysis.domainChange && analysis.overallSimilarity < 0.5) {
        reason = 'You appear to have moved to a different domain with similar content';
        details = `Domain: ${existing.domain} → ${current.domain}, Similarity: ${(analysis.overallSimilarity * 100).toFixed(0)}%`;
      } else {
        reason = 'Site content has changed noticeably since last visit';
        details = `Overall similarity: ${(analysis.overallSimilarity * 100).toFixed(0)}%, Visit count: ${existing.visitCount}`;
      }
      
      signals.push({
        id: 'site-content-change',
        score: Math.round((1 - analysis.overallSimilarity) * 80) + confidenceBonus,
        reason,
        severity: 'medium',
        category: 'legitimacy',
        source: 'heuristic',
        details
      });
    }

    // Add context-aware warnings for trusted domains
    if (isTrustedDomain && analysis.riskLevel !== 'low') {
      signals.push({
        id: 'trusted-domain-change',
        score: 20,
        reason: 'This is a trusted domain - unexpected changes may indicate security issues',
        severity: 'medium',
        category: 'security',
        source: 'heuristic',
        details: `Trusted domain "${existing.domain}" showing unexpected changes. Verify you're on the correct site.`
      });
    }

    return signals;
  }

  // ----- Storage Methods -----

  private static async loadDomainContext(domain: string): Promise<DomainFingerprint | null> {
    const key = this.DOMAIN_CONTEXT_KEY + domain;
    const data = await StorageService.get(key) as any;
    
    if (!data) return null;
    
    // Convert pageTypes back to Set if it was serialized as an array
    if (data.pageTypes && !(data.pageTypes instanceof Set)) {
      data.pageTypes = new Set(Array.isArray(data.pageTypes) ? data.pageTypes : []);
    }
    
    return data as DomainFingerprint;
  }

  private static async saveDomainContext(domain: string, fingerprint: DomainFingerprint): Promise<void> {
    const key = this.DOMAIN_CONTEXT_KEY + domain;
    await StorageService.set(key, fingerprint);
  }

  private static async updateDomainContext(domain: string, current: DomainFingerprint, pageContext: PageContext): Promise<void> {
    const existing = await this.loadDomainContext(domain);
    
    if (existing) {
      // Update existing context
      existing.pageTypes.add(pageContext.pageType);
      existing.lastUpdated = Date.now();
      existing.visitCount++;
      
      // Update brand/category if more confident
      if (current.confidence > existing.confidence) {
        existing.brand = current.brand;
        existing.category = current.category;
        existing.semanticSummary = current.semanticSummary;
        existing.confidence = current.confidence;
      }
      
      await this.saveDomainContext(domain, existing);
    } else {
      await this.saveDomainContext(domain, current);
    }
  }

  // ----- Helper Methods -----

  private static normalizeText(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .replace(/\u00A0/g, ' ')
      .replace(/[^\w\s\-.,!?]/g, ' ')
      .trim();
  }

  private static tokenize(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 2)
    );
  }

  private static cleanSummary(summary: string): string {
    return summary
      .replace(/[`*\-\n]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
  }

  private static extractKeyPhrases(text: string, brand: string, category: string): string {
    const sentences = text.split(/[.!?]+/).slice(0, 5);
    const keyPhrases = sentences
      .map(s => s.trim())
      .filter(s => s.length > 20 && s.length < 150)
      .slice(0, 2);
    
    return `${brand} ${category} site: ${keyPhrases.join(' ')}`;
  }

  private static extractTitle(text: string): string {
    // Try to extract title from common patterns
    const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i) || 
                      text.match(/<h1[^>]*>([^<]+)<\/h1>/i) ||
                      text.match(/^([^|\n]{10,100})/);
    
    return titleMatch ? titleMatch[1].trim() : '';
  }

  private static calculatePageTypeConfidence(text: string, pageType: PageContext['pageType']): number {
    // Simple confidence based on text length and content indicators
    const lengthScore = Math.min(text.length / 5000, 1);
    const typeIndicators: Record<string, string[]> = {
      home: ['welcome', 'featured', 'new arrivals'],
      product: ['add to cart', 'price', 'in stock'],
      category: ['browse', 'filter', 'sort by'],
      checkout: ['payment', 'shipping', 'billing'],
      search: ['search results', 'query', 'results for'],
      other: ['page', 'content', 'information']
    };
    
    const indicators = typeIndicators[pageType] || [];
    const indicatorScore = indicators.some((indicator: string) => 
      text.toLowerCase().includes(indicator)
    ) ? 1 : 0.5;
    
    return (lengthScore + indicatorScore) / 2;
  }

  private static calculateConfidence(brand: string, category: string, summary: string): number {
    let confidence = 0;
    
    if (brand !== 'Unknown Brand') confidence += 0.4;
    if (category !== 'retail') confidence += 0.3;
    if (summary.length > 50) confidence += 0.3;
    
    return confidence;
  }

  private static capitalizeBrand(brand: string): string {
    return brand
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Clean domain name for better brand extraction
   */
  private static cleanDomainForBrand(domain: string): string {
    // Remove common suffixes that don't represent the brand
    const suffixesToRemove = [
      'store', 'shop', 'online', 'website', 'official', 'global', 'world', 'international',
      'usa', 'us', 'uk', 'india', 'canada', 'australia', 'europe', 'asia'
    ];
    
    let cleanDomain = domain.toLowerCase();
    
    // Remove suffixes
    for (const suffix of suffixesToRemove) {
      if (cleanDomain.endsWith(`-${suffix}`) || cleanDomain.endsWith(`_${suffix}`)) {
        cleanDomain = cleanDomain.slice(0, -(suffix.length + 1));
      }
    }
    
    // Handle hyphenated domains (e.g., "lux-cozi" -> "Lux Cozi")
    cleanDomain = cleanDomain.replace(/[-_]/g, ' ');
    
    return cleanDomain.trim();
  }

  // Legacy methods for backward compatibility
  static async save(_domain: string, _fingerprint: string): Promise<void> {
    console.log('⚠️ Legacy save method called, consider using saveDomainContext');
    // Implementation for backward compatibility if needed
  }

  static async load(_domain: string): Promise<{ domain: string; fingerprint: string; timestamp: number } | null> {
    console.log('⚠️ Legacy load method called, consider using loadDomainContext');
    // Implementation for backward compatibility if needed
    return null;
  }
}