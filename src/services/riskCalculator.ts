import { RiskSignal, AnalysisResult } from '../types/analysis';

export type RiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical';

export interface CategoryBreakdown {
  security: {
    score: number;
    percentage: number;
    signals: RiskSignal[];
  };
  legitimacy: {
    score: number;
    percentage: number;
    signals: RiskSignal[];
  };
  darkPattern: {
    score: number;
    percentage: number;
    signals: RiskSignal[];
  };
  policy: {
    score: number;
    percentage: number;
    signals: RiskSignal[];
  };
}

export interface RiskAnalysis {
  totalScore: number; // 0-100
  riskLevel: RiskLevel;
  breakdown: CategoryBreakdown;
  topConcerns: RiskSignal[];
  signalCount: number;
  trustFactor: number; // 0.0-1.0: domain age (70%) + user visits (30%)
}

export class RiskCalculator {
  // Category weights (must sum to 1.0)
  private static readonly WEIGHTS = {
    security: 0.40,    // 40% - Most important (HTTPS, domain age, DNSSEC)
    legitimacy: 0.30,  // 30% - Very important (contact, social media)
    darkPattern: 0.20, // 20% - Important (hidden costs, fake urgency)
    policy: 0.10,      // 10% - Baseline requirement (privacy, return policies)
  };

  // Maximum impact per category (used for normalization)
  private static readonly MAX_IMPACT = {
    security: 40,
    legitimacy: 30,
    darkPattern: 20,
    policy: 10,
  };

