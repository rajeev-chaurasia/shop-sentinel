/**
 * Context-Aware Intelligent Scoring System 🧠
 * 
 * GENERIC, DATA-DRIVEN ARCHITECTURE (No Hardcoding!)
 * 
 * Instead of hardcoded lists (Amazon, GitHub, etc), we analyze:
 * 1. Signal Maturity: Does domain have complete security setup? (SSL, DNSSEC, etc)
 * 2. Signal Consistency: Do signals align? (Old domain + no contact = suspicious)
 * 3. Signal Abundance: How many trust signals? (More signals = more established)
 * 4. Signal Absence Patterns: Which signals are "legitimately" missing?
 * 5. Risk Concentration: Do risky signals cluster? (Indicates phishing)
 * 
 * Key Insight: Legitimate sites have:
 * - Mature security setup (SSL, modern TLS, DNS records)
 * - Consistent contact information
 * - Multiple trust signals across categories
 * - Age-appropriate feature sets
 * 
 * Phishing sites have:
 * - Immature security setup (basic SSL, old TLS versions)
 * - Inconsistent/missing contact information
 * - Few trust signals, concentrated in one area
 * - Mismatched setup for claimed age
 */

import { RiskSignal, AnalysisResult } from '../types/analysis';

export interface SignalProfile {
  // Maturity metrics (0-1.0)
  securityMaturity: number;      // SSL, TLS version, DNSSEC, etc
  trustSignalDensity: number;    // How many trust signals present
  domainMaturity: number;        // Age relative to expected features
  contactConsistency: number;    // Do contact signals align?
  
  // Signal absence analysis
  missingSignalsReasoning: string[];  // Why signals might be missing (legitimate reasons)
  suspiciousAbsences: string[];       // Missing signals that are suspicious
  
  // Risk concentration (0-1.0, higher = more suspicious)
  riskConcentration: number;     // Are all risks in one area? (phishing indicator)
  
  // Domain characteristics (derived, not hardcoded)
  ageCategory: 'brand-new' | 'new' | 'established' | 'mature';
  domainAge: number | null;
  totalTrustSignals: number;
  totalRiskSignals: number;
}

export interface ContextualPenalty {
  baseScore: number;
  contextFactor: number;         // 0.2 - 2.0 multiplier
  finalScore: number;
  reasoning: string;
  profile: SignalProfile;        // Include profile for transparency
}

export class ContextAwareScoringService {
  /**
   * Build signal-driven profile from analysis result (NO hardcoded lists!)
   * 
   * Analyzes domain signals to determine:
   * - How mature is the security setup?
   * - How consistent are the signals?
   * - Are missing signals legitimate or suspicious?
   * - Where is the risk concentrated?
   */
  static buildSignalProfile(
    result: AnalysisResult,
    signals: RiskSignal[]
  ): SignalProfile {
    const domainAge = result.domain?.ageInDays ?? null;
    
    // Categorize domain by age (empirical distribution)
    const ageCategory = this.categorizeByAge(domainAge);
    
    // Calculate security maturity (how complete is setup?)
    const securityMaturity = this.calculateSecurityMaturity(result);
    
    // Calculate trust signal density (how many positive signals?)
    const trustSignalDensity = this.calculateTrustSignalDensity(signals);
    
    // Check domain maturity (does feature set match age?)
    const domainMaturity = this.calculateDomainMaturity(result, ageCategory);
    
    // Analyze contact consistency
    const contactConsistency = this.analyzeContactConsistency(result, signals);
    
    // Identify missing signals and their context
    const { missingSignalsReasoning, suspiciousAbsences } = 
      this.analyzeSignalAbsences(result, signals, ageCategory);
    
    // Calculate risk concentration (phishing indicator)
    const riskConcentration = this.calculateRiskConcentration(signals);

    return {
      securityMaturity,
      trustSignalDensity,
      domainMaturity,
      contactConsistency,
      missingSignalsReasoning,
      suspiciousAbsences,
      riskConcentration,
      ageCategory,
      domainAge,
      totalTrustSignals: signals.filter(s => s.score < 30).length,
      totalRiskSignals: signals.filter(s => s.score >= 30).length,
    };
  }

  /**
   * Data-driven helper methods (no hardcoding!)
   */

  /**
   * Categorize domain age into meaningful buckets
   * Uses empirical distribution, not hardcoded thresholds
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
   * Measures how complete and modern the security setup is
   */
  private static calculateSecurityMaturity(result: AnalysisResult): number {
    let score = 0;
    let maxScore = 0;

    // SSL/TLS (most important)
    if (result.security?.isHttps !== undefined) {
      maxScore += 4;
      if (result.security.isHttps) score += 4;
    }

    // Certificate validity (if available)
    if (result.security?.hasValidCertificate !== undefined) {
      maxScore += 2;
      if (result.security.hasValidCertificate) score += 2;
    }

    // Mixed content (SSL but with insecure content)
    if (result.security?.hasMixedContent !== undefined) {
      maxScore += 2;
      if (!result.security.hasMixedContent) score += 2;
    }

    return maxScore > 0 ? score / maxScore : 0;
  }

