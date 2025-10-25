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

interface AnalysisLock {
  acquiredAt: number;
  tabId: string;
  url: string;
  pageType: string;
}

const CACHE_DURATION_MS = 15 * 60 * 1000;      // 15 minutes
const PROGRESS_TIMEOUT_MS = 60 * 1000;         // 60 seconds
const LOCK_TIMEOUT_MS = 90 * 1000;             // 90 seconds (longer than analysis typically takes)

/**
 * Check if the extension context is valid and Chrome APIs are available
 */
function isExtensionContextValid(): boolean {
  return !!(chrome?.storage?.local && typeof chrome.storage.local.get === 'function');
}

export const StorageService = {
  /**
   * Get the most recent cached analysis for a domain irrespective of path
   * Used for delta analysis to reuse domain/contact/security
   */
  async getLatestDomainAnalysis(url: string, pageType?: string): Promise<AnalysisResult | null> {
    try {
      const parsed = new URL(url);
      const domain = parsed.hostname.replace(/^www\./, '');
      const all = await chrome.storage.local.get(null);
      const prefix = `analysis_${domain}:`;
      const candidates = Object.entries(all)
        .filter(([k]) => k.startsWith(prefix) && (!pageType || k.includes(`:${pageType}`)))
        .map(([, v]) => v as any)
        .filter(Boolean);
      const latestKey = `latest_${domain}:${pageType || ''}`;
      if (all[latestKey]) candidates.push(all[latestKey]);
      if (candidates.length === 0) return null;
      // New format: { result, expiresAt }
      const valid = candidates
        .map(c => (c.result && c.expiresAt ? c.result as AnalysisResult : (c as AnalysisResult)))
        .filter(r => !!r && typeof r === 'object');
      if (valid.length === 0) return null;
      // Pick latest timestamp
      valid.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      return valid[0];
    } catch (e) {
      console.error('getLatestDomainAnalysis error:', e);
      return null;
    }
  },
  /**
   * Get a value from Chrome storage
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        console.error('chrome.storage.local is not available');
        return null;
      }
      const result = await chrome.storage.local.get(key);
      return result[key] ?? null;
    } catch (error) {
      // Handle extension context invalidation specifically
      if (error instanceof Error && error.message.includes('Extension context invalidated')) {
        console.error('❌ Extension context invalidated - extension may have been reloaded');
        return null;
      }
      console.error('Error getting from storage:', error);
      return null;
    }
  },

  /**
   * Set a value in Chrome storage
   */
  async set<T>(key: string, value: T): Promise<boolean> {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        console.error('chrome.storage.local is not available');
        return false;
      }
      await chrome.storage.local.set({ [key]: value });
      return true;
    } catch (error) {
      // Handle extension context invalidation specifically
      if (error instanceof Error && error.message.includes('Extension context invalidated')) {
        console.error('❌ Extension context invalidated - extension may have been reloaded');
        return false;
      }
      console.error('Error setting in storage:', error);
      return false;
    }
  },

  /**
   * Remove a value from Chrome storage
   */
  async remove(key: string): Promise<boolean> {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        console.error('chrome.storage.local is not available');
        return false;
      }
      await chrome.storage.local.remove(key);
      return true;
    } catch (error) {
      // Handle extension context invalidation specifically
      if (error instanceof Error && error.message.includes('Extension context invalidated')) {
        console.error('❌ Extension context invalidated - extension may have been reloaded');
        return false;
      }
      console.error('Error removing from storage:', error);
      return false;
    }
  },

  /**
   * Clear all values from Chrome storage
   */
  async clear(): Promise<boolean> {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        console.error('chrome.storage.local is not available');
        return false;
      }
      await chrome.storage.local.clear();
      return true;
    } catch (error) {
      // Handle extension context invalidation specifically
      if (error instanceof Error && error.message.includes('Extension context invalidated')) {
        console.error('❌ Extension context invalidated - extension may have been reloaded');
        return false;
      }
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
    const ok = await this.set(cacheKey, cached);
    if (ok) {
      try {
        const parsed = new URL(url);
        const domain = parsed.hostname.replace(/^www\./, '');
        await chrome.storage.local.set({ [`latest_${domain}:${pageType}`]: cached });
      } catch {}
    }
    return ok;
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
      // For product-like pages, include path to avoid reusing cache across different items
      const path = parsed.pathname.replace(/\/+$/, '');
      const pathScopedTypes = new Set(['product', 'policy', 'checkout', 'cart']);
      if (pathScopedTypes.has(pageType)) {
        return `analysis_${domain}:${pageType}:${path || '/'}`;
      }
      return `analysis_${domain}:${pageType}`;
    } catch {
      // Fallback if URL parsing fails
      return `analysis_${url}:${pageType}`;
    }
  },

  /**
   * Clear cached analysis for a specific URL and page type
   * If pageType not provided, clears all page type caches for the URL
   */
  async clearCachedAnalysis(url: string, pageType?: string): Promise<boolean> {
    try {
      const parsed = new URL(url);
      const domain = parsed.hostname.replace(/^www\./, '');
      const path = parsed.pathname.replace(/\/+$/, '');
      
      if (pageType) {
        // Clear specific page type cache
        // Remove both path-scoped and domain-scoped variants
        const keys = [
          `analysis_${domain}:${pageType}`,
          `analysis_${domain}:${pageType}:${path || '/'}`,
        ];
        await chrome.storage.local.remove(keys);
        console.log(`🧹 Cleared cache keys:`, keys);
        return true;
      } else {
        // Clear all page types for this URL
        const all = await chrome.storage.local.get(null);
        const keys = Object.keys(all).filter(k => k.startsWith(`analysis_${domain}:`));
        if (keys.length) {
          await chrome.storage.local.remove(keys);
        }
        console.log(`🧹 Cleared all caches for domain ${domain}`);
        return true;
      }
    } catch (error) {
      console.error('Error clearing cache:', error);
      return false;
    }
  },

  /**
   * Mark analysis as in progress for a URL with consistent key format
   */
  async setAnalysisInProgress(url: string, pageType: string, aiEnabled: boolean): Promise<boolean> {
    const progressKey = `progress_${this.generateCacheKey(url, pageType)}`;
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
   * Check if analysis is in progress for a URL and page type
   */
  async isAnalysisInProgress(url: string, pageType?: string): Promise<boolean> {
    try {
      if (pageType) {
        const progressKey = `progress_${this.generateCacheKey(url, pageType)}`;
        const progress = await this.get<AnalysisProgress>(progressKey);
        
        if (!progress) {
          return false;
        }
        
        // Check if stale (more than 1 minute old)
        if (Date.now() - progress.startedAt > PROGRESS_TIMEOUT_MS) {
          console.log(`🕐 Analysis progress stale, clearing: ${url} (${pageType})`);
          await this.remove(progressKey);
          return false;
        }
        
        return true;
      } else {
        // Check if any page type is in progress
        const parsed = new URL(url);
        const domain = parsed.hostname.replace(/^www\./, '');
        const pageTypes = ['home', 'product', 'category', 'checkout', 'cart', 'policy', 'other'];
        
        for (const type of pageTypes) {
          const progressKey = `progress_${domain}:${type}`;
          const progress = await this.get<AnalysisProgress>(progressKey);
          if (progress && Date.now() - progress.startedAt <= PROGRESS_TIMEOUT_MS) {
            return true;
          }
        }
        return false;
      }
    } catch {
      return false;
    }
  },

  /**
   * Clear analysis progress marker
   */
  async clearAnalysisProgress(url: string, pageType?: string): Promise<boolean> {
    try {
      if (pageType) {
        const progressKey = `progress_${this.generateCacheKey(url, pageType)}`;
        console.log(`✅ Clearing analysis progress: ${url} (${pageType})`);
        return this.remove(progressKey);
      } else {
        // Clear all page types
        const parsed = new URL(url);
        const domain = parsed.hostname.replace(/^www\./, '');
        const pageTypes = ['home', 'product', 'category', 'checkout', 'cart', 'policy', 'other'];
        const promises = pageTypes.map(type => 
          this.remove(`progress_${domain}:${type}`)
        );
        await Promise.all(promises);
        console.log(`✅ Cleared all progress markers for ${url}`);
        return true;
      }
    } catch (error) {
      console.error('Error clearing progress:', error);
      return false;
    }
  },

  /**
   * Try to acquire a distributed lock for analysis
   * Prevents multiple tabs from analyzing the same page simultaneously
   * @returns true if lock acquired, false if already locked by another tab
   */
  async acquireAnalysisLock(url: string, pageType: string): Promise<boolean> {
    const lockKey = `lock_${this.generateCacheKey(url, pageType)}`;
    const existingLock = await this.get<AnalysisLock>(lockKey);
    
    // Check if lock exists and is still valid
    if (existingLock && Date.now() - existingLock.acquiredAt < LOCK_TIMEOUT_MS) {
      console.log(`🔒 Analysis lock held by another tab for ${url} (${pageType})`);
      return false;
    }
    
    // Acquire lock with unique tab ID
    const lock: AnalysisLock = {
      acquiredAt: Date.now(),
      tabId: crypto.randomUUID(), // Unique ID for this analysis session
      url,
      pageType,
    };
    
    await this.set(lockKey, lock);
    console.log(`🔓 Analysis lock acquired for ${url} (${pageType})`);
    return true;
  },

  /**
   * Release analysis lock
   */
  async releaseAnalysisLock(url: string, pageType: string): Promise<boolean> {
    const lockKey = `lock_${this.generateCacheKey(url, pageType)}`;
    console.log(`🔓 Releasing analysis lock for ${url} (${pageType})`);
    return this.remove(lockKey);
  },

  /**
   * Force clear all locks (for cleanup/debugging)
   */
  async clearAllLocks(): Promise<boolean> {
    try {
      const all = await chrome.storage.local.get(null);
      const lockKeys = Object.keys(all).filter(key => key.startsWith('lock_'));
      
      if (lockKeys.length > 0) {
        await chrome.storage.local.remove(lockKeys);
        console.log(`🧹 Cleared ${lockKeys.length} stale locks`);
      }
      
      return true;
    } catch (error) {
      console.error('Error clearing locks:', error);
      return false;
    }
  },
};