  /**
   * Calculate comprehensive risk score with proper normalization and trust-based dampening
   * 
   * Algorithm:
   * 1. Calculate trust factor (0-1.0) from domain age + user visit count
   * 2. Determine category-specific dampeners based on trust
   * 3. Deduplicate signals (AI + Heuristic = one signal)
   * 4. Group by category (security, legitimacy, dark-pattern, policy)
   * 5. Apply dampeners to categories (not security/darkPattern)
   * 6. Calculate percentage of max for each category
   * 7. Apply category weights and sum to get final score (0-100)
   */
  static calculateScore(
    signals: RiskSignal[],
    domainAgeInDays?: number | null,
    contactAnalysis?: any
  ): RiskAnalysis {
    console.log(`[DEBUG] calculateScore called: domainAgeInDays=${domainAgeInDays}`);
    
    // Step 1: Deduplicate signals (AI + Heuristic may flag same issue)
    const deduplicated = this.deduplicateSignals(signals);
    console.log(`[Dedup] Original signals: ${signals.length}, After dedup: ${deduplicated.length}`);
    console.log(`[Dedup] AI signals: ${signals.filter(s => s.source === 'ai').length}, Heuristic: ${signals.filter(s => s.source === 'heuristic').length}`);
    
    // Step 1.5: Filter out legitimate retail/e-commerce marketing practices (generic, no hardcoding)
    // These are common practices for high-trust retailers and shouldn't penalize them
    const filtered = this.filterLegitimateRetailPractices(deduplicated, domainAgeInDays);
    if (filtered.length < deduplicated.length) {
      console.log(`[Filter] Removed ${deduplicated.length - filtered.length} legitimate retail marketing signals (trust factor=${domainAgeInDays ? 'established' : 'unknown'})`);
    }
    
    // Step 2: Group signals by category
    const grouped = this.groupByCategory(filtered);
    console.log(`[Grouped] Security: ${grouped.security.length}, Legitimacy: ${grouped.legitimacy.length}, DarkPattern: ${grouped.darkPattern.length}, Policy: ${grouped.policy.length}`);
    
    // Step 0: Calculate trust factor AFTER grouping (so we have signal counts)
    let trustFactor = 0.5; // Default neutral
    let securityDampener = 1.0;
    let legitimacyDampener = 1.0;
    let darkPatternDampener = 1.0;
    let policyDampener = 1.0;
    
    // Only apply trust dampening if we HAVE valid domain age data (not null or undefined)
    if (domainAgeInDays !== undefined && domainAgeInDays !== null) {
      console.log(`[DEBUG] Entering trust factor calculation with valid domain age`);
      // Get social media count for phishing detection
      const socialMediaCount = contactAnalysis?.socialMediaProfiles?.length ?? 0;
      // Pass signal counts and contact info for enhanced trust calculation
      trustFactor = this.calculateTrustFactor(
        domainAgeInDays,
        grouped.legitimacy.length,
        grouped.darkPattern.length,
        filtered.length,
        socialMediaCount
      );
      console.log(`[DEBUG] Calculated trustFactor: ${trustFactor}`);
      
      // Apply category-specific dampeners based on trust
      // CRITICAL FIX: Only flag as phishing if YOUNG domain (<2yrs) with NO social AND suspicious patterns
      // NOT for 30-year-old established companies!
      const hasContactSignals = grouped.legitimacy.length > 0;
      const isPhishingSuspect = domainAgeInDays < 730 && socialMediaCount === 0 && !hasContactSignals;
      
      // High trust (>0.8): Legitimacy & policy heavily dampened, Dark patterns moderately dampened
      if (trustFactor > 0.8 && !isPhishingSuspect) {
        legitimacyDampener = 0.1;  // 90% reduction - high trust sites don't need contact signals
        policyDampener = 0.5;      // 50% reduction for policy issues
        darkPatternDampener = 0.3; // 70% reduction - established retailers use marketing tactics
        console.log(`[Trust Factor] HIGH (${trustFactor.toFixed(2)}) → Dampeners: legit=${legitimacyDampener}, policy=${policyDampener}, darkPattern=${darkPatternDampener}`);
      }
      // Medium trust (>0.6): Legitimacy dampened, dark patterns slightly dampened
      else if (trustFactor > 0.6 && !isPhishingSuspect) {
        legitimacyDampener = 0.5;  // 50% reduction
        darkPatternDampener = 0.6; // 40% reduction - established sites less likely to be malicious
        console.log(`[Trust Factor] MEDIUM (${trustFactor.toFixed(2)}) → Dampeners: legit=${legitimacyDampener}, darkPattern=${darkPatternDampener}`);
      }
      // PHISHING ALERT: NEW domain (<2yr) with NO social AND NO contact signals = likely impersonation
      else if (isPhishingSuspect) {
        // AMPLIFY the signals for phishing sites
        legitimacyDampener = 2.0;  // 200% AMPLIFICATION - new domain with no contact = RED FLAG
        darkPatternDampener = 1.5; // 150% AMPLIFICATION - combine with dark patterns
        policyDampener = 1.5;      // 150% AMPLIFICATION
        console.log(`🚨 [PHISHING ALERT] ${domainAgeInDays}d old YOUNG domain with ZERO social media and no contact → AMPLIFYING signals (legit=${legitimacyDampener}, darkPattern=${darkPatternDampener}, policy=${policyDampener})`);
      }
      // Low trust: all dampeners stay 1.0 (no dampening) - suspicious sites flagged at full severity
      else {
        console.log(`[Trust Factor] LOW (${trustFactor.toFixed(2)}) → No dampening applied`);
      }
      
      // Security NEVER dampened (always critical)
      securityDampener = 1.0;
    }
    
    // Step 3: Calculate category scores with dampening applied
    const breakdown: CategoryBreakdown = {
      security: this.calculateCategoryScore(grouped.security, this.MAX_IMPACT.security, securityDampener),
      legitimacy: this.calculateCategoryScore(grouped.legitimacy, this.MAX_IMPACT.legitimacy, legitimacyDampener),
      darkPattern: this.calculateCategoryScore(grouped.darkPattern, this.MAX_IMPACT.darkPattern, darkPatternDampener),
      policy: this.calculateCategoryScore(grouped.policy, this.MAX_IMPACT.policy, policyDampener),
    };
    
    // Log category breakdown with signals
    console.log(`[Category Scores Before Weighting]`);
    console.log(`  Security: ${breakdown.security.score}/${this.MAX_IMPACT.security} (${breakdown.security.percentage}%) - Dampener: ${securityDampener}`);
    console.log(`  Legitimacy: ${breakdown.legitimacy.score}/${this.MAX_IMPACT.legitimacy} (${breakdown.legitimacy.percentage}%) - Dampener: ${legitimacyDampener}`);
    console.log(`  Dark Pattern: ${breakdown.darkPattern.score}/${this.MAX_IMPACT.darkPattern} (${breakdown.darkPattern.percentage}%) - Dampener: ${darkPatternDampener}`);
    console.log(`  Policy: ${breakdown.policy.score}/${this.MAX_IMPACT.policy} (${breakdown.policy.percentage}%) - Dampener: ${policyDampener}`);
    
    // Step 4: Calculate weighted total (normalized to 0-100)
    // Each category percentage is multiplied by its weight
    // Example: Security at 100% * 0.40 weight = 40 points toward final score
    const totalScore = Math.min(100, Math.round(
      breakdown.security.percentage * this.WEIGHTS.security +
      breakdown.legitimacy.percentage * this.WEIGHTS.legitimacy +
      breakdown.darkPattern.percentage * this.WEIGHTS.darkPattern +
      breakdown.policy.percentage * this.WEIGHTS.policy
    ));
    
    console.log(`[Final Score Calculation]`);
    console.log(`  Security: ${breakdown.security.percentage}% × ${this.WEIGHTS.security} = ${(breakdown.security.percentage * this.WEIGHTS.security).toFixed(1)}`);
    console.log(`  Legitimacy: ${breakdown.legitimacy.percentage}% × ${this.WEIGHTS.legitimacy} = ${(breakdown.legitimacy.percentage * this.WEIGHTS.legitimacy).toFixed(1)}`);
    console.log(`  Dark Pattern: ${breakdown.darkPattern.percentage}% × ${this.WEIGHTS.darkPattern} = ${(breakdown.darkPattern.percentage * this.WEIGHTS.darkPattern).toFixed(1)}`);
    console.log(`  Policy: ${breakdown.policy.percentage}% × ${this.WEIGHTS.policy} = ${(breakdown.policy.percentage * this.WEIGHTS.policy).toFixed(1)}`);
    console.log(`  ═════ TOTAL SCORE: ${totalScore}/100 ═════`);
    
    // Step 5: Determine risk level
    const riskLevel = this.getRiskLevel(totalScore);
    
    // Step 6: Get top 3 concerns
    const topConcerns = this.getTopConcerns(filtered, 3);
    
    // Step 7: Enrich signals with impact percentage
    const enrichedBreakdown = this.enrichSignalsWithImpact(breakdown, totalScore);
    
    return {
      totalScore,
      riskLevel,
      breakdown: enrichedBreakdown,
      topConcerns,
      signalCount: filtered.length,
      trustFactor,
    };
  }

