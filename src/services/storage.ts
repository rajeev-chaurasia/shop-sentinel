// Storage service for managing Chrome storage API
import type { AnalysisResult } from '../types';
import { cacheService } from './cache';

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

const PROGRESS_TIMEOUT_MS = 60 * 1000;         // 60 seconds
const LOCK_TIMEOUT_MS = 90 * 1000;             // 90 seconds (longer than analysis typically takes)

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
    return await cacheService.set(url, pageType, result);
  },

  /**
   * Get cached analysis using domain + page type
   */
  async getCachedAnalysis(url: string, pageType: string): Promise<AnalysisResult | null> {
    return await cacheService.get(url, pageType);
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
    return await cacheService.clear(url, pageType);
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
    if (existingLock) {
      const lockAge = Date.now() - existingLock.acquiredAt;
      
      if (lockAge < LOCK_TIMEOUT_MS) {
        console.log(`🔒 Analysis lock held by another tab for ${url} (${pageType}), age: ${lockAge}ms`);
        return false;
      } else {
        console.log(`🕐 Stale lock detected (${lockAge}ms), clearing and re-acquiring for ${url} (${pageType})`);
        await this.remove(lockKey);
      }
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
   * Clear lock for a specific URL (used when settings change during analysis)
   * This helps prevent stuck "re-analyzing" state when toggling settings
   */
  async clearLockForUrl(url: string): Promise<boolean> {
    try {
      const all = await chrome.storage.local.get(null);
      const parsed = new URL(url);
      const domain = parsed.hostname.replace(/^www\./, '');
      const prefix = `lock_analysis_${domain}:`;
      const lockKeys = Object.keys(all).filter(key => key.startsWith(prefix));
      
      if (lockKeys.length > 0) {
        await chrome.storage.local.remove(lockKeys);
        console.log(`🧹 Cleared ${lockKeys.length} locks for ${url}`);
      }
      
      return true;
    } catch (error) {
      console.error('Error clearing locks for URL:', error);
      return false;
    }
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

  /**
   * Save partial analysis result for persistence across popup sessions
   */
  async savePartialResult(url: string, pageType: string, partialResult: any): Promise<boolean> {
    const partialKey = `partial_${this.generateCacheKey(url, pageType)}`;
    const partialData = {
      result: partialResult,
      savedAt: Date.now(),
      url,
      pageType,
    };
    console.log(`💾 Saving partial result: ${partialKey}`);
    return this.set(partialKey, partialData);
  },

  /**
   * Load partial analysis result from storage
   */
  async loadPartialResult(url: string, pageType: string): Promise<any | null> {
    const partialKey = `partial_${this.generateCacheKey(url, pageType)}`;
    const partialData = await this.get<any>(partialKey);
    
    if (!partialData) {
      return null;
    }

    // Check if partial result is stale (more than 5 minutes old)
    const maxAge = 5 * 60 * 1000; // 5 minutes
    if (Date.now() - partialData.savedAt > maxAge) {
      console.log(`🕐 Partial result stale, clearing: ${partialKey}`);
      await this.remove(partialKey);
      return null;
    }

    console.log(`📊 Loaded partial result: ${partialKey}`);
    return partialData.result;
  },

  /**
   * Clear partial result for a URL/pageType
   */
  async clearPartialResult(url: string, pageType: string): Promise<boolean> {
    const partialKey = `partial_${this.generateCacheKey(url, pageType)}`;
    console.log(`🗑️ Clearing partial result: ${partialKey}`);
    return this.remove(partialKey);
  },

  /**
   * Store job ID for a URL to track backend job status
   */
  async setJobId(url: string, jobId: string): Promise<boolean> {
    try {
      const key = `job_${this.generateCacheKey(url, '')}`;
      await chrome.storage.local.set({ [key]: { jobId, timestamp: Date.now() } });
      console.log(`💾 Job ID stored: ${key} = ${jobId}`);
      return true;
    } catch (error) {
      console.error('Error storing job ID:', error);
      return false;
    }
  },
};