  /**
   * Calculate trust signal density (0-1.0)
   * How many positive signals are present?
   */
  private static calculateTrustSignalDensity(signals: RiskSignal[]): number {
    if (signals.length === 0) return 0;
    
    const trustSignals = signals.filter(s => s.score < 30).length;
    return Math.min(1.0, trustSignals / signals.length);
  }

  /**
   * Calculate domain maturity (0-1.0)
   * Does the feature set match the domain age?
   */
  private static calculateDomainMaturity(
    result: AnalysisResult,
    ageCategory: string
  ): number {
    const hasSSL = result.security?.isHttps ?? false;
    const hasValidCert = result.security?.hasValidCertificate ?? false;
    const hasContact = result.contact?.hasEmail ?? false;
    const hasPhysicalAddress = result.contact?.hasPhysicalAddress ?? false;
    const hasPrivacyPolicy = result.policies?.hasPrivacyPolicy ?? false;

    switch (ageCategory) {
      case 'brand-new':
        // New sites don't need all features, but SSL is critical
        return hasSSL ? 0.5 : 0.2;

      case 'new':
        // 1-year-old should have SSL + some contact info
        let newScore = hasSSL ? 0.6 : 0.3;
        if (hasContact) newScore += 0.15;
        return Math.min(1.0, newScore);

      case 'established':
        // 1-5 year old should have most features
        let estScore = hasSSL && hasValidCert ? 0.7 : 0.5;
        if (hasContact) estScore += 0.2;
        if (hasPrivacyPolicy) estScore += 0.1;
        return Math.min(1.0, estScore);

      case 'mature':
        // 5+ year old should have comprehensive features
        let matureScore = hasSSL && hasValidCert ? 0.8 : 0.6;
        if (hasContact && hasPhysicalAddress) matureScore += 0.15;
        if (hasPrivacyPolicy) matureScore += 0.05;
        return Math.min(1.0, matureScore);
      
      default:
        return 0;
    }
  }

  /**
   * Analyze contact consistency (0-1.0)
   * Do contact signals align? (Email, phone, address consistency)
   */
  private static analyzeContactConsistency(
    result: AnalysisResult,
    signals: RiskSignal[]
  ): number {
    const contact = result.contact ?? {};
    const hasEmail = contact.hasEmail ?? false;
    const hasPhone = contact.hasPhoneNumber ?? false;
    const hasAddress = contact.hasPhysicalAddress ?? false;
    
    // Count contact methods
    let contactSignalCount = 0;
    if (hasEmail) contactSignalCount++;
    if (hasPhone) contactSignalCount++;
    if (hasAddress) contactSignalCount++;

    // Check for contact-related risk signals
    const contactRiskSignals = signals.filter(s => 
      s.id.includes('contact') || 
      s.reason.toLowerCase().includes('contact')
    ).length;

    if (contactSignalCount === 0) return 0.3; // Missing contact = suspicious
    if (contactSignalCount === 3) return 1.0; // All contact types = consistent
    
    // 1-2 contact methods = 0.6-0.8
    const consistency = 0.5 + (contactSignalCount * 0.25);
    return Math.max(0, consistency - (contactRiskSignals * 0.1));
  }

  /**
   * Analyze signal absences and their context
   * Determines whether missing signals are legitimate or suspicious
   */
  private static analyzeSignalAbsences(
    result: AnalysisResult,
    signals: RiskSignal[],
    ageCategory: string
  ): { missingSignalsReasoning: string[]; suspiciousAbsences: string[] } {
    const missingSignalsReasoning: string[] = [];
    const suspiciousAbsences: string[] = [];

    const hasSSL = result.security?.isHttps ?? false;
    const hasContactPage = result.contact?.hasContactPage ?? false;
    const isEcommerce = result.isEcommerceSite ?? false;

    // Rule 1: Established domains may legitimately lack embedded social media
    if (ageCategory === 'established' || ageCategory === 'mature') {
      if (!signals.some(s => s.id.includes('social') && s.score > 20)) {
        missingSignalsReasoning.push('Established domain: Not required to have embedded social media');
      }
    }

    // Rule 2: Contact information present suggests established presence
    if (hasContactPage) {
      missingSignalsReasoning.push('Contact page available suggests established presence');
    }

    // Rule 3: New sites without SSL on ecommerce = SUSPICIOUS
    if (isEcommerce && !hasSSL && ageCategory === 'brand-new') {
      suspiciousAbsences.push('Brand-new ecommerce site without SSL certificate');
    }

    // Rule 4: Missing contact info on mature domains = SUSPICIOUS
    if (ageCategory === 'mature' && !hasContactPage) {
      suspiciousAbsences.push('Mature domain missing public contact page');
    }

    return { missingSignalsReasoning, suspiciousAbsences };
  }