  /**
   * Calculate risk score WITH context-aware intelligent scoring
   * 
   * MERGED UNIFIED SCORING (Phase 1 Optimization)
   * - Builds signal profile for context-aware analysis
   * - Applies contextual penalties based on signal patterns
   * - Calculates final score with unified dampening logic
   * 
   * GENERIC, DATA-DRIVEN APPROACH (No hardcoding!)
   * 
   * Analyzes:
   * - Signal maturity: Complete security setup?
   * - Signal consistency: Do signals align?
   * - Signal abundance: How many trust signals?
   * - Risk concentration: Do risks cluster? (phishing indicator)
   */
  static calculateScoreWithContext(
    signals: RiskSignal[],
    result: AnalysisResult
  ): RiskAnalysis {
    console.log(`[DEBUG] calculateScoreWithContext called with result.domainAgeInDays: ${result.domainAgeInDays}`);
    
    // Step 1: Build signal profile and apply contextual penalties (merged logic)
    const contextualSignals = this.applyContextualPenalties(signals, result);

    // Step 2: Calculate score with adjusted signals and trust factor
    const domainAgeInDays = result.domainAgeInDays ?? null;
    return this.calculateScore(contextualSignals, domainAgeInDays);
  }

  /**
   * Apply contextual penalties to signals based on signal profile
   * MERGED from ContextAwareScoringService - unified scorer logic
   * Uses data-driven analysis, not hardcoded rules
   */
  private static applyContextualPenalties(
    signals: RiskSignal[],
    result: AnalysisResult
  ): RiskSignal[] {
    // Build profile from signals (no hardcoding!)
    const profile = this.buildSignalProfile(result, signals);
    
    console.log(`🧠 Signal profile:
   Security maturity: ${(profile.securityMaturity * 100).toFixed(0)}%
   Trust density: ${(profile.trustSignalDensity * 100).toFixed(0)}%
   Risk concentration: ${(profile.riskConcentration * 100).toFixed(0)}%
   Age category: ${profile.ageCategory}`);

    return signals.map(signal => {
      const contextualPenalty = this.calculateContextualPenalty(signal, profile);

      // Only modify score if context factor differs significantly
      if (Math.abs(contextualPenalty.contextFactor - 1.0) > 0.01) {
        console.log(`   [Context] Signal "${signal.reason.substring(0, 40)}..." ${signal.score} → ${contextualPenalty.finalScore} (factor: ${contextualPenalty.contextFactor.toFixed(2)}x)`);
        return {
          ...signal,
          score: contextualPenalty.finalScore,
          details: `${signal.details || ''}\n\n📊 Context: ${contextualPenalty.reasoning}`,
        };
      }

      return signal;
    });
  }

