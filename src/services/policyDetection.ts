interface SummarizerSession {
  summarize: (text: string, options?: any) => Promise<string>;
  destroy?: () => void;
}

interface SummarizerModel {
  availability: () => Promise<unknown>;
  create: (options?: any) => Promise<SummarizerSession>;
}

declare global {
  var Summarizer: SummarizerModel | undefined;
}

export interface PolicyDetectionResult {
  isPolicyPage: boolean;
  policyType: 'returnRefund' | 'shipping' | 'terms' | 'privacy' | 'other';
  confidence: number;
  url: string;
  title: string;
  content: string;
  signals?: string[];
  legitimacy?: PolicyLegitimacyResult;
}

export interface PolicyLegitimacyResult {
  isLegitimate: boolean;
  score: number; // 0-100, higher is more legitimate
  warnings: string[];
  redFlags: string[];
  concerns: {
    tooVague: boolean;
    tooShort: boolean;
    missingKeyInfo: boolean;
    suspiciousPatterns: boolean;
    poorQuality: boolean;
  };
}

export interface PolicySummaryResult {
  summary: string[];
  keyPoints: {
    returnWindow?: string;
    cost?: string;
    conditions?: string[];
  };
  riskFactors: string[];
  trustSignals: string[];
  language: string;
  wasTranslated: boolean;
  timestamp: number;
}

export class PolicyDetectionService {
  private static readonly POLICY_KEYWORDS = [
    'policy', 'policies', 'terms', 'conditions', 'agreement', 'agreements',
    'privacy', 'privacy-policy', 'privacy-center', 'data-protection', 'gdpr',
    'return', 'returns', 'refund', 'refunds', 'exchange', 'exchanges',
    'shipping', 'delivery', 'shipping-policy', 'delivery-policy',
    'cancellation', 'cancellations', 'warranty', 'warranties',
    'legal', 'legal-notice', 'disclaimer', 'disclaimers',
    'help', 'customer-service', 'support', 'faq', 'faqs'
  ];

  private static readonly POLICY_TYPE_PATTERNS = {
    returnRefund: ['return', 'refund', 'exchange', 'cancellation', 'warranty'],
    shipping: ['shipping', 'delivery', 'shipping-policy', 'delivery-policy'],
    terms: ['terms', 'conditions', 'agreement', 'legal', 'disclaimer'],
    privacy: ['privacy', 'data-protection', 'gdpr', 'cookie']
  };

  private static readonly POLICY_TYPE_NAMES = {
    returnRefund: 'Return & Refund Policy',
    shipping: 'Shipping & Delivery Policy',
    terms: 'Terms & Conditions',
    privacy: 'Privacy Policy',
    other: 'Policy Document'
  };

  private static readonly POLICY_CONTENT_INDICATORS = [
    'terms and conditions', 'privacy policy', 'return policy', 'shipping policy',
    'refund policy', 'cancellation policy', 'warranty policy', 'legal notice',
    'data protection', 'cookie policy', 'user agreement', 'service agreement',
    'terms of service', 'terms of use', 'end user agreement', 'license agreement',
    'privacy center', 'privacy choices', 'privacy rights', 'privacy notice',
    'returns and refunds', 'return shipping', 'refund process', 'return process',
    'customer service', 'help center', 'support center', 'faq', 'frequently asked'
  ];

  private static readonly LEGAL_LANGUAGE_PATTERNS = [
    'hereby', 'whereas', 'therefore', 'notwithstanding', 'pursuant to', 
    'in accordance with', 'subject to', 'governed by', 'binding agreement',
    'liability', 'indemnification', 'jurisdiction', 'dispute resolution',
    'effective date', 'amendment', 'termination', 'breach of contract'
  ];

  private static readonly MODERN_POLICY_PATTERNS = [
    'privacy choices', 'privacy rights', 'privacy settings', 'privacy center',
    'return request', 'refund request', 'return process', 'refund process',
    'return shipping', 'return policy', 'refund policy', 'exchange policy',
    'customer service', 'help center', 'support', 'contact us',
    'manage your', 'update your', 'access your', 'delete your',
    'data protection', 'personal information', 'personal data',
    'opt out', 'opt-in', 'unsubscribe', 'preferences', 'settings'
  ];

