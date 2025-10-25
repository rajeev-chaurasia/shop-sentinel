// Enhanced cache service with multi-level caching strategy
import type { AnalysisResult } from '../types';
import { crossTabSync } from './crossTabSync';

interface CachedAnalysis {
  result: AnalysisResult;
  expiresAt: number;
  lastAccessed: number;
}

interface MemoryCacheEntry {
  data: CachedAnalysis;
  accessCount: number;
}

class CacheService {
  private memoryCache = new Map<string, MemoryCacheEntry>();
  private readonly MEMORY_CACHE_SIZE = 10; // Keep 10 most recently used items
  private readonly STORAGE_CACHE_DURATION = 15 * 60 * 1000; // 15 minutes in storage

  /**
   * Get analysis result from multi-level cache (memory -> storage)
   */
  async get(url: string, pageType: string): Promise<AnalysisResult | null> {
    const cacheKey = this.generateCacheKey(url, pageType);

    // 1. Check memory cache first (fastest)
    const memoryResult = this.getFromMemory(cacheKey);
    if (memoryResult) {
      console.log(`🚀 Memory cache hit: ${cacheKey}`);
      return memoryResult;
    }

    // 2. Check storage cache
    const storageResult = await this.getFromStorage(url, pageType);
    if (storageResult) {
      // Promote to memory cache for faster future access
      this.setInMemory(cacheKey, {
        result: storageResult,
        expiresAt: Date.now() + this.STORAGE_CACHE_DURATION,
        lastAccessed: Date.now()
      });
      return storageResult;
    }

    return null;
  }

  /**
   * Set analysis result in multi-level cache
   */
  async set(url: string, pageType: string, result: AnalysisResult): Promise<boolean> {
    const cacheKey = this.generateCacheKey(url, pageType);
    const cachedData: CachedAnalysis = {
      result,
      expiresAt: Date.now() + this.STORAGE_CACHE_DURATION,
      lastAccessed: Date.now()
    };

    // 1. Set in memory cache (fast access for immediate re-use)
    this.setInMemory(cacheKey, cachedData);

    // 2. Set in storage cache (persistent across sessions)
    const storageSuccess = await this.setInStorage(url, pageType, result);

    // 3. Update domain-level latest cache for delta analysis
    if (storageSuccess) {
      await this.updateDomainLatest(url, pageType, cachedData);
    }

    return storageSuccess;
  }

  /**
   * Clear cache for specific URL/pageType or all caches for domain
   */
  async clear(url: string, pageType?: string): Promise<boolean> {
    const cacheKey = this.generateCacheKey(url, pageType || '');

    // Clear memory cache
    this.memoryCache.delete(cacheKey);

    // Clear storage cache
    const storageCleared = await this.clearFromStorage(url, pageType);
    
    // Broadcast cache invalidation to other tabs
    if (storageCleared) {
      crossTabSync.broadcastCacheInvalidation(url, pageType);
    }

    return storageCleared;
  }

  /**
   * Get cache statistics for monitoring
   */
  getStats() {
    return {
      memoryCacheSize: this.memoryCache.size,
      memoryCacheMaxSize: this.MEMORY_CACHE_SIZE,
      memoryCacheHitRate: this.calculateHitRate()
    };
  }