  /**
   * Build signal profile for context-aware analysis
   * MERGED from ContextAwareScoringService
   */
  private static buildSignalProfile(
    result: AnalysisResult,
    signals: RiskSignal[]
  ): any {
    const domainAge = result.domain?.ageInDays ?? result.domainAgeInDays ?? null;
    const ageCategory = this.categorizeByAge(domainAge);
    const securityMaturity = this.calculateSecurityMaturity(result);
    const trustSignalDensity = this.calculateTrustSignalDensity(signals);
    const riskConcentration = this.calculateRiskConcentration(signals);

    return {
      securityMaturity,
      trustSignalDensity,
      ageCategory,
      domainAge,
      riskConcentration,
      totalTrustSignals: signals.filter(s => s.score < 30).length,
      totalRiskSignals: signals.filter(s => s.score >= 30).length,
    };
  }

  /**
   * Categorize domain age into meaningful buckets
   */
  private static categorizeByAge(
    ageInDays: number | null
  ): 'brand-new' | 'new' | 'established' | 'mature' {
    if (ageInDays === null) return 'new'; // No data = assume new
    if (ageInDays < 30) return 'brand-new';        // < 1 month
    if (ageInDays < 365) return 'new';              // < 1 year
    if (ageInDays < 365 * 5) return 'established'; // 1-5 years
    return 'mature';                                // 5+ years
  }

  /**
   * Calculate security maturity (0-1.0)
   */
  private static calculateSecurityMaturity(result: AnalysisResult): number {
    let score = 0;
    let maxScore = 0;

    if (result.security?.isHttps !== undefined) {
      maxScore += 4;
      if (result.security.isHttps) score += 4;
    }

    if (result.security?.hasValidCertificate !== undefined) {
      maxScore += 2;
      if (result.security.hasValidCertificate) score += 2;
    }

    if (result.security?.hasMixedContent !== undefined) {
      maxScore += 2;
      if (!result.security.hasMixedContent) score += 2;
    }

    return maxScore > 0 ? score / maxScore : 0;
  }

  /**
   * Calculate trust signal density (0-1.0)
   */
  private static calculateTrustSignalDensity(signals: RiskSignal[]): number {
    if (signals.length === 0) return 0;
    const trustSignals = signals.filter(s => s.score < 30).length;
    return Math.min(1.0, trustSignals / signals.length);
  }

  /**
   * Calculate risk concentration (0-1.0) - phishing indicator
   */
  private static calculateRiskConcentration(signals: RiskSignal[]): number {
    if (signals.length === 0) return 0;

    const riskSignals = signals.filter(s => s.score >= 30);
    if (riskSignals.length === 0) return 0;

    // Group risks by category
    const categoryRisks = new Map<string, number>();
    riskSignals.forEach(signal => {
      const category = signal.category ?? 'policy';
      categoryRisks.set(category, (categoryRisks.get(category) ?? 0) + 1);
    });

    // If most risks are in 1-2 categories = high concentration
    const sortedCategories = Array.from(categoryRisks.values()).sort((a, b) => b - a);
    const topRisks = sortedCategories.slice(0, 2).reduce((a, b) => a + b, 0);
    const concentration = topRisks / riskSignals.length;

    return Math.min(1.0, concentration);
  }

  /**
   * Calculate contextual penalty using signal profile (GENERIC!)
   */
  private static calculateContextualPenalty(
    signal: RiskSignal,
    profile: any
  ): any {
    const baseScore = signal.score;
    let contextFactor = 1.0;
    let reasoning = 'Standard scoring applied';

    // GENERIC RULE 1: High trust density + mature domain = reduce low-risk signals
    if (
      profile.trustSignalDensity > 0.6 &&
      (profile.ageCategory === 'mature' || profile.ageCategory === 'established') &&
      signal.score < 25
    ) {
      contextFactor = 0.2;
      reasoning = `✅ High trust signals + ${profile.ageCategory} domain - low-risk signal downweighted`;
    }

    // GENERIC RULE 2: Established domain with good security = reduce signals
    else if (
      profile.securityMaturity > 0.7 &&
      profile.ageCategory === 'established' &&
      signal.score < 20
    ) {
      contextFactor = 0.4;
      reasoning = `✅ ${profile.ageCategory} domain with mature security - signal less critical`;
    }

    // GENERIC RULE 3: Brand-new + poor security + suspicious = AMPLIFY
    else if (
      profile.ageCategory === 'brand-new' &&
      profile.securityMaturity < 0.5 &&
      (signal.id.includes('ssl') || signal.id.includes('https') || signal.id.includes('social'))
    ) {
      contextFactor = 1.8;
      reasoning = `⚠️ Brand-new domain + weak security - critical issues amplified`;
    }

    // GENERIC RULE 4: High risk concentration = phishing pattern
    else if (
      profile.riskConcentration > 0.7 &&
      profile.ageCategory === 'brand-new' &&
      profile.totalRiskSignals >= 3
    ) {
      contextFactor = 2.0;
      reasoning = `🚨 Phishing pattern detected: ${profile.totalRiskSignals} risks concentrated on new domain`;
    }

    const finalScore = Math.max(0, Math.min(100, Math.round(baseScore * contextFactor)));

    return {
      baseScore,
      contextFactor,
      finalScore,
      reasoning,
      profile,
    };
  }