  static detectPolicyPage(): PolicyDetectionResult {
    const url = window.location.href;
    const path = window.location.pathname.toLowerCase();
    const title = document.title.toLowerCase();
    const content = document.body.innerText.toLowerCase();

    // STEP 1: Initial detection with scoring
    const initialDetection = this.performInitialDetection(path, title, content);
    
    // STEP 2: Content verification (only if initial detection passes)
    if (initialDetection.score >= 40) {
      const verificationResult = this.performContentVerification(content, path, title);
      
      // Check if URL has strong policy indicators
      const hasStrongUrlMatch = initialDetection.signals.includes('policy-url');
      
      // Combine results - use weighted approach for strong URL matches
      let finalScore: number;
      if (hasStrongUrlMatch && verificationResult.score >= 15) {
        // For strong URL matches, be more lenient - just need some content verification
        // Weight: 70% URL/title detection + 30% content verification
        finalScore = Math.round(initialDetection.score * 0.7 + verificationResult.score * 0.3);
      } else {
        // For weak URL matches, require both to be strong (original logic)
        finalScore = Math.min(initialDetection.score, verificationResult.score);
      }
      
      const isPolicyPage = finalScore >= 40;
      
      if (isPolicyPage) {
        const policyType = this.determinePolicyType(path, title, content);
        
        // Assess policy legitimacy to detect vague or suspicious content
        const legitimacy = this.assessPolicyLegitimacy(document.body.innerText, policyType);
        
        return {
          isPolicyPage: true,
          policyType,
          confidence: finalScore,
          url,
          title: document.title,
          content: document.body.innerText,
          signals: [...initialDetection.signals, ...verificationResult.signals],
          legitimacy
        };
      }
    }

    return {
      isPolicyPage: false,
      policyType: 'other',
      confidence: Math.max(0, initialDetection.score - 20),
      url,
      title: document.title,
      content: document.body.innerText,
      signals: initialDetection.signals
    };
  }

  private static performInitialDetection(path: string, title: string, content: string): {
    score: number;
    signals: string[];
  } {
    let policyScore = 0;
    const signals: string[] = [];

    const productPageIndicators = [
      'add to cart', 'add to bag', 'buy now', 'shop now', 'purchase',
      'in stock', 'out of stock', 'quantity', 'color:', 'size:',
      'product details', 'product description', 'specifications',
      'customer reviews', 'star rating', 'write a review',
      'shipping & returns', 'free delivery', 'extended returns',
      'add to wishlist', 'add to registry', 'compare', 'share'
    ];
    
    const productIndicatorCount = productPageIndicators.filter(indicator => 
      content.includes(indicator)
    ).length;
    
    if (productIndicatorCount >= 3) {
      signals.push('product-page-detected');
      return { score: 0, signals };
    }
    
    const productUrlPatterns = ['/product/', '/item/', '/p/', '/dp/', '/gp/product', '/ip/'];
    if (productUrlPatterns.some(pattern => path.includes(pattern))) {
      signals.push('product-url-detected');
      return { score: 0, signals };
    }
    
    const categoryUrlPatterns = ['/category/', '/collection/', '/shop/', '/browse/', '/search'];
    const categoryPageIndicators = [
      'items found', 'results for', 'filter by', 'sort by',
      'price range', 'clear all', 'showing', 'of', 'results',
      'next page', 'previous page', 'per page'
    ];
    
    const categoryIndicatorCount = categoryPageIndicators.filter(indicator => 
      content.includes(indicator)
    ).length;
    
    if (categoryUrlPatterns.some(pattern => path.includes(pattern)) || categoryIndicatorCount >= 2) {
      signals.push('category-page-detected');
      return { score: 0, signals };
    }

    if (this.POLICY_KEYWORDS.some(keyword => path.includes(keyword))) {
      policyScore += 50;
      signals.push('policy-url');
    }

    if (this.POLICY_KEYWORDS.some(keyword => title.includes(keyword))) {
      policyScore += 30;
      signals.push('policy-title');
    }

    if (this.POLICY_CONTENT_INDICATORS.some(indicator => content.includes(indicator))) {
      policyScore += 25;
      signals.push('policy-content');
    }

    const textLength = document.body.innerText.length;
    const headingCount = document.querySelectorAll('h1, h2, h3').length;
    
    if (textLength > 3000 && headingCount > 3) {
      policyScore += 15;
      signals.push('long-structured-content');
    }

    return { score: policyScore, signals };
  }

