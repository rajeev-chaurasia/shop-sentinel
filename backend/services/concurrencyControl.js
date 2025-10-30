/**
 * Lightweight Concurrency Control
 * 
 * For single-server deployment with 50+ concurrent users
 * No distributed locks - simple in-memory management
 * 
 * Features:
 * - In-memory duplicate detection
 * - Per-URL analysis locking (prevent duplicate work)
 * - Simple, fast, no database overhead
 * - Automatic cleanup
 */

const crypto = require('crypto');

class ConcurrencyControl {
  constructor() {
    // Track ongoing analyses by URL hash
    this.activeAnalyses = new Map(); // url_hash -> { url, startTime, timerId }
    
    // Track duplicate prevention
    this.urlHashes = new Map(); // url -> hash
    
    // Cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000); // Every minute
  }

  /**
   * Generate consistent hash for URL
   */
  hashUrl(url) {
    return crypto.createHash('sha256').update(url).digest('hex');
  }

  /**
   * Check if URL is currently being analyzed
   * Returns: { isAnalyzing: boolean, jobId?: string }
   */
  checkIfAnalyzing(url) {
    const hash = this.hashUrl(url);
    const analysis = this.activeAnalyses.get(hash);
    
    if (analysis) {
      const elapsed = Date.now() - analysis.startTime;
      // If analysis has been running > 60 seconds, consider it stale
      if (elapsed > 60000) {
        console.warn(`⚠️ Stale analysis detected for ${url} (${elapsed}ms), cleaning up`);
        this.activeAnalyses.delete(hash);
        return { isAnalyzing: false };
      }
      return { isAnalyzing: true };
    }
    
    return { isAnalyzing: false };
  }

  /**
   * Mark URL as being analyzed
   * Returns: { success: boolean, reason?: string }
   */
  startAnalysis(url) {
    const hash = this.hashUrl(url);
    
    if (this.activeAnalyses.has(hash)) {
      return { success: false, reason: 'Analysis already in progress for this URL' };
    }

    // Mark as active with timeout
    const timerId = setTimeout(() => {
      console.warn(`⚠️ Analysis timeout for ${url}, forcing cleanup`);
      this.activeAnalyses.delete(hash);
    }, 60000); // 60 second timeout

    this.activeAnalyses.set(hash, {
      url,
      hash,
      startTime: Date.now(),
      timerId
    });

    console.log(`🔒 Analysis started for: ${url}`);
    return { success: true };
  }

  /**
   * Mark URL analysis as complete
   */
  completeAnalysis(url) {
    const hash = this.hashUrl(url);
    const analysis = this.activeAnalyses.get(hash);
    
    if (analysis) {
      clearTimeout(analysis.timerId);
      this.activeAnalyses.delete(hash);
      const duration = Date.now() - analysis.startTime;
      console.log(`✅ Analysis completed for: ${url} (${duration}ms)`);
      return true;
    }
    
    return false;
  }

  /**
   * Cancel analysis (on error)
   */
  cancelAnalysis(url) {
    const hash = this.hashUrl(url);
    const analysis = this.activeAnalyses.get(hash);
    
    if (analysis) {
      clearTimeout(analysis.timerId);
      this.activeAnalyses.delete(hash);
      console.log(`❌ Analysis cancelled for: ${url}`);
      return true;
    }
    
    return false;
  }

  /**
   * Get current active analyses count
   */
  getActiveCount() {
    return this.activeAnalyses.size;
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      activeAnalyses: this.activeAnalyses.size,
      maxCapacity: 50,
      utilizationPercent: (this.activeAnalyses.size / 50) * 100
    };
  }

  /**
   * Cleanup stale entries
   */
  cleanup() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [hash, analysis] of this.activeAnalyses.entries()) {
      const elapsed = now - analysis.startTime;
      if (elapsed > 60000) {
        console.warn(`🧹 Cleaning stale analysis: ${analysis.url}`);
        clearTimeout(analysis.timerId);
        this.activeAnalyses.delete(hash);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned ${cleanedCount} stale analyses`);
    }
  }

  /**
   * Shutdown and cleanup
   */
  shutdown() {
    clearInterval(this.cleanupInterval);
    
    for (const analysis of this.activeAnalyses.values()) {
      clearTimeout(analysis.timerId);
    }
    
    this.activeAnalyses.clear();
    console.log('✅ Concurrency control shutdown complete');
  }
}

module.exports = ConcurrencyControl;