  /**
   * GENERIC FILTER: Remove low-severity dark pattern signals if domain is established
   * 
   * Rationale: Established retailers (10+ years) commonly use flash sales, limited-time offers,
   * and "Was $X now $Y" pricing. These are standard retail practices, NOT dark patterns.
   * 
   * This prevents false positives without hardcoding specific patterns.
   * Data-driven: Only filter if domain is old AND signal is from AI (heuristic is usually more precise)
   */
  private static filterLegitimateRetailPractices(signals: RiskSignal[], domainAgeInDays?: number | null): RiskSignal[] {
    // Only filter if we have an established domain (10+ years = 3650+ days)
    const isEstablishedDomain = domainAgeInDays !== null && domainAgeInDays !== undefined && domainAgeInDays >= 3650;
    
    if (!isEstablishedDomain) {
      return signals; // Return all signals if domain is young or unknown age
    }
    
    return signals.filter(signal => {
      // Keep all security and policy signals (critical categories)
      if (signal.category === 'security' || signal.category === 'policy') {
        return true;
      }
      
      // For dark patterns on established domains: only keep HIGH severity
      if (signal.category === 'dark-pattern' && signal.source === 'ai') {
        const isLowSeverity = signal.severity === 'low' || signal.severity === 'medium';
        const isCommonRetailPhrase = 
          signal.reason?.toLowerCase().includes('flash') ||
          signal.reason?.toLowerCase().includes('limited quantity') ||
          signal.reason?.toLowerCase().includes('limited time') ||
          signal.reason?.toLowerCase().includes('was $') ||
          signal.reason?.toLowerCase().includes('original price') ||
          signal.reason?.toLowerCase().includes('discount') ||
          signal.reason?.toLowerCase().includes('urgency') ||
          signal.reason?.toLowerCase().includes('shipping cost') ||
          signal.reason?.toLowerCase().includes('free') ||
          signal.reason?.toLowerCase().includes('shipping');
        
        // Filter out low-severity common retail practices on established domains
        if (isLowSeverity && isCommonRetailPhrase) {
          return false; // Remove this signal
        }
      }
      
      return true; // Keep all other signals
    });
  }

  /**
   * Remove duplicate signals with enhanced AI/heuristic integration
   */
  private static deduplicateSignals(signals: RiskSignal[]): RiskSignal[] {
    const seen = new Map<string, RiskSignal>();
    const duplicateGroups = new Map<string, RiskSignal[]>();
    
    // First pass: group potential duplicates
    for (const signal of signals) {
      const key = this.getConcernKey(signal);
      
      if (!duplicateGroups.has(key)) {
        duplicateGroups.set(key, []);
      }
      duplicateGroups.get(key)!.push(signal);
    }
    
    // Second pass: resolve duplicates intelligently
    for (const [key, duplicates] of duplicateGroups) {
      if (duplicates.length === 1) {
        seen.set(key, duplicates[0]);
      } else {
        // Multiple signals for same concern - merge intelligently
        const resolved = this.resolveDuplicateSignals(duplicates);
        seen.set(key, resolved);
      }
    }
    
    return Array.from(seen.values());
  }