  private static performContentVerification(content: string, path: string, _title: string): {
    score: number;
    signals: string[];
  } {
    let verificationScore = 0;
    const signals: string[] = [];

    // Legal language detection (strong indicator of formal policy)
    const legalLanguageCount = this.LEGAL_LANGUAGE_PATTERNS.filter(pattern => 
      content.includes(pattern)
    ).length;
    
    if (legalLanguageCount >= 3) {
      verificationScore += 40;
      signals.push(`legal-language-${legalLanguageCount}`);
    } else if (legalLanguageCount >= 1) {
      verificationScore += 20;
      signals.push(`legal-language-${legalLanguageCount}`);
    }

    // Modern policy language detection (user-friendly policy pages)
    const modernPolicyCount = this.MODERN_POLICY_PATTERNS.filter(pattern => 
      content.includes(pattern)
    ).length;
    
    if (modernPolicyCount >= 3) {
      verificationScore += 35;
      signals.push(`modern-policy-${modernPolicyCount}`);
    } else if (modernPolicyCount >= 1) {
      verificationScore += 15;
      signals.push(`modern-policy-${modernPolicyCount}`);
    }

    // Policy-specific section detection
    const policySections = [
      'section', 'article', 'clause', 'paragraph', 'subsection',
      'definitions', 'scope', 'applicability', 'rights and obligations'
    ];
    
    const sectionCount = policySections.filter(section => 
      content.includes(section)
    ).length;
    
    if (sectionCount >= 2) {
      verificationScore += 25;
      signals.push(`policy-sections-${sectionCount}`);
    }

    // Formal policy structure detection
    const formalStructure = [
      'effective date', 'last updated', 'version', 'revision',
      'table of contents', 'index', 'appendix'
    ];
    
    const structureCount = formalStructure.filter(structure => 
      content.includes(structure)
    ).length;
    
    if (structureCount >= 1) {
      verificationScore += 20;
      signals.push(`formal-structure-${structureCount}`);
    }

    // Anti-patterns (things that indicate this is NOT a policy page)
    // Only apply if URL doesn't clearly indicate a policy page
    const hasStrongPolicyUrl = this.POLICY_KEYWORDS.some(keyword => path.includes(keyword));
    
    if (!hasStrongPolicyUrl) {
      const antiPatterns = [
        'add to cart', 'buy now', 'shop now', 'checkout', 'payment',
        'product details', 'customer reviews', 'related products',
        'newsletter signup', 'social media', 'follow us'
      ];
      
      const antiPatternCount = antiPatterns.filter(pattern => 
        content.includes(pattern)
      ).length;
      
      if (antiPatternCount >= 4) {
        verificationScore -= 20; // Reduced penalty for e-commerce content
        signals.push(`anti-patterns-${antiPatternCount}`);
      } else if (antiPatternCount >= 2) {
        verificationScore -= 10; // Light penalty
        signals.push(`anti-patterns-${antiPatternCount}`);
      }
    }

    // URL path depth analysis (policies are usually deeper in site structure)
    const pathDepth = path.split('/').filter(segment => segment.length > 0).length;
    if (pathDepth >= 2) {
      verificationScore += 10;
      signals.push(`path-depth-${pathDepth}`);
    }

    // Special handling for help/customer service pages that are policy-related
    const helpPolicyIndicators = [
      'help', 'customer-service', 'support', 'faq', 'returns', 'refunds', 'privacy'
    ];
    
    const helpPolicyCount = helpPolicyIndicators.filter(indicator => 
      path.includes(indicator) || content.includes(indicator)
    ).length;
    
    if (helpPolicyCount >= 2) {
      verificationScore += 25; // Boost for help pages with policy content
      signals.push(`help-policy-${helpPolicyCount}`);
    }

    return { score: Math.max(0, verificationScore), signals };
  }

