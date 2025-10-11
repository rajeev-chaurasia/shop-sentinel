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
   * Remove duplicate signals (same concern from AI + Heuristic)
   */
  private static deduplicateSignals(signals: RiskSignal[]): RiskSignal[] {
    const seen = new Map<string, RiskSignal>();
    
    for (const signal of signals) {
      const key = this.getConcernKey(signal);
      
      if (!seen.has(key)) {
        seen.set(key, signal);
      } else {
        // Keep the signal with higher score (usually AI has better context)
        const existing = seen.get(key)!;
        if (signal.score > existing.score) {
          seen.set(key, signal);
        }
      }
    }
    
    return Array.from(seen.values());
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