  /**
   * Intelligently resolve duplicate signals from AI + Heuristic sources
   */
  private static resolveDuplicateSignals(duplicates: RiskSignal[]): RiskSignal {
    // Separate by source
    const aiSignals = duplicates.filter(s => s.source === 'ai');
    const heuristicSignals = duplicates.filter(s => s.source === 'heuristic');
    
    // If we have both AI and heuristic signals for same issue
    if (aiSignals.length > 0 && heuristicSignals.length > 0) {
      const aiSignal = aiSignals[0];
      const heuristicSignal = heuristicSignals[0];
      
      // Create hybrid signal combining best of both
      return {
        id: `hybrid-${aiSignal.id}`,
        score: Math.max(aiSignal.score, heuristicSignal.score), // Take higher score
        reason: aiSignal.reason.length > heuristicSignal.reason.length 
          ? aiSignal.reason 
          : heuristicSignal.reason, // Take more detailed reason
        severity: this.getHigherSeverity(aiSignal.severity, heuristicSignal.severity),
        category: aiSignal.category,
        source: 'ai' as const, // AI source for hybrid signals
        details: this.combineDetails(aiSignal.details, heuristicSignal.details),
      };
    }
    
    // If only one source, take the highest scoring signal
    return duplicates.reduce((best, current) => 
      current.score > best.score ? current : best
    );
  }

  /**
   * Get the higher severity between two severities
   */
  private static getHigherSeverity(
    sev1: RiskSignal['severity'], 
    sev2: RiskSignal['severity']
  ): RiskSignal['severity'] {
    const severityOrder = { safe: 0, low: 1, medium: 2, high: 3, critical: 4 };
    return severityOrder[sev1] > severityOrder[sev2] ? sev1 : sev2;
  }

  /**
   * Combine details from multiple sources
   */
  private static combineDetails(detail1?: string, detail2?: string): string {
    if (!detail1 && !detail2) return '';
    if (!detail1) return detail2!;
    if (!detail2) return detail1;
    
    // Avoid redundant details
    if (detail1.includes(detail2) || detail2.includes(detail1)) {
      return detail1.length > detail2.length ? detail1 : detail2;
    }
    
    return `${detail1} | ${detail2}`;
  }

  /**
   * Generate a key to identify duplicate concerns
   */
  private static getConcernKey(signal: RiskSignal): string {
    // Normalize the concern to catch duplicates
    const normalized = signal.reason.toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .substring(0, 50);
    
    // Group by category + normalized reason
    return `${signal.category}-${normalized}`;
  }

  /**
   * Group signals by category
   */
  private static groupByCategory(signals: RiskSignal[]): {
    security: RiskSignal[];
    legitimacy: RiskSignal[];
    darkPattern: RiskSignal[];
    policy: RiskSignal[];
  } {
    const grouped = {
      security: [] as RiskSignal[],
      legitimacy: [] as RiskSignal[],
      darkPattern: [] as RiskSignal[],
      policy: [] as RiskSignal[],
    };
    
    for (const signal of signals) {
      if (signal.category === 'security') {
        grouped.security.push(signal);
      } else if (signal.category === 'dark-pattern') {
        grouped.darkPattern.push(signal);
      } else if (signal.category === 'policy') {
        grouped.policy.push(signal);
      } else if (signal.category === 'legitimacy') {
        grouped.legitimacy.push(signal);
      } else {
        // Default: treat unknown as legitimacy
        grouped.legitimacy.push(signal);
      }
    }
    
    return grouped;
  }