  private static determinePolicyType(path: string, title: string, content: string): PolicyDetectionResult['policyType'] {
    const combinedText = `${path} ${title} ${content}`.toLowerCase();

    // Check for specific policy types
    for (const [type, patterns] of Object.entries(this.POLICY_TYPE_PATTERNS)) {
      if (patterns.some(pattern => combinedText.includes(pattern))) {
        return type as PolicyDetectionResult['policyType'];
      }
    }

    return 'other';
  }

  static getPolicyTypeName(policyType: PolicyDetectionResult['policyType']): string {
    return this.POLICY_TYPE_NAMES[policyType] || 'Policy Document';
  }

  static async generatePolicySummary(detectionResult: PolicyDetectionResult): Promise<PolicySummaryResult | null> {
    try {
      if (!detectionResult.isPolicyPage) {
        return null;
      }

      console.log('🤖 Generating AI policy summary for:', detectionResult.policyType);

      // Use Chrome's Summarizer API
      if (typeof (globalThis as any).Summarizer !== 'undefined') {
        const summarizer: SummarizerModel = (globalThis as any).Summarizer;
        
        try {
          await summarizer.availability();
          const session = await summarizer.create({
            type: 'key-points',
            length: 'medium',
          });

          // Generate summary with policy-specific context
          const result = await session.summarize(
            detectionResult.content.slice(0, 15000),
            { maxOutputTokens: 300 }
          );

          session.destroy?.();
          console.log('✅ Policy summary generated successfully');

          // Parse and structure the summary
          return this.parsePolicySummary(result, detectionResult);

        } catch (error) {
          console.log('⚠️ Summarizer failed, falling back to LanguageModel');
          return await this.fallbackToLanguageModel(detectionResult);
        }
      } else {
        console.log('⚠️ Summarizer not available, using LanguageModel');
        return await this.fallbackToLanguageModel(detectionResult);
      }

    } catch (error) {
      console.error('❌ Policy summary generation failed:', error);
      return null;
    }
  }

  private static async fallbackToLanguageModel(detectionResult: PolicyDetectionResult): Promise<PolicySummaryResult | null> {
    try {
      if (typeof (globalThis as any).LanguageModel !== 'undefined') {
        const { LanguageModel } = globalThis as any;
        const session = await LanguageModel.create({ 
          temperature: 0.1, 
          topK: 1 
        });

        const prompt = `Summarize this ${detectionResult.policyType} policy. Extract key points, important conditions, and any risk factors. Focus on user-relevant information like return windows, costs, and restrictions.

Policy content: ${detectionResult.content.slice(0, 8000)}`;

        const response = await session.prompt([
          { role: 'system', content: 'You are an expert at analyzing e-commerce policies. Extract key information that users need to know.' },
          { role: 'user', content: prompt }
        ], { language: 'en' });

        session.destroy?.();
        console.log('✅ LanguageModel policy summary generated');

        return this.parsePolicySummary(response, detectionResult);
      }
    } catch (error) {
      console.error('❌ LanguageModel fallback failed:', error);
    }

    return null;
  }

  private static parsePolicySummary(aiResponse: string, detectionResult: PolicyDetectionResult): PolicySummaryResult {
    try {
      // Extract key points from AI response
      const summary = this.extractKeyPoints(aiResponse);
      
      // Extract specific information based on policy type
      const keyPoints = this.extractSpecificKeyPoints(aiResponse, detectionResult.policyType);
      
      // Extract risk factors
      const riskFactors = this.extractRiskFactors(aiResponse);
      
      // Extract trust signals
      const trustSignals = this.extractTrustSignals(aiResponse);

      return {
        summary,
        keyPoints,
        riskFactors,
        trustSignals,
        language: 'en',
        wasTranslated: false,
        timestamp: Date.now()
      };

    } catch (error) {
      console.error('❌ Failed to parse policy summary:', error);
      
      // Return basic fallback
      return {
        summary: [aiResponse.slice(0, 200) + '...'],
        keyPoints: {},
        riskFactors: [],
        trustSignals: [],
        language: 'en',
        wasTranslated: false,
        timestamp: Date.now()
      };
    }
  }

