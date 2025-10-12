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

export const StorageService = {
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
   * Clear cached analysis for a specific URL and page type
   * If pageType not provided, clears all page type caches for the URL
   */
  async clearCachedAnalysis(url: string, pageType?: string): Promise<boolean> {
    try {
      const parsed = new URL(url);
      const domain = parsed.hostname.replace(/^www\./, '');
      
      if (pageType) {
        // Clear specific page type cache
        const cacheKey = this.generateCacheKey(url, pageType);
        console.log(`🧹 Clearing cache for ${url} (${pageType})`);
        return this.remove(cacheKey);
      } else {
        // Clear all page types for this URL
        const pageTypes = ['home', 'product', 'category', 'checkout', 'cart', 'policy', 'other'];
        const promises = pageTypes.map(type => 
          this.remove(`analysis_${domain}:${type}`)
        );
        await Promise.all(promises);
        console.log(`🧹 Cleared all caches for ${url}`);
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