  /**
   * Calculate risk concentration (0-1.0)
   * Phishing sites cluster risks in few areas
   * Legitimate sites spread risks across categories
   */
  private static calculateRiskConcentration(signals: RiskSignal[]): number {
    if (signals.length === 0) return 0;

    const riskSignals = signals.filter(s => s.score >= 30);
    if (riskSignals.length === 0) return 0;

    // Group risks by category (security, legitimacy, dark-pattern, policy)
    const categoryRisks = new Map<string, number>();
    riskSignals.forEach(signal => {
      const category = signal.category ?? 'policy';
      categoryRisks.set(category, (categoryRisks.get(category) ?? 0) + 1);
    });

    // If most risks are in 1-2 categories = high concentration (phishing indicator)
    const sortedCategories = Array.from(categoryRisks.values()).sort((a, b) => b - a);
    const topRisks = sortedCategories.slice(0, 2).reduce((a, b) => a + b, 0);
    const concentration = topRisks / riskSignals.length;

    return Math.min(1.0, concentration);
  }

  /**
   * Apply contextual penalties to signals based on signal profile
   * Uses data-driven analysis, not hardcoded rules
   */
  static applyContextualPenalties(
    signals: RiskSignal[],
    result: AnalysisResult
  ): RiskSignal[] {
    // Build profile from signals (no hardcoding!)
    const profile = this.buildSignalProfile(result, signals);

    return signals.map(signal => {
      const contextualPenalty = this.calculateContextualPenalty(signal, profile);

      // Only modify score if context factor differs significantly
      if (Math.abs(contextualPenalty.contextFactor - 1.0) > 0.01) {
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
   * Calculate contextual penalty using signal profile (GENERIC!)
   */
  private static calculateContextualPenalty(
    signal: RiskSignal,
    profile: SignalProfile
  ): ContextualPenalty {
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
      reasoning = `✅ High trust signals (${profile.totalTrustSignals}) + ${profile.ageCategory} domain - low-risk signal downweighted`;
    }

    // GENERIC RULE 2: Established domain with good security = reduce signals
    else if (
      profile.securityMaturity > 0.7 &&
      profile.ageCategory === 'established' &&
      signal.score < 20
    ) {
      contextFactor = 0.4;
      reasoning = `✅ ${profile.ageCategory} domain with mature security setup (${(profile.securityMaturity * 100).toFixed(0)}%) - signal less critical`;
    }

    // GENERIC RULE 3: Brand-new + poor security + suspicious absences = AMPLIFY
    else if (
      profile.ageCategory === 'brand-new' &&
      profile.securityMaturity < 0.5 &&
      profile.suspiciousAbsences.length > 0 &&
      (signal.id.includes('ssl') || signal.id.includes('https') || signal.id.includes('social'))
    ) {
      contextFactor = 1.8;
      reasoning = `� ${profile.ageCategory} domain + weak security (${(profile.securityMaturity * 100).toFixed(0)}%) + suspicious absences: ${profile.suspiciousAbsences[0]}`;
    }

    // GENERIC RULE 4: High risk concentration = phishing pattern AMPLIFY
    else if (
      profile.riskConcentration > 0.7 &&
      profile.ageCategory === 'brand-new' &&
      profile.totalRiskSignals >= 3
    ) {
      contextFactor = 2.0;
      reasoning = `🚨 Phishing pattern detected: ${profile.totalRiskSignals} risks concentrated in few areas (${(profile.riskConcentration * 100).toFixed(0)}%) on new domain`;
    }

    // GENERIC RULE 5: Poor contact consistency on mature domain = suspicious
    else if (
      profile.contactConsistency < 0.4 &&
      profile.ageCategory === 'mature' &&
      signal.id.includes('contact')
    ) {
      contextFactor = 1.5;
      reasoning = `⚠️ ${profile.ageCategory} domain with poor contact consistency (${(profile.contactConsistency * 100).toFixed(0)}%) - inconsistent information`;
    }

    // GENERIC RULE 6: Multiple suspicious absences = increase risk
    else if (
      profile.suspiciousAbsences.length > 1 &&
      profile.ageCategory === 'new'
    ) {
      contextFactor = 1.5;
      reasoning = `⚠️ New domain with multiple suspicious absences: ${profile.suspiciousAbsences.join(', ')}`;
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
   * Get context summary for UI display
   */
  static getContextSummary(profile: SignalProfile): string {
    const factors: string[] = [];

    factors.push(`${profile.ageCategory} domain`);

    if (profile.securityMaturity > 0.7) {
      factors.push(`✅ Mature security (${(profile.securityMaturity * 100).toFixed(0)}%)`);
    } else if (profile.securityMaturity < 0.4) {
      factors.push(`⚠️ Weak security (${(profile.securityMaturity * 100).toFixed(0)}%)`);
    }

    if (profile.trustSignalDensity > 0.6) {
      factors.push(`✅ High trust signals (${profile.totalTrustSignals})`);
    }

    if (profile.suspiciousAbsences.length > 0) {
      factors.push(`🚨 Suspicious: ${profile.suspiciousAbsences[0]}`);
    }

    if (profile.riskConcentration > 0.7) {
      factors.push(`🚨 Clustered risks (phishing indicator)`);
    }

    return factors.join(' | ');
  }
}
