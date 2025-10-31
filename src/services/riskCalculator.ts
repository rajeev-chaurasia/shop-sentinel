import { RiskSignal, AnalysisResult } from '../types/analysis';
import { ContextAwareScoringService } from './contextAwareScoring';

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
    
    // Step 2: Group signals by category
    const grouped = this.groupByCategory(deduplicated);
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
        deduplicated.length,
        socialMediaCount
      );
      console.log(`[DEBUG] Calculated trustFactor: ${trustFactor}`);
      
      // Apply category-specific dampeners based on trust
      // High trust (>0.8): Legitimacy & policy heavily dampened, Dark patterns moderately dampened
      if (trustFactor > 0.8) {
        legitimacyDampener = 0.1;  // 90% reduction for missing socials on Amazon
        policyDampener = 0.5;      // 50% reduction for policy issues
        darkPatternDampener = 0.3; // 70% reduction - established retailers use marketing tactics
        console.log(`[Trust Factor] HIGH (${trustFactor.toFixed(2)}) → Dampeners: legit=${legitimacyDampener}, policy=${policyDampener}, darkPattern=${darkPatternDampener}`);
      }
      // Medium trust (>0.6): Legitimacy dampened, dark patterns slightly dampened
      else if (trustFactor > 0.6) {
        legitimacyDampener = 0.5;  // 50% reduction
        darkPatternDampener = 0.6; // 40% reduction - established sites less likely to be malicious
        console.log(`[Trust Factor] MEDIUM (${trustFactor.toFixed(2)}) → Dampeners: legit=${legitimacyDampener}, darkPattern=${darkPatternDampener}`);
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
    const topConcerns = this.getTopConcerns(deduplicated, 3);
    
    // Step 7: Enrich signals with impact percentage
    const enrichedBreakdown = this.enrichSignalsWithImpact(breakdown, totalScore);
    
    return {
      totalScore,
      riskLevel,
      breakdown: enrichedBreakdown,
      topConcerns,
      signalCount: deduplicated.length,
      trustFactor,
    };
  }

  /**
   * Calculate risk score WITH context-aware intelligent scoring
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
    console.log(`[DEBUG] Full result object:`, result);
    
    // Step 1: Build signal-driven profile (NO hardcoded lists!)
    const profile = ContextAwareScoringService.buildSignalProfile(result, signals);
    console.log(`🧠 Signal profile: ${ContextAwareScoringService.getContextSummary(profile)}`);
    console.log(`   Security maturity: ${(profile.securityMaturity * 100).toFixed(0)}%`);
    console.log(`   Trust density: ${(profile.trustSignalDensity * 100).toFixed(0)}%`);
    console.log(`   Risk concentration: ${(profile.riskConcentration * 100).toFixed(0)}%`);

    // Step 2: Apply contextual penalties to signals (data-driven)
    let contextualSignals = ContextAwareScoringService.applyContextualPenalties(signals, result);

    // Step 3: Calculate score with adjusted signals and trust factor
    // Extract domain age from result (passed from pageAnalyzer)
    const domainAgeInDays = result.domainAgeInDays ?? null;
    console.log(`[DEBUG] extracting domainAgeInDays from result: ${domainAgeInDays}`);
    
    return this.calculateScore(contextualSignals, domainAgeInDays);
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
    // Calculate age score (0-1.0)
    let ageScore = 0;
    if (domainAgeInDays === null) {
      ageScore = 0.1; // Unknown age = slightly risky
    } else if (domainAgeInDays < 180) {
      ageScore = 0.0; // Brand new
    } else if (domainAgeInDays < 1095) {
      ageScore = 0.5; // 6mo-3y: developing
    } else if (domainAgeInDays < 3650) {
      ageScore = 0.8; // 3-10y: established
    } else {
      ageScore = 1.0; // 10y+: highly trusted
    }

    // Calculate legitimacy signal score (0-1.0)
    // More legitimacy signals = more trustworthy
    // But if ONLY legitimacy signals exist (suspicious absence of other indicators) = less trustworthy
    // Also: established domains SHOULD have social media presence (phishing detection)
    let legitimacyScore = 0.5; // Default: neutral
    
    // Phishing detection: Established domains without social media are suspicious
    // ruggedsale.com (3yr, 0 social) is likely phishing
    // theruggedsociety.com (5yr, 3 social) is legitimate
    if (domainAgeInDays !== null && domainAgeInDays > 1095 && socialMediaCount === 0) {
      // 3+ year old domain with ZERO social media profiles = RED FLAG
      legitimacyScore = 0.2; // Highly suspicious
      console.log(`[Phishing Alert] ${domainAgeInDays}d old domain with ZERO social profiles → legitimacyScore=0.2`);
    } else if (domainAgeInDays !== null && domainAgeInDays > 1825 && socialMediaCount < 2) {
      // 5+ year old domain with <2 social profiles = unusual
      legitimacyScore = 0.5; // Moderate caution
      console.log(`[Phishing Caution] ${domainAgeInDays}d old domain with only ${socialMediaCount} social profile(s) → legitimacyScore=0.5`);
    }
    
    // Signal quality analysis (if not already flagged as suspicious)
    if (legitimacyScore === 0.5 && totalSignalCount > 0) {
      const legitimacyRatio = legitimacySignalCount / totalSignalCount;
      
      // Perfect balance: ~30-40% legitimacy signals = high score
      if (legitimacyRatio >= 0.3 && legitimacyRatio <= 0.5) {
        legitimacyScore = 0.9; // Balanced signal profile
      }
      // Too many legitimacy signals (>60%) = suspicious (missing security/policy signals)
      else if (legitimacyRatio > 0.6) {
        legitimacyScore = 0.3; // Unbalanced = suspicious
      }
      // Very few signals overall = unknown
      else if (totalSignalCount < 2) {
        legitimacyScore = 0.5; // Not enough data
      }
    }

    // Detect risk concentration (phishing indicator)
    // If 80%+ of risks are dark patterns on old domain = suspicious
    let riskConcentrationPenalty = 0;
    if (domainAgeInDays !== null && domainAgeInDays > 1095 && totalSignalCount > 0) {
      const darkPatternRatio = darkPatternSignalCount / totalSignalCount;
      if (darkPatternRatio > 0.6) {
        riskConcentrationPenalty = 0.2; // Reduce trust if heavily concentrated
      }
    }

    // Trust factor = weighted combination
    // Age (70%) + Legitimacy signals (30%) - Concentration penalty
    const trustFactor = (ageScore * 0.7 + legitimacyScore * 0.3) - riskConcentrationPenalty;
    
    console.log(`[TrustFactor] age=${domainAgeInDays}d(${ageScore.toFixed(2)}) + legit=${legitimacyScore.toFixed(2)} - concentration=${riskConcentrationPenalty.toFixed(2)} → trustFactor=${Math.max(0, trustFactor).toFixed(2)}`);
    
    return Math.max(0, Math.min(1, trustFactor)); // Clamp to 0.0-1.0
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