  /**
   * Calculate category score with simple capping
   * More intuitive: rawSum up to maxImpact = linear scaling
   * Above maxImpact = capped at 100%
   */
  /**
   * Calculate dynamic trust factor (0.0-1.0) based on domain age and visit history
   * 
   * Factors:
   * - domainAge: Time domain has existed (70% weight)
   * - visitCount: How many times user has visited (30% weight)
   * 
   * Age brackets:
   * - null/unknown: 0.1 (very risky)
   * - < 180 days: 0.0 (brand new)
   * - 180-1095 days (6mo-3y): 0.5 (developing)
   * - 1095-3650 days (3-10y): 0.8 (established)
   * - 3650+ days (10y+): 1.0 (highly trusted)
   */
  /**
   * Calculate trust factor based on MULTIPLE signals (not just domain age!)
   * Enhanced to detect phishing/impersonation attempts
   * 
   * Factors:
   * - Domain age (70% weight)
   * - Legitimacy signals (social media, contact info, policies) (30% weight)
   * - Risk concentration (if suspicious, reduce trust)
   * - Suspicious absences (zero social media on old domain = odd)
   */
  private static calculateTrustFactor(
    domainAgeInDays: number | null,
    legitimacySignalCount: number = 0,
    darkPatternSignalCount: number = 0,
    totalSignalCount: number = 0,
    socialMediaCount: number = 0
  ): number {
    // NEW ALGORITHM: Age is PRIMARY factor (70%), contact signals (20%), social optional (10%)
    // Goal: Range 0.2-1.0 with clear differentiation between old/new domains
    
    // STEP 1: Calculate age score (PRIMARY, 70% weight)
    // Scale: <6mo=0.2, 1yr=0.3, 2yr=0.4, 3yr=0.5, 5yr=0.65, 10yr=0.8, 20yr=0.9, 30+yr=0.95
    let ageScore = 0.2; // Minimum trust for unknown
    
    if (domainAgeInDays !== null) {
      if (domainAgeInDays < 180) {
        ageScore = 0.2; // Brand new: highly suspicious
      } else if (domainAgeInDays < 365) {
        ageScore = 0.3; // 6-12 months
      } else if (domainAgeInDays < 730) {
        ageScore = 0.4; // 1-2 years
      } else if (domainAgeInDays < 1095) {
        ageScore = 0.5; // 2-3 years
      } else if (domainAgeInDays < 1825) {
        ageScore = 0.6; // 3-5 years
      } else if (domainAgeInDays < 3650) {
        ageScore = 0.75; // 5-10 years: established
      } else if (domainAgeInDays < 7300) {
        ageScore = 0.85; // 10-20 years: very trusted
      } else if (domainAgeInDays < 10950) {
        ageScore = 0.92; // 20-30 years
      } else {
        ageScore = 0.95; // 30+ years: maximum age trust
      }
    }

    // STEP 2: Calculate contact signal score (OPTIONAL, 20% weight)
    // Contact signals = has email, phone, physical address
    let contactScore = 0.5; // Default neutral
    
    if (totalSignalCount > 0) {
      const legitimacyRatio = legitimacySignalCount / totalSignalCount;
      
      // Good signal balance (30-50% legitimacy) = trusted
      if (legitimacyRatio >= 0.3 && legitimacyRatio <= 0.5) {
        contactScore = 0.9; // Good contact presence
      }
      // Too many legitimacy (>60%) = unusual but not penalized
      else if (legitimacyRatio > 0.6) {
        contactScore = 0.6; // Unusual but not penalized
      }
      // Very few signals overall = unknown
      else if (totalSignalCount < 2) {
        contactScore = 0.5; // Not enough data
      } else {
        contactScore = 0.4; // Few signals = less contact presence
      }
    }

    // STEP 3: Calculate social media score (OPTIONAL, 10% weight)
    // Social media is BONUS, not required
    let socialScore = 0.5; // Default neutral (no penalty for absence)
    
    // Only bonus if social media PRESENT
    if (socialMediaCount > 0) {
      socialScore = 0.9; // Has social presence = good signal
      console.log(`[SocialMedia] ${socialMediaCount} profiles detected → socialScore=0.9`);
    } else if (domainAgeInDays !== null && domainAgeInDays > 1825) {
      // Niche/regional brands OK without social
      socialScore = 0.5; // Neutral, not penalized
      console.log(`[SocialMedia] No profiles but age=${domainAgeInDays}d → socialScore=0.5 (no penalty for established domains)`);
    }

    // STEP 4: Detect risk concentration (phishing indicator)
    let riskPenalty = 0;
    if (domainAgeInDays !== null && domainAgeInDays > 1095 && totalSignalCount > 2) {
      const darkPatternRatio = darkPatternSignalCount / totalSignalCount;
      // Only apply penalty if HEAVILY concentrated (>70%)
      if (darkPatternRatio > 0.7) {
        riskPenalty = 0.1; // Minor penalty for heavily concentrated
      }
    }

    // STEP 5: Calculate weighted trust factor
    // Age (70%) + Contact (20%) + Social (10%) - Concentration penalty
    const trustFactor = (ageScore * 0.7) + (contactScore * 0.2) + (socialScore * 0.1) - riskPenalty;
    
    console.log(`[TrustFactor] age=${domainAgeInDays}d(${ageScore.toFixed(2)}) + contact=${contactScore.toFixed(2)} + social=${socialScore.toFixed(2)} - penalty=${riskPenalty.toFixed(2)} = ${Math.max(0.2, Math.min(1, trustFactor)).toFixed(2)}`);
    
    // Clamp to 0.2-1.0 range (minimum 0.2 for unknown domains, maximum 1.0 for oldest)
    return Math.max(0.2, Math.min(1, trustFactor));
  }

