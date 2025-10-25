/**
 * Social Proof Audit Service
 * 
 * Implements TG-11: Social Proof Audit with production-quality architecture.
 * 
 * This service:
 * - Collects social media URLs from content scripts
 * - Validates URLs using background service worker
 * - Generates risk signals based on social proof validity
 * - Integrates with the main risk scoring system
 */

import { MessagingService } from './messaging';
import { SocialMediaProfile, RiskSignal } from '../types/analysis';
import type { ValidateSocialUrlsPayload } from '../types/messages';

// Configuration constants
const SOCIAL_PROOF_CONFIG = {
  MIN_VALID_PROFILES: 2, // Minimum valid profiles for good social proof
  VALIDATION_TIMEOUT: 30000, // 30 seconds timeout for validation (increased)
  CACHE_DURATION: 5 * 60 * 1000, // 5 minutes cache duration
  RETRY_ATTEMPTS: 2, // Number of retry attempts
  RETRY_DELAY: 1000, // Delay between retries
} as const;

// Risk scoring for social proof
const SOCIAL_PROOF_SCORES = {
  NO_SOCIAL_MEDIA: 15,
  INVALID_SOCIAL_PROFILES: 20,
  LOW_VALIDATION_RATE: 10,
  SUSPICIOUS_SOCIAL_PROFILES: 25,
} as const;

/**
 * Social Proof Audit Service
 * 
 * Handles social media profile validation and risk signal generation
 */
export class SocialProofAuditService {
  private static instance: SocialProofAuditService;
  private validationCache = new Map<string, {
    profiles: SocialMediaProfile[];
    auditResult: any;
    timestamp: number;
  }>();

  private constructor() {}

  static getInstance(): SocialProofAuditService {
    if (!SocialProofAuditService.instance) {
      SocialProofAuditService.instance = new SocialProofAuditService();
    }
    return SocialProofAuditService.instance;
  }

  /**
   * Perform comprehensive social proof audit
   * 
   * @param profiles - Social media profiles detected from the page
   * @returns Enhanced profiles with validation results and risk signals
   */
  async auditSocialProof(profiles: SocialMediaProfile[]): Promise<{
    enhancedProfiles: SocialMediaProfile[];
    signals: RiskSignal[];
    auditSummary: {
      totalProfiles: number;
      validProfiles: number;
      invalidProfiles: number;
      validationRate: number;
      lastValidatedAt: number;
    };
  }> {
    console.log(`🔍 Starting social proof audit for ${profiles.length} profiles...`);

    if (profiles.length === 0) {
      return this.handleNoSocialMedia();
    }

    // Check cache first
    const cacheKey = this.getCacheKey(profiles);
    const cached = this.validationCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < SOCIAL_PROOF_CONFIG.CACHE_DURATION) {
      console.log('✅ Using cached social proof validation results');
      return {
        enhancedProfiles: cached.profiles,
        signals: this.generateSignals(cached.auditResult),
        auditSummary: cached.auditResult,
      };
    }

