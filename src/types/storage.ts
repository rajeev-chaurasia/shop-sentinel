import { AnalysisResult, PolicySummary } from './analysis';

export const STORAGE_KEYS = {
  ANALYSIS_CACHE: 'analysisCache',
  POLICY_CACHE: 'policyCache',
  USER_SETTINGS: 'userSettings',
  SITE_FINGERPRINTS: 'siteFingerprints',
  EXTENSION_VERSION: 'extensionVersion',
  LAST_UPDATE: 'lastUpdate',
} as const;

export interface CachedAnalysis {
  url: string;
  result: AnalysisResult;
  cachedAt: number;
  expiresAt: number;
}

export interface AnalysisCache {
  [url: string]: CachedAnalysis;
}

export interface CachedPolicy {
  url: string;
  summary: PolicySummary;
  cachedAt: number;
  expiresAt: number;
}

export interface PolicyCache {
  [url: string]: CachedPolicy;
}

export interface UserSettings {
  enableAIAnalysis: boolean;
  enableAutoScan: boolean;
  enableAnnotations: boolean;
  riskThreshold: number;
  cacheExpiryHours: number;
  sendAnonymousTelemetry: boolean;
  theme: 'light' | 'dark' | 'auto';
  compactMode: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  enableAIAnalysis: true,
  enableAutoScan: true,
  enableAnnotations: true,
  riskThreshold: 50,
  cacheExpiryHours: 24,
  sendAnonymousTelemetry: false,
  theme: 'auto',
  compactMode: false,
};

export interface SiteFingerprint {
  domain: string;
  fingerprint: string;
  firstSeen: number;
  lastSeen: number;
  visitCount: number;
}

export interface SiteFingerprintStore {
  [domain: string]: SiteFingerprint;
}

export interface StorageSchema {
  [STORAGE_KEYS.ANALYSIS_CACHE]: AnalysisCache;
  [STORAGE_KEYS.POLICY_CACHE]: PolicyCache;
  [STORAGE_KEYS.USER_SETTINGS]: UserSettings;
  [STORAGE_KEYS.SITE_FINGERPRINTS]: SiteFingerprintStore;
  [STORAGE_KEYS.EXTENSION_VERSION]: string;
  [STORAGE_KEYS.LAST_UPDATE]: number;
}

export function isCacheValid(expiresAt: number): boolean {
  return Date.now() < expiresAt;
}

export function getCacheExpiry(hours: number): number {
  return Date.now() + hours * 60 * 60 * 1000;
}

export function getCacheKey(url: string): string {
  try {
    const urlObj = new URL(url);
    return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
  } catch {
    return url;
  }
}