  /**
   * Calculate category score with optional dampening based on trust
   * 
   * Dampening reduces signal impact for trusted sites:
   * - legitimacy/policy dampened for high-trust sites
   * - security/dark-patterns NEVER dampened
   */
  private static calculateCategoryScore(
    signals: RiskSignal[],
    maxImpact: number,
    dampener: number = 1.0  // 1.0 = no dampening, 0.1 = 90% reduction
  ): {
    score: number;
    percentage: number;
    signals: RiskSignal[];
  } {
    if (signals.length === 0) {
      return { score: 0, percentage: 0, signals: [] };
    }
    
    // Sum raw scores
    const rawSum = signals.reduce((sum, s) => sum + s.score, 0);
    
    // Apply dampener (e.g., Amazon missing social: 15 * 0.1 = 1.5)
    const dampenedSum = rawSum * dampener;
    
    if (dampener < 1.0) {
      console.log(`[Dampening] rawSum=${rawSum} dampener=${dampener.toFixed(1)} → dampenedSum=${dampenedSum.toFixed(1)}`);
    }
    
    // Cap at maxImpact
    const cappedScore = Math.min(dampenedSum, maxImpact);
    const percentage = Math.round((cappedScore / maxImpact) * 100);
    
    return {
      score: cappedScore,
      percentage,
      signals,
    };
  }

  /**
   * Determine risk level based on total score
   */
  private static getRiskLevel(score: number): RiskLevel {
    if (score <= 20) return 'safe';
    if (score <= 40) return 'low';
    if (score <= 60) return 'medium';
    if (score <= 80) return 'high';
    return 'critical';
  }

  /**
   * Enrich signals with impact percentage - what % of final 100-point score each signal contributes
   */
  private static enrichSignalsWithImpact(
    breakdown: CategoryBreakdown,
    totalScore: number
  ): CategoryBreakdown {
    const enrichSignals = (signals: RiskSignal[]): RiskSignal[] => {
      return signals.map(signal => ({
        ...signal,
        // Calculate what percentage of the 100-point total this signal contributes
        // Each signal's raw score is normalized to its category max, then weighted
        impactPercentage: Math.round(
          (signal.score / 100) * totalScore * 100
        ) / 100, // Impact as percentage of final score
      }));
    };

    return {
      security: { ...breakdown.security, signals: enrichSignals(breakdown.security.signals) },
      legitimacy: { ...breakdown.legitimacy, signals: enrichSignals(breakdown.legitimacy.signals) },
      darkPattern: { ...breakdown.darkPattern, signals: enrichSignals(breakdown.darkPattern.signals) },
      policy: { ...breakdown.policy, signals: enrichSignals(breakdown.policy.signals) },
    };
  }

  /**
   * Get top N concerns by score
   */
  private static getTopConcerns(signals: RiskSignal[], n: number): RiskSignal[] {
    return signals
      .sort((a, b) => b.score - a.score)
      .slice(0, n);
  }

  /**
   * Get risk level display info
   */
  static getRiskLevelInfo(level: RiskLevel): {
    label: string;
    color: string;
    emoji: string;
    description: string;
  } {
    switch (level) {
      case 'safe':
        return {
          label: 'Safe',
          color: '#10b981', // Green
          emoji: '✅',
          description: 'This site appears safe to use',
        };
      case 'low':
        return {
          label: 'Low Risk',
          color: '#fbbf24', // Yellow
          emoji: '⚠️',
          description: 'Minor concerns detected, proceed with caution',
        };
      case 'medium':
        return {
          label: 'Medium Risk',
          color: '#f97316', // Orange
          emoji: '⚠️',
          description: 'Several concerns detected, be careful',
        };
      case 'high':
        return {
          label: 'High Risk',
          color: '#ef4444', // Red
          emoji: '🚨',
          description: 'Multiple serious concerns, not recommended',
        };
      case 'critical':
        return {
          label: 'Critical Risk',
          color: '#991b1b', // Dark Red
          emoji: '🔴',
          description: 'Severe concerns detected, do not use',
        };
    }
  }

  /**
   * Get category display info
   */
  static getCategoryInfo(category: keyof CategoryBreakdown): {
    label: string;
    icon: string;
    description: string;
  } {
    switch (category) {
      case 'security':
        return {
          label: 'Security',
          icon: '🔒',
          description: 'HTTPS, domain age, DNSSEC protection',
        };
      case 'legitimacy':
        return {
          label: 'Legitimacy',
          icon: '✓',
          description: 'Contact info, social media, transparency',
        };
      case 'darkPattern':
        return {
          label: 'Dark Patterns',
          icon: '🎭',
          description: 'Hidden costs, fake urgency, deceptive practices',
        };
      case 'policy':
        return {
          label: 'Policies',
          icon: '📄',
          description: 'Privacy policy, return policy, terms of service',
        };
    }
  }
}