    try {
      // Validate URLs using background service worker
      const validationResults = await this.validateSocialMediaUrls(profiles);
      
      // Enhance profiles with validation results
      const enhancedProfiles = this.enhanceProfilesWithValidation(profiles, validationResults);
      
      // Generate audit summary
      const auditSummary = this.generateAuditSummary(enhancedProfiles);
      
      // Generate risk signals
      const signals = this.generateSignals(auditSummary);
      
      // Cache results
      this.validationCache.set(cacheKey, {
        profiles: enhancedProfiles,
        auditResult: auditSummary,
        timestamp: Date.now(),
      });

      console.log(`✅ Social proof audit complete:`, {
        total: auditSummary.totalProfiles,
        valid: auditSummary.validProfiles,
        invalid: auditSummary.invalidProfiles,
        rate: `${auditSummary.validationRate}%`,
      });

      return {
        enhancedProfiles,
        signals,
        auditSummary,
      };

    } catch (error) {
      console.error('❌ Social proof audit failed:', error);
      
      // Fallback: return profiles without validation
      const auditSummary = {
        totalProfiles: profiles.length,
        validProfiles: 0,
        invalidProfiles: profiles.length,
        validationRate: 0,
        lastValidatedAt: Date.now(),
      };

      return {
        enhancedProfiles: profiles,
        signals: this.generateSignals(auditSummary),
        auditSummary,
      };
    }
  }

  /**
   * Validate social media URLs using background service worker
   */
  private async validateSocialMediaUrls(profiles: SocialMediaProfile[]): Promise<any[]> {
    const urlsToValidate = profiles.map(profile => ({
      platform: profile.platform,
      url: profile.url,
      location: profile.location,
    }));

    let lastError: Error | null = null;

    // Retry logic for better reliability
    for (let attempt = 0; attempt <= SOCIAL_PROOF_CONFIG.RETRY_ATTEMPTS; attempt++) {
      try {
        console.log(`🔍 Validating social media URLs (attempt ${attempt + 1}/${SOCIAL_PROOF_CONFIG.RETRY_ATTEMPTS + 1})...`);
        
        const response = await MessagingService.sendToBackground<any, any>(
          'VALIDATE_SOCIAL_URLS',
          { urls: urlsToValidate } as ValidateSocialUrlsPayload,
          { timeout: SOCIAL_PROOF_CONFIG.VALIDATION_TIMEOUT }
        );

        if (!response.success) {
          throw new Error(response.error || 'Validation request failed');
        }

        console.log('✅ Social media validation successful');
        return response.data || [];

      } catch (error) {
        lastError = error as Error;
        console.warn(`⚠️ Validation attempt ${attempt + 1} failed:`, error);
        
        if (attempt < SOCIAL_PROOF_CONFIG.RETRY_ATTEMPTS) {
          console.log(`⏳ Retrying in ${SOCIAL_PROOF_CONFIG.RETRY_DELAY}ms...`);
          await new Promise(resolve => setTimeout(resolve, SOCIAL_PROOF_CONFIG.RETRY_DELAY));
        }
      }
    }

    console.error('❌ All validation attempts failed:', lastError);
    throw lastError || new Error('Social media validation failed after all retries');
  }

  /**
   * Enhance profiles with validation results
   */
  private enhanceProfilesWithValidation(
    originalProfiles: SocialMediaProfile[],
    validationResults: any[]
  ): SocialMediaProfile[] {
    const enhancedProfiles: SocialMediaProfile[] = [];

    for (const profile of originalProfiles) {
      const validationResult = validationResults.find(
        result => result.platform === profile.platform && result.url === profile.url
      );

      const enhancedProfile: SocialMediaProfile = {
        ...profile,
        isValid: validationResult?.isValid || false,
        validationError: validationResult?.error,
        validatedAt: validationResult?.validatedAt || Date.now(),
      };

      enhancedProfiles.push(enhancedProfile);
    }

    return enhancedProfiles;
  }

  /**
   * Generate audit summary from enhanced profiles
   */
  private generateAuditSummary(profiles: SocialMediaProfile[]): {
    totalProfiles: number;
    validProfiles: number;
    invalidProfiles: number;
    validationRate: number;
    lastValidatedAt: number;
  } {
    const totalProfiles = profiles.length;
    const validProfiles = profiles.filter(p => p.isValid === true).length;
    const invalidProfiles = profiles.filter(p => p.isValid === false).length;
    const validationRate = totalProfiles > 0 ? Math.round((validProfiles / totalProfiles) * 100) : 0;
    const lastValidatedAt = Math.max(...profiles.map(p => p.validatedAt || 0));

    return {
      totalProfiles,
      validProfiles,
      invalidProfiles,
      validationRate,
      lastValidatedAt,
    };
  }

  /**
   * Generate risk signals based on audit results
   */
  private generateSignals(auditSummary: {
    totalProfiles: number;
    validProfiles: number;
    invalidProfiles: number;
    validationRate: number;
  }): RiskSignal[] {
    const signals: RiskSignal[] = [];

    // No social media presence
    if (auditSummary.totalProfiles === 0) {
      signals.push({
        id: 'no-social-media',
        score: SOCIAL_PROOF_SCORES.NO_SOCIAL_MEDIA,
        reason: 'No social media profiles found',
        severity: 'medium',
        category: 'legitimacy',
        source: 'heuristic',
        details: 'Legitimate businesses often maintain social media presence for customer engagement and transparency.',
      });
    }

    // Invalid social media profiles
    if (auditSummary.invalidProfiles > 0) {
      const severity = auditSummary.invalidProfiles >= auditSummary.totalProfiles / 2 ? 'high' : 'medium';
      
      signals.push({
        id: 'invalid-social-profiles',
        score: SOCIAL_PROOF_SCORES.INVALID_SOCIAL_PROFILES,
        reason: `${auditSummary.invalidProfiles} of ${auditSummary.totalProfiles} social media profiles are invalid or inaccessible`,
        severity,
        category: 'legitimacy',
        source: 'heuristic',
        details: `Invalid social media profiles (${auditSummary.validationRate}% validation rate) may indicate fake or abandoned accounts, reducing trustworthiness.`,
      });
    }

    // Low validation rate (many invalid profiles)
    if (auditSummary.totalProfiles > 0 && auditSummary.validationRate < 50) {
      signals.push({
        id: 'low-social-validation-rate',
        score: SOCIAL_PROOF_SCORES.LOW_VALIDATION_RATE,
        reason: `Low social media validation rate: ${auditSummary.validationRate}%`,
        severity: 'medium',
        category: 'legitimacy',
        source: 'heuristic',
        details: `Only ${auditSummary.validationRate}% of social media profiles are accessible, which may indicate fake or inactive accounts.`,
      });
    }

    // Suspicious pattern: all profiles invalid
    if (auditSummary.totalProfiles > 2 && auditSummary.validProfiles === 0) {
      signals.push({
        id: 'suspicious-social-profiles',
        score: SOCIAL_PROOF_SCORES.SUSPICIOUS_SOCIAL_PROFILES,
        reason: 'All social media profiles are invalid or inaccessible',
        severity: 'high',
        category: 'legitimacy',
        source: 'heuristic',
        details: 'Having multiple social media links that are all invalid is highly suspicious and may indicate a scam operation.',
      });
    }

    return signals;
  }

  /**
   * Handle case with no social media
   */
  private handleNoSocialMedia(): {
    enhancedProfiles: SocialMediaProfile[];
    signals: RiskSignal[];
    auditSummary: any;
  } {
    const signal: RiskSignal = {
      id: 'no-social-media',
      score: SOCIAL_PROOF_SCORES.NO_SOCIAL_MEDIA,
      reason: 'No social media profiles found',
      severity: 'medium',
      category: 'legitimacy',
      source: 'heuristic',
      details: 'Legitimate businesses often maintain social media presence for customer engagement and transparency.',
    };

    return {
      enhancedProfiles: [],
      signals: [signal],
      auditSummary: {
        totalProfiles: 0,
        validProfiles: 0,
        invalidProfiles: 0,
        validationRate: 0,
        lastValidatedAt: Date.now(),
      },
    };
  }

  /**
   * Generate cache key for profiles
   */
  private getCacheKey(profiles: SocialMediaProfile[]): string {
    const sortedProfiles = profiles
      .map(p => `${p.platform}:${p.url}`)
      .sort()
      .join('|');
    
    return `social_audit_${sortedProfiles}`;
  }

  /**
   * Clear validation cache
   */
  clearCache(): void {
    this.validationCache.clear();
    console.log('🧹 Social proof audit cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    entries: Array<{
      key: string;
      age: number;
      profiles: number;
    }>;
  } {
    const now = Date.now();
    const entries = Array.from(this.validationCache.entries()).map(([key, data]) => ({
      key,
      age: now - data.timestamp,
      profiles: data.profiles.length,
    }));

    return {
      size: this.validationCache.size,
      entries,
    };
  }
}

// Export singleton instance
export const socialProofAuditService = SocialProofAuditService.getInstance();
