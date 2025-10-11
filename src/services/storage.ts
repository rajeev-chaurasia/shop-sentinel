// Storage service for managing Chrome storage API
import type { AnalysisResult } from '../types';

interface CachedAnalysis {
  result: AnalysisResult;
  expiresAt: number;
}

interface AnalysisProgress {
  url: string;
  pageType: string;
  startedAt: number;
  aiEnabled: boolean;
}

const CACHE_DURATION_MS = 15 * 60 * 1000;
const PROGRESS_TIMEOUT_MS = 60 * 1000;

export const StorageService = {
  /**
   * Get a value from Chrome storage
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const result = await chrome.storage.local.get(key);
      return result[key] ?? null;
    } catch (error) {
      console.error('Error getting from storage:', error);
      return null;
    }
  },

  /**
   * Set a value in Chrome storage
   */
  async set<T>(key: string, value: T): Promise<boolean> {
    try {
      await chrome.storage.local.set({ [key]: value });
      return true;
    } catch (error) {
      console.error('Error setting in storage:', error);
      return false;
    }
  },

  /**
   * Remove a value from Chrome storage
   */
  async remove(key: string): Promise<boolean> {
    try {
      await chrome.storage.local.remove(key);
      return true;
    } catch (error) {
      console.error('Error removing from storage:', error);
      return false;
    }
  },

  /**
   * Clear all values from Chrome storage
   */
  async clear(): Promise<boolean> {
    try {
      await chrome.storage.local.clear();
      return true;
    } catch (error) {
      console.error('Error clearing storage:', error);
      return false;
    }
  },

  /**
   * Cache an analysis result using domain + page type
   */
  async cacheAnalysis(url: string, pageType: string, result: AnalysisResult): Promise<boolean> {
    const cacheKey = this.generateCacheKey(url, pageType);
    const cached: CachedAnalysis = {
      result,
      expiresAt: Date.now() + CACHE_DURATION_MS,
    };
    
    console.log(`💾 Caching: ${cacheKey}`);
    return this.set(cacheKey, cached);
  },

  /**
   * Get cached analysis using domain + page type
   */
  async getCachedAnalysis(url: string, pageType: string): Promise<AnalysisResult | null> {
    const cacheKey = this.generateCacheKey(url, pageType);
    const cached = await this.get<CachedAnalysis>(cacheKey);
    
    if (!cached) {
      console.log(`📭 No cache found for ${cacheKey}`);
      return null;
    }
    
    // Check if expired
    if (Date.now() > cached.expiresAt) {
      console.log(`⏰ Cache expired for ${cacheKey}, removing...`);
      await this.remove(cacheKey);
      return null;
    }
    
    console.log(`✅ Cache hit: ${cacheKey}`);
    return cached.result;
  },

  /**
   * Generate cache key: domain:pageType
   * Example: "amazon.com:product", "ebay.com:checkout"
   */
  generateCacheKey(url: string, pageType: string): string {
    try {
      const parsed = new URL(url);
      const domain = parsed.hostname.replace(/^www\./, ''); // Remove www.
      return `analysis_${domain}:${pageType}`;
    } catch {
      // Fallback if URL parsing fails
      return `analysis_${url}:${pageType}`;
    }
  },

  /**
   * Clear cached analysis for a specific URL
   */
  async clearCachedAnalysis(url: string): Promise<boolean> {
    const cacheKey = `analysis_${this.normalizeUrl(url)}`;
    console.log(`🧹 Clearing cache for ${url}`);
    return this.remove(cacheKey);
  },

  /**
   * Normalize URL for consistent cache keys (removes query params, hash, trailing slash)
   */
  normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // Use protocol + hostname + pathname (no query/hash)
      let normalized = `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
      // Remove trailing slash
      if (normalized.endsWith('/') && normalized.length > 1) {
        normalized = normalized.slice(0, -1);
      }
      return normalized;
    } catch {
      // If URL parsing fails, just use the string
      return url;
    }
  },

  /**
   * Mark analysis as in progress for a URL
   */
  async setAnalysisInProgress(url: string, pageType: string, aiEnabled: boolean): Promise<boolean> {
    const progressKey = `progress_${this.normalizeUrl(url)}`;
    const progress: AnalysisProgress = {
      url,
      pageType,
      startedAt: Date.now(),
      aiEnabled,
    };
    console.log(`⏳ Marking analysis as in progress: ${url} (${pageType})`);
    return this.set(progressKey, progress);
  },

  /**
   * Check if analysis is in progress for a URL
   */
  async isAnalysisInProgress(url: string): Promise<boolean> {
    const progressKey = `progress_${this.normalizeUrl(url)}`;
    const progress = await this.get<AnalysisProgress>(progressKey);
    
    if (!progress) {
      return false;
    }
    
    // Check if stale (more than 1 minute old)
    if (Date.now() - progress.startedAt > PROGRESS_TIMEOUT_MS) {
      console.log(`🕐 Analysis progress stale, clearing: ${url}`);
      await this.remove(progressKey);
      return false;
    }
    
    return true;
  },

  /**
   * Clear analysis progress marker
   */
  async clearAnalysisProgress(url: string): Promise<boolean> {
    const progressKey = `progress_${this.normalizeUrl(url)}`;
    console.log(`✅ Clearing analysis progress: ${url}`);
    return this.remove(progressKey);
  },
};