  /**
   * Clean up expired memory cache entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.memoryCache.entries()) {
      if (now > entry.data.expiresAt) {
        this.memoryCache.delete(key);
      }
    }
  }

  // Private methods for memory cache management
  private getFromMemory(cacheKey: string): AnalysisResult | null {
    const entry = this.memoryCache.get(cacheKey);
    if (!entry) return null;

    // Check if expired
    if (Date.now() > entry.data.expiresAt) {
      this.memoryCache.delete(cacheKey);
      return null;
    }

    // Update access tracking
    entry.accessCount++;
    entry.data.lastAccessed = Date.now();

    return entry.data.result;
  }

  private setInMemory(cacheKey: string, data: CachedAnalysis): void {
    // Clean up if cache is full (LRU eviction)
    if (this.memoryCache.size >= this.MEMORY_CACHE_SIZE) {
      this.evictLRU();
    }

    this.memoryCache.set(cacheKey, {
      data,
      accessCount: 1
    });
  }

  private evictLRU(): void {
    let oldestKey = '';
    let oldestTime = Date.now();

    for (const [key, entry] of this.memoryCache.entries()) {
      if (entry.data.lastAccessed < oldestTime) {
        oldestTime = entry.data.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.memoryCache.delete(oldestKey);
    }
  }

  private calculateHitRate(): number {
    const total = Array.from(this.memoryCache.values()).reduce((sum, entry) => sum + entry.accessCount, 0);
    if (total === 0) return 0;
    return (total - this.memoryCache.size) / total; // hits / total accesses
  }

  // Storage cache delegation methods
  private async getFromStorage(url: string, pageType: string): Promise<AnalysisResult | null> {
    const cacheKey = this.generateCacheKey(url, pageType);
    const cached = await chrome.storage.local.get(cacheKey);

    if (!cached[cacheKey]) {
      console.log(`📭 No storage cache found for ${cacheKey}`);
      return null;
    }

    const data = cached[cacheKey] as CachedAnalysis;

    // Check if expired
    if (Date.now() > data.expiresAt) {
      console.log(`⏰ Storage cache expired for ${cacheKey}, removing...`);
      await chrome.storage.local.remove(cacheKey);
      return null;
    }

    console.log(`✅ Storage cache hit: ${cacheKey}`);
    return data.result;
  }

  private async setInStorage(url: string, pageType: string, result: AnalysisResult): Promise<boolean> {
    const cacheKey = this.generateCacheKey(url, pageType);
    const cached: CachedAnalysis = {
      result,
      expiresAt: Date.now() + this.STORAGE_CACHE_DURATION,
      lastAccessed: Date.now()
    };

    try {
      await chrome.storage.local.set({ [cacheKey]: cached });
      console.log(`💾 Storage cached: ${cacheKey}`);
      return true;
    } catch (error) {
      console.error('Error setting storage cache:', error);
      return false;
    }
  }

  private async clearFromStorage(url: string, pageType?: string): Promise<boolean> {
    try {
      const parsed = new URL(url);
      const domain = parsed.hostname.replace(/^www\./, '');
      const path = parsed.pathname.replace(/\/+$/, '');

      if (pageType) {
        // Clear specific page type cache
        const keys = [
          `analysis_${domain}:${pageType}`,
          `analysis_${domain}:${pageType}:${path || '/'}`,
        ];
        await chrome.storage.local.remove(keys);
        console.log(`🧹 Cleared storage cache keys:`, keys);
        return true;
      } else {
        // Clear all page types for this URL
        const all = await chrome.storage.local.get(null);
        const keys = Object.keys(all).filter(k => k.startsWith(`analysis_${domain}:`));
        if (keys.length) {
          await chrome.storage.local.remove(keys);
        }
        console.log(`🧹 Cleared all storage caches for domain ${domain}`);
        return true;
      }
    } catch (error) {
      console.error('Error clearing storage cache:', error);
      return false;
    }
  }

  private async updateDomainLatest(url: string, pageType: string, cached: CachedAnalysis): Promise<void> {
    try {
      const parsed = new URL(url);
      const domain = parsed.hostname.replace(/^www\./, '');
      await chrome.storage.local.set({ [`latest_${domain}:${pageType}`]: cached });
    } catch (error) {
      console.error('Error updating domain latest cache:', error);
    }
  }

  private generateCacheKey(url: string, pageType: string): string {
    try {
      const parsed = new URL(url);
      const domain = parsed.hostname.replace(/^www\./, '');
      const path = parsed.pathname.replace(/\/+$/, '');
      const pathScopedTypes = new Set(['product', 'policy', 'checkout', 'cart']);
      if (pathScopedTypes.has(pageType)) {
        return `analysis_${domain}:${pageType}:${path || '/'}`;
      }
      return `analysis_${domain}:${pageType}`;
    } catch {
      return `analysis_${url}:${pageType}`;
    }
  }
}

// Export singleton instance
export const cacheService = new CacheService();

// Periodic cleanup of expired memory cache entries
setInterval(() => {
  cacheService.cleanup();
}, 60 * 1000); // Clean up every minute