  private static extractKeyPoints(aiResponse: string): string[] {
    // Split by common delimiters and clean up
    const points = aiResponse
      .split(/[•\-\*\n]/)
      .map(point => point.trim())
      .filter(point => point.length > 10 && point.length < 200)
      .slice(0, 5);

    return points.length > 0 ? points : [aiResponse.slice(0, 150) + '...'];
  }

  private static extractSpecificKeyPoints(aiResponse: string, policyType: string): PolicySummaryResult['keyPoints'] {
    const keyPoints: PolicySummaryResult['keyPoints'] = {};

    // Extract return window for return/refund policies
    if (policyType === 'returnRefund') {
      const returnWindowMatch = aiResponse.match(/(\d+)\s*(day|days|week|weeks|month|months)/i);
      if (returnWindowMatch) {
        keyPoints.returnWindow = `${returnWindowMatch[1]} ${returnWindowMatch[2]}`;
      }
    }

    // Extract cost information
    const costMatch = aiResponse.match(/(free|no cost|no charge|\$\d+|\d+\s*(dollar|euro|pound))/i);
    if (costMatch) {
      keyPoints.cost = costMatch[0];
    }

    // Extract conditions
    const conditions = aiResponse
      .split(/[•\-\*\n]/)
      .map(line => line.trim())
      .filter(line => line.toLowerCase().includes('condition') || line.toLowerCase().includes('requirement'))
      .slice(0, 3);

    if (conditions.length > 0) {
      keyPoints.conditions = conditions;
    }

    return keyPoints;
  }

  private static extractRiskFactors(aiResponse: string): string[] {
    const riskKeywords = ['restriction', 'limit', 'exclusion', 'not covered', 'void', 'invalid', 'penalty', 'fee'];
    
    return aiResponse
      .split(/[•\-\*\n]/)
      .map(line => line.trim())
      .filter(line => riskKeywords.some(keyword => line.toLowerCase().includes(keyword)))
      .slice(0, 3);
  }

  private static extractTrustSignals(aiResponse: string): string[] {
    const trustKeywords = ['free', 'guarantee', 'protection', 'secure', 'insured', 'covered', 'support'];
    
    return aiResponse
      .split(/[•\-\*\n]/)
      .map(line => line.trim())
      .filter(line => trustKeywords.some(keyword => line.toLowerCase().includes(keyword)))
      .slice(0, 3);
  }

  static isCurrentPagePolicy(): boolean {
    return this.detectPolicyPage().isPolicyPage;
  }

  static getCurrentPagePolicyType(): PolicyDetectionResult['policyType'] {
    return this.detectPolicyPage().policyType;
  }

