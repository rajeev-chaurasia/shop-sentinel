import { AnalysisResult, PolicySummary } from './analysis';

export const STORAGE_KEYS = {
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
  useAI: boolean;
  theme: 'light' | 'dark' | 'auto';
  enableNotifications: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  useAI: true,
  theme: 'auto',
  enableNotifications: true,
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
