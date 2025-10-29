// Hybrid Storage Service - Combines browser and server-side storage
import { StorageService } from './storage';
import type { AnalysisResult } from '../types';

interface HybridStorageOptions {
  enableServerSync?: boolean;
  syncInterval?: number; // minutes
  maxLocalStorage?: number; // max items in local storage
}

interface SyncMetadata {
  lastSync: number;
  serverVersion: number;
  localVersion: number;
  pendingUploads: string[]; // URLs pending server upload
  pendingDownloads: string[]; // URLs to download from server
}

export class HybridStorageService {
  private options: Required<HybridStorageOptions>;
  private syncMetadata: SyncMetadata;
  private syncTimer: number | null = null;
  private isOnline: boolean = navigator.onLine;

  constructor(options: HybridStorageOptions = {}) {
    this.options = {
      enableServerSync: options.enableServerSync ?? true,
      syncInterval: options.syncInterval ?? 15, // 15 minutes
      maxLocalStorage: options.maxLocalStorage ?? 100,
    };

    this.syncMetadata = {
      lastSync: 0,
      serverVersion: 0,
      localVersion: 0,
      pendingUploads: [],
      pendingDownloads: [],
    };

    this.initialize();
  }

  private async initialize(): Promise<void> {
    // Load sync metadata from storage
    try {
      const metadata = await chrome.storage.local.get('hybrid_sync_metadata');
      if (metadata.hybrid_sync_metadata) {
        this.syncMetadata = { ...this.syncMetadata, ...metadata.hybrid_sync_metadata };
      }
    } catch (error) {
      console.warn('Failed to load sync metadata:', error);
    }

    // Set up online/offline listeners
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.scheduleSync();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      if (this.syncTimer) {
        clearInterval(this.syncTimer);
        this.syncTimer = null;
      }
    });

    // Start sync timer if online and enabled
    if (this.isOnline && this.options.enableServerSync) {
      this.scheduleSync();
    }
  }

  private scheduleSync(): void {
    if (!this.isOnline || !this.options.enableServerSync) return;

    // Clear existing timer
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }

    // Schedule sync
    this.syncTimer = window.setInterval(() => {
      this.performSync();
    }, this.options.syncInterval * 60 * 1000); // Convert minutes to milliseconds

    // Perform initial sync
    this.performSync();
  }

  private async performSync(): Promise<void> {
    if (!this.isOnline || !this.options.enableServerSync) return;

    try {
      console.log('🔄 Starting hybrid storage sync');

      // Upload pending items to server
      await this.uploadPendingItems();

      // Download new items from server
      await this.downloadNewItems();

      // Update sync metadata
      this.syncMetadata.lastSync = Date.now();
      await this.saveSyncMetadata();

      console.log('✅ Hybrid storage sync completed');
    } catch (error) {
      console.error('❌ Hybrid storage sync failed:', error);
    }
  }

  private async uploadPendingItems(): Promise<void> {
    if (this.syncMetadata.pendingUploads.length === 0) return;

    const uploadedUrls: string[] = [];

    for (const url of this.syncMetadata.pendingUploads) {
      try {
        // Get analysis from local storage
        const analysis = await StorageService.getLatestDomainAnalysis(url);
        if (!analysis) continue;

        // Upload to server
        const response = await chrome.runtime.sendMessage({
          action: 'UPLOAD_ANALYSIS',
          payload: {
            url,
            analysis,
            version: this.syncMetadata.localVersion + 1
          }
        });

        if (response.success) {
          uploadedUrls.push(url);
          this.syncMetadata.localVersion++;
        }
      } catch (error) {
        console.warn(`Failed to upload analysis for ${url}:`, error);
      }
    }

    // Remove uploaded items from pending list
    this.syncMetadata.pendingUploads = this.syncMetadata.pendingUploads.filter(
      url => !uploadedUrls.includes(url)
    );
  }

  private async downloadNewItems(): Promise<void> {
    try {
      // Get list of analyses from server that are newer than our version
      const response = await chrome.runtime.sendMessage({
        action: 'GET_SERVER_ANALYSES',
        payload: {
          sinceVersion: this.syncMetadata.serverVersion
        }
      });

      if (response.success && response.data?.analyses) {
        for (const serverAnalysis of response.data.analyses) {
          // Store in local storage
          await StorageService.cacheAnalysis(
            serverAnalysis.url,
            serverAnalysis.pageType,
            serverAnalysis.analysis
          );

          // Update server version
          if (serverAnalysis.version > this.syncMetadata.serverVersion) {
            this.syncMetadata.serverVersion = serverAnalysis.version;
          }
        }
      }
    } catch (error) {
      console.warn('Failed to download server analyses:', error);
    }
  }

  private async saveSyncMetadata(): Promise<void> {
    try {
      await chrome.storage.local.set({
        hybrid_sync_metadata: this.syncMetadata
      });
    } catch (error) {
      console.warn('Failed to save sync metadata:', error);
    }
  }

  /**
   * Store analysis result with hybrid storage strategy
   */
  async storeAnalysis(url: string, pageType: string, analysis: AnalysisResult): Promise<void> {
    // Always store locally first for immediate access
    await StorageService.cacheAnalysis(url, pageType, analysis);

    // If online and server sync enabled, mark for upload
    if (this.isOnline && this.options.enableServerSync) {
      if (!this.syncMetadata.pendingUploads.includes(url)) {
        this.syncMetadata.pendingUploads.push(url);
        await this.saveSyncMetadata();
      }

      // Try immediate upload for critical data
      try {
        await chrome.runtime.sendMessage({
          action: 'UPLOAD_ANALYSIS',
          payload: {
            url,
            analysis,
            version: this.syncMetadata.localVersion + 1
          }
        });

        // Remove from pending if upload succeeded
        this.syncMetadata.pendingUploads = this.syncMetadata.pendingUploads.filter(
          pendingUrl => pendingUrl !== url
        );
        this.syncMetadata.localVersion++;
        await this.saveSyncMetadata();
      } catch (error) {
        console.warn('Immediate upload failed, will retry in background:', error);
      }
    }

    // Clean up old local storage if needed
    await this.cleanupLocalStorage();
  }

  /**
   * Get analysis result with hybrid storage strategy
   */
  async getAnalysis(url: string, pageType?: string): Promise<AnalysisResult | null> {
    // Try local storage first (fastest)
    let analysis = await StorageService.getCachedAnalysis(url, pageType || 'other');
    if (analysis) {
      return analysis;
    }

    // If not found locally and online, try server
    if (this.isOnline && this.options.enableServerSync) {
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'GET_SERVER_ANALYSIS',
          payload: { url, pageType }
        });

        if (response.success && response.data?.analysis) {
          analysis = response.data.analysis;

          // Cache locally for future use
          if (pageType && analysis) {
            await StorageService.cacheAnalysis(url, pageType, analysis);
          }

          return analysis;
        }
      } catch (error) {
        console.warn('Failed to fetch from server:', error);
      }
    }

    return null;
  }

  /**
   * Clean up old local storage to stay within limits
   */
  private async cleanupLocalStorage(): Promise<void> {
    try {
      // Get all cached analyses
      const all = await chrome.storage.local.get(null);
      const analysisKeys = Object.keys(all).filter(key => key.startsWith('analysis_'));

      if (analysisKeys.length <= this.options.maxLocalStorage) {
        return; // No cleanup needed
      }

      // Sort by access time (most recent first)
      const sortedKeys = analysisKeys
        .map(key => ({
          key,
          data: all[key],
          lastAccessed: all[key].lastAccessed || 0
        }))
        .sort((a, b) => b.lastAccessed - a.lastAccessed);

      // Remove oldest entries
      const keysToRemove = sortedKeys
        .slice(this.options.maxLocalStorage)
        .map(item => item.key);

      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
        console.log(`🧹 Cleaned up ${keysToRemove.length} old analysis entries`);
      }
    } catch (error) {
      console.warn('Failed to cleanup local storage:', error);
    }
  }

  /**
   * Get sync status for debugging
   */
  getSyncStatus(): SyncMetadata & { isOnline: boolean; nextSyncIn?: number } {
    const nextSyncIn = this.syncTimer
      ? Math.max(0, (this.options.syncInterval * 60 * 1000) - (Date.now() - this.syncMetadata.lastSync))
      : undefined;

    return {
      ...this.syncMetadata,
      isOnline: this.isOnline,
      nextSyncIn
    };
  }

  /**
   * Force immediate sync
   */
  async forceSync(): Promise<void> {
    if (this.isOnline && this.options.enableServerSync) {
      await this.performSync();
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    window.removeEventListener('online', this.scheduleSync);
    window.removeEventListener('offline', () => {
      this.isOnline = false;
    });
  }
}

// Export singleton instance
export const hybridStorage = new HybridStorageService({
  enableServerSync: true,
  syncInterval: 15, // 15 minutes
  maxLocalStorage: 100
});