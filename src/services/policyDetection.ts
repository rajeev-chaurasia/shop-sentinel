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
      
      // Combine results - both steps must pass
      const finalScore = Math.min(initialDetection.score, verificationResult.score);
      const isPolicyPage = finalScore >= 45;
      
      if (isPolicyPage) {
        const policyType = this.determinePolicyType(path, title, content);
        return {
          isPolicyPage: true,
          policyType,
          confidence: finalScore,
          url,
          title: document.title,
          content: document.body.innerText,
          signals: [...initialDetection.signals, ...verificationResult.signals]
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

    // URL-based detection (strongest signal)
    if (this.POLICY_KEYWORDS.some(keyword => path.includes(keyword))) {
      policyScore += 50;
      signals.push('policy-url');
    }

    // Title-based detection
    if (this.POLICY_KEYWORDS.some(keyword => title.includes(keyword))) {
      policyScore += 30;
      signals.push('policy-title');
    }

    // Basic content detection
    if (this.POLICY_CONTENT_INDICATORS.some(indicator => content.includes(indicator))) {
      policyScore += 25;
      signals.push('policy-content');
    }

    // Document structure detection
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
}
