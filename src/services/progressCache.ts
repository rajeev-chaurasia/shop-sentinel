import type { PhaseResult, AnalysisHistoryItem } from '../types/messages';

const CACHE_KEY_PREFIX = 'analysis_phases_';
const HISTORY_KEY = 'analysis_history';
const MAX_HISTORY_ITEMS = 20; // Keep last 20 analyses
const CACHE_EXPIRY_HOURS = 24;

export class ProgressCacheService {
  static savePhaseResult(url: string, phase: PhaseResult): void {
    try {
      const cacheKey = `${CACHE_KEY_PREFIX}${url}`;
      const existing = this.getPhaseResults(url) || [];
      
      const updated = existing.map(p => p.phase === phase.phase ? phase : p);
      if (!updated.some(p => p.phase === phase.phase)) {
        updated.push(phase);
      }
      
      localStorage.setItem(cacheKey, JSON.stringify(updated));
    } catch (error) {
      console.warn('Failed to save phase result:', error);
    }
  }

  static getPhaseResults(url: string): PhaseResult[] | null {
    try {
      const cacheKey = `${CACHE_KEY_PREFIX}${url}`;
      const cached = localStorage.getItem(cacheKey);
      if (!cached) return null;
      
      const results = JSON.parse(cached) as PhaseResult[];
      return results;
    } catch (error) {
      console.warn('Failed to retrieve phase results:', error);
      return null;
    }
  }

  static clearPhaseResults(url: string): void {
    try {
      const cacheKey = `${CACHE_KEY_PREFIX}${url}`;
      localStorage.removeItem(cacheKey);
    } catch (error) {
      console.warn('Failed to clear phase results:', error);
    }
  }

  static saveToHistory(
    url: string,
    phases: PhaseResult[],
    finalScore?: number,
    riskLevel?: string
  ): void {
    try {
      const history = this.getHistory();
      
      const item: AnalysisHistoryItem = {
        url,
        timestamp: Date.now(),
        phases,
        finalScore,
        riskLevel,
      };
      
      history.unshift(item);
      
      const trimmed = history.slice(0, MAX_HISTORY_ITEMS);
      
      localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
    } catch (error) {
      console.warn('Failed to save to history:', error);
    }
  }

  static getHistory(): AnalysisHistoryItem[] {
    try {
      const cached = localStorage.getItem(HISTORY_KEY);
      if (!cached) return [];
      
      const history = JSON.parse(cached) as AnalysisHistoryItem[];
      
      const now = Date.now();
      const expiryMs = CACHE_EXPIRY_HOURS * 60 * 60 * 1000;
      
      return history.filter(item => (now - item.timestamp) < expiryMs);
    } catch (error) {
      console.warn('Failed to retrieve history:', error);
      return [];
    }
  }

  static getHistoryForUrl(url: string): AnalysisHistoryItem | null {
    try {
      const history = this.getHistory();
      return history.find(item => item.url === url) || null;
    } catch (error) {
      console.warn('Failed to get URL history:', error);
      return null;
    }
  }

  static getHistoryStats() {
    try {
      const history = this.getHistory();
      
      const totalAnalyses = history.length;
      const uniqueUrls = new Set(history.map(h => h.url)).size;
      const avgPhases = totalAnalyses > 0 
        ? history.reduce((sum, h) => sum + h.phases.length, 0) / totalAnalyses 
        : 0;
      
      return {
        totalAnalyses,
        uniqueUrls,
        avgPhases: avgPhases.toFixed(1),
      };
    } catch (error) {
      console.warn('Failed to calculate stats:', error);
      return { totalAnalyses: 0, uniqueUrls: 0, avgPhases: '0' };
    }
  }

  static clearAll(): void {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(CACHE_KEY_PREFIX)) {
          localStorage.removeItem(key);
        }
      }
      
      localStorage.removeItem(HISTORY_KEY);
    } catch (error) {
      console.warn('Failed to clear all cache:', error);
    }
  }

  static exportHistory(): string {
    try {
      const history = this.getHistory();
      const stats = this.getHistoryStats();
      
      return JSON.stringify({
        exportDate: new Date().toISOString(),
        stats,
        history,
      }, null, 2);
    } catch (error) {
      console.warn('Failed to export history:', error);
      return '{}';
    }
  }
}

// Export as singleton
export const progressCache = ProgressCacheService;