  /**
   * Assess the legitimacy and quality of a policy page
   * Detects vague, incomplete, or suspicious policy content
   */
  static assessPolicyLegitimacy(content: string, policyType: string): PolicyLegitimacyResult {
    let score = 100; // Start with perfect score, deduct for issues
    const warnings: string[] = [];
    const redFlags: string[] = [];
    const concerns = {
      tooVague: false,
      tooShort: false,
      missingKeyInfo: false,
      suspiciousPatterns: false,
      poorQuality: false,
    };

    const lowerContent = content.toLowerCase();
    const wordCount = content.split(/\s+/).length;
    const sentenceCount = content.split(/[.!?]+/).length;

    // 1. CHECK LENGTH - Legitimate policies should be substantial
    if (wordCount < 150) {
      score -= 50;
      concerns.tooShort = true;
      redFlags.push('Policy is extremely short (less than 150 words)');
      warnings.push('This policy appears suspiciously brief and incomplete');
    } else if (wordCount < 300) {
      score -= 30;
      concerns.tooShort = true;
      warnings.push('Policy content is minimal (less than 300 words) - may lack important details');
    } else if (wordCount < 500) {
      score -= 10;
      concerns.tooShort = true;
      warnings.push('Policy is shorter than typical - verify all important terms are covered');
    }

    // 2. CHECK FOR VAGUE LANGUAGE
    const vaguePatterns = [
      'may vary', 'at our discretion', 'we reserve the right', 'subject to change',
      'without notice', 'as we see fit', 'at any time', 'for any reason',
      'sole discretion', 'absolute discretion', 'we have no control', 'cannot tell you',
      'may be required', 'might be', 'could be', 'possibly', 'approximately',
      'we are not responsible', 'not liable', 'no liability', 'no guarantee'
    ];
    
    const vagueCount = vaguePatterns.filter(pattern => lowerContent.includes(pattern)).length;
    if (vagueCount >= 5) {
      score -= 35;
      concerns.tooVague = true;
      redFlags.push('Contains excessive vague or discretionary language');
      warnings.push('Policy uses many vague terms that favor the business over customers');
    } else if (vagueCount >= 3) {
      score -= 20;
      concerns.tooVague = true;
      warnings.push('Policy contains significant vague or unclear terms');
    } else if (vagueCount >= 2) {
      score -= 10;
      concerns.tooVague = true;
      warnings.push('Policy has some vague language - read carefully');
    }
    
    // 2b. CHECK FOR DISCLAIMER-HEAVY CONTENT (new check)
    const disclaimerPatterns = [
      'we are not responsible', 'not our responsibility', 'we cannot',
      'we have no control', 'beyond our control', 'cannot guarantee',
      'you are responsible', 'buyer beware', 'at your own risk',
      'we disclaim', 'no warranty', 'as is'
    ];
    
    const disclaimerCount = disclaimerPatterns.filter(pattern => lowerContent.includes(pattern)).length;
    if (disclaimerCount >= 4) {
      score -= 25;
      concerns.tooVague = true;
      redFlags.push('Policy is heavily focused on disclaimers and limitations');
      warnings.push('Policy emphasizes what they WON\'T do rather than customer protection');
    } else if (disclaimerCount >= 2) {
      score -= 10;
      warnings.push('Policy contains multiple disclaimers limiting seller responsibility');
    }

    // 3. CHECK FOR MISSING KEY INFORMATION (based on policy type)
    const missingInfo = this.checkMissingKeyInfo(lowerContent, policyType);
    if (missingInfo.length > 0) {
      score -= missingInfo.length * 10;
      concerns.missingKeyInfo = true;
      missingInfo.forEach(info => warnings.push(`Missing important info: ${info}`));
    }

    // 4. CHECK FOR SUSPICIOUS PATTERNS
    const suspiciousPatterns = [
      'no refunds', 'all sales final', 'non-refundable', 'no returns',
      'we are not responsible', 'buyer beware', 'as is',
      'no warranty', 'no guarantee', 'use at your own risk'
    ];
    
    const suspiciousCount = suspiciousPatterns.filter(pattern => lowerContent.includes(pattern)).length;
    if (suspiciousCount >= 4) {
      score -= 25;
      concerns.suspiciousPatterns = true;
      redFlags.push('Contains multiple consumer-unfriendly terms');
      warnings.push('Policy heavily favors the seller with little customer protection');
    } else if (suspiciousCount >= 2) {
      score -= 10;
      concerns.suspiciousPatterns = true;
      warnings.push('Policy contains some unfavorable terms for customers');
    }

    // 5. CHECK CONTENT QUALITY
    const avgSentenceLength = wordCount / Math.max(sentenceCount, 1);
    const hasPunctuation = content.match(/[.!?,;:]/) !== null;
    const hasProperCapitalization = content.match(/[A-Z]/) !== null;
    
    if (!hasPunctuation || !hasProperCapitalization || avgSentenceLength < 5) {
      score -= 15;
      concerns.poorQuality = true;
      warnings.push('Policy text appears poorly formatted or unprofessional');
    }

    // 6. CHECK FOR PLACEHOLDER TEXT
    const placeholderPatterns = [
      '[company name]', '[insert', 'lorem ipsum', 'xxx', 'tbd',
      '[your company]', '[business name]', 'example.com'
    ];
    
    if (placeholderPatterns.some(pattern => lowerContent.includes(pattern))) {
      score -= 50;
      concerns.poorQuality = true;
      redFlags.push('Contains placeholder text - policy is incomplete');
      warnings.push('This policy has not been properly customized');
    }

    // 7. CHECK FOR GIBBERISH OR REPEATED TEXT
    const words = content.split(/\s+/);
    const uniqueWords = new Set(words.map(w => w.toLowerCase()));
    const uniqueRatio = uniqueWords.size / Math.max(words.length, 1);
    
    if (uniqueRatio < 0.3 && wordCount > 50) {
      score -= 20;
      concerns.poorQuality = true;
      warnings.push('Policy contains excessive repetition or filler text');
    }

    // 8. CHECK FOR COMPLETE ABSENCE OF KEY TERMS
    const essentialTerms = ['customer', 'buyer', 'purchase', 'order', 'product', 'service'];
    const hasEssentialTerms = essentialTerms.some(term => lowerContent.includes(term));
    
    if (!hasEssentialTerms && wordCount > 50) {
      score -= 30;
      concerns.poorQuality = true;
      redFlags.push('Policy lacks basic commerce terminology');
      warnings.push('This may not be a genuine policy page');
    }

    // Ensure score stays within 0-100 range
    score = Math.max(0, Math.min(100, score));

    // Determine if legitimate based on score (stricter threshold)
    // Score >= 70 and no red flags = legitimate
    // Score 50-69 = borderline (show warnings)
    // Score < 50 or has red flags = not legitimate
    const isLegitimate = score >= 70 && redFlags.length === 0;
    
    // Add borderline warning if score is between 50-69
    if (score >= 50 && score < 70 && redFlags.length === 0) {
      warnings.unshift('⚠️ This policy has some quality concerns - review carefully before purchasing');
    }
    
    // Add critical warning if score is below 50
    if (score < 50) {
      warnings.unshift('🚨 This policy has significant quality issues - proceed with extreme caution');
    }

    return {
      isLegitimate,
      score,
      warnings,
      redFlags,
      concerns,
    };
  }

