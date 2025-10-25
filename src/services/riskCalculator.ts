import { RiskSignal } from '../types/analysis';

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
   * Calculate comprehensive risk score with proper normalization
   * 
   * Algorithm:
   * 1. Deduplicate signals (AI + Heuristic = one signal)
   * 2. Group by category (security, legitimacy, dark-pattern, policy)
   * 3. Cap each category at its max (40, 30, 20, 10)
   * 4. Calculate percentage of max for each category
   * 5. Apply category weights and sum to get final score (0-100)
   */
  static calculateScore(signals: RiskSignal[]): RiskAnalysis {
    // Step 1: Deduplicate signals (AI + Heuristic may flag same issue)
    const deduplicated = this.deduplicateSignals(signals);
    
    // Step 2: Group signals by category
    const grouped = this.groupByCategory(deduplicated);
    
    // Step 3: Calculate category scores with simple capping
    const breakdown: CategoryBreakdown = {
      security: this.calculateCategoryScore(grouped.security, this.MAX_IMPACT.security),
      legitimacy: this.calculateCategoryScore(grouped.legitimacy, this.MAX_IMPACT.legitimacy),
      darkPattern: this.calculateCategoryScore(grouped.darkPattern, this.MAX_IMPACT.darkPattern),
      policy: this.calculateCategoryScore(grouped.policy, this.MAX_IMPACT.policy),
    };
    
    // Step 4: Calculate weighted total (normalized to 0-100)
    // Each category percentage is multiplied by its weight
    // Example: Security at 100% * 0.40 weight = 40 points toward final score
    const totalScore = Math.min(100, Math.round(
      breakdown.security.percentage * this.WEIGHTS.security +
      breakdown.legitimacy.percentage * this.WEIGHTS.legitimacy +
      breakdown.darkPattern.percentage * this.WEIGHTS.darkPattern +
      breakdown.policy.percentage * this.WEIGHTS.policy
    ));
    
    // Step 5: Determine risk level
    const riskLevel = this.getRiskLevel(totalScore);
    
    // Step 6: Get top 3 concerns
    const topConcerns = this.getTopConcerns(deduplicated, 3);
    
    return {
      totalScore,
      riskLevel,
      breakdown,
      topConcerns,
      signalCount: deduplicated.length,
    };
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
  private static calculateCategoryScore(
    signals: RiskSignal[],
    maxImpact: number
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
    
    // Simple approach: Cap at maxImpact
    // This is more intuitive and predictable
    // If rawSum = maxImpact → 100%
    // If rawSum > maxImpact → still 100% (capped)
    // If rawSum < maxImpact → proportional percentage
    
    const cappedScore = Math.min(rawSum, maxImpact);
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