  /**
   * Check for missing key information based on policy type
   */
  private static checkMissingKeyInfo(content: string, policyType: string): string[] {
    const missing: string[] = [];

    switch (policyType) {
      case 'returnRefund':
        if (!content.includes('day') && !content.includes('week') && !content.includes('month')) {
          missing.push('Time frame for returns/refunds');
        }
        if (!content.includes('condition') && !content.includes('original packaging') && !content.includes('unused')) {
          missing.push('Condition requirements for returns');
        }
        if (!content.includes('refund') && !content.includes('exchange') && !content.includes('credit')) {
          missing.push('Refund method or process');
        }
        break;

      case 'shipping':
        if (!content.includes('day') && !content.includes('business day') && !content.includes('delivery')) {
          missing.push('Delivery timeframe');
        }
        if (!content.includes('cost') && !content.includes('fee') && !content.includes('free') && !content.includes('charge')) {
          missing.push('Shipping costs');
        }
        break;

      case 'privacy':
        if (!content.includes('personal information') && !content.includes('personal data') && !content.includes('collect')) {
          missing.push('What personal information is collected');
        }
        if (!content.includes('use') && !content.includes('purpose')) {
          missing.push('How personal data is used');
        }
        if (!content.includes('share') && !content.includes('third party') && !content.includes('disclose')) {
          missing.push('Whether data is shared with third parties');
        }
        break;

      case 'terms':
        if (!content.includes('agree') && !content.includes('accept') && !content.includes('consent')) {
          missing.push('User agreement language');
        }
        if (!content.includes('liability') && !content.includes('responsible')) {
          missing.push('Liability terms');
        }
        break;
    }

    return missing;
  }
}
