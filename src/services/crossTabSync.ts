// Cross-tab synchronization service using BroadcastChannel API
// Enables real-time collaboration features across multiple browser tabs

interface CrossTabMessage {
  type: 'ANALYSIS_UPDATE' | 'CACHE_INVALIDATION' | 'TAB_STATE_CHANGE' | 'ANALYSIS_START' | 'ANALYSIS_COMPLETE';
  payload: any;
  sourceTabId: number;
  timestamp: number;
  sessionId: string;
}

interface TabSession {
  tabId: number;
  url: string;
  lastActivity: number;
  analysisState: 'idle' | 'analyzing' | 'completed';
}

class CrossTabSyncService {
  private broadcastChannel: BroadcastChannel;
  private sessionId: string;
  private currentTabId: number | null = null;
  private activeTabs = new Map<number, TabSession>();
  private listeners = new Map<string, Set<(message: CrossTabMessage) => void>>();
  private heartbeatInterval: number | null = null;

  constructor() {
    this.sessionId = this.generateSessionId();
    this.broadcastChannel = new BroadcastChannel('shop-sentinel-sync');

    this.broadcastChannel.onmessage = (event) => {
      this.handleIncomingMessage(event.data);
    };

    // Start heartbeat to maintain tab presence
    this.startHeartbeat();

    // Listen for tab close/unload to clean up
    window.addEventListener('beforeunload', () => {
      this.cleanup();
    });

    // Listen for visibility changes to update activity
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.updateActivity();
      }
    });
  }

  /**
   * Initialize the service with current tab information
   * Content scripts should call this without expecting tab info
   */
  async initialize(): Promise<void> {
    try {
      // Only try to get tab info if chrome.tabs is available (not in content scripts)
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.id) {
          this.currentTabId = tabs[0].id;
          this.registerTab(tabs[0].url || '');
        }
      } else {
        // Content script mode - generate a pseudo tab ID based on URL
        this.currentTabId = this.generatePseudoTabId();
        this.registerTab(window.location.href);
      }
    } catch (error) {
      console.warn('Failed to get current tab ID:', error);
      // Fallback for content scripts
      this.currentTabId = this.generatePseudoTabId();
      this.registerTab(window.location.href);
    }
  }

  /**
   * Register this tab with the sync service
   */
  private registerTab(url: string): void {
    if (!this.currentTabId) return;

    const session: TabSession = {
      tabId: this.currentTabId,
      url,
      lastActivity: Date.now(),
      analysisState: 'idle'
    };

    this.activeTabs.set(this.currentTabId, session);
    this.broadcast('TAB_STATE_CHANGE', { session });
  }

  /**
   * Broadcast a message to all other tabs
   */
  private broadcast(type: CrossTabMessage['type'], payload: any): void {
    const message: CrossTabMessage = {
      type,
      payload,
      sourceTabId: this.currentTabId || 0,
      timestamp: Date.now(),
      sessionId: this.sessionId
    };

    this.broadcastChannel.postMessage(message);
  }

  /**
   * Handle incoming messages from other tabs
   */
  private handleIncomingMessage(message: CrossTabMessage): void {
    // Ignore messages from self
    if (message.sourceTabId === this.currentTabId) return;

    // Update active tabs registry
    this.updateTabRegistry(message);

    // Route to appropriate listeners
    const listeners = this.listeners.get(message.type);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(message);
        } catch (error) {
          console.error('Error in cross-tab message listener:', error);
        }
      });
    }
  }

  /**
   * Update the registry of active tabs based on incoming messages
   */
  private updateTabRegistry(message: CrossTabMessage): void {
    const tabId = message.sourceTabId;

    if (message.type === 'TAB_STATE_CHANGE') {
      this.activeTabs.set(tabId, message.payload.session);
    } else {
      // Update last activity for any message from this tab
      const existing = this.activeTabs.get(tabId);
      if (existing) {
        existing.lastActivity = message.timestamp;
      }
    }

    // Clean up stale tabs (no activity for 5 minutes)
    const cutoff = Date.now() - (5 * 60 * 1000);
    for (const [id, session] of this.activeTabs.entries()) {
      if (session.lastActivity < cutoff) {
        this.activeTabs.delete(id);
      }
    }
  }

  /**
   * Subscribe to specific message types
   */
  on(type: CrossTabMessage['type'], listener: (message: CrossTabMessage) => void): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }

    this.listeners.get(type)!.add(listener);

    // Return unsubscribe function
    return () => {
      const typeListeners = this.listeners.get(type);
      if (typeListeners) {
        typeListeners.delete(listener);
        if (typeListeners.size === 0) {
          this.listeners.delete(type);
        }
      }
    };
  }

  /**
   * Broadcast analysis update to other tabs
   */
  broadcastAnalysisUpdate(url: string, result: any): void {
    this.broadcast('ANALYSIS_UPDATE', { url, result });
  }

  /**
   * Broadcast cache invalidation to other tabs
   */
  broadcastCacheInvalidation(url: string, pageType?: string): void {
    this.broadcast('CACHE_INVALIDATION', { url, pageType });
  }

  /**
   * Broadcast analysis start event
   */
  broadcastAnalysisStart(url: string, pageType: string): void {
    this.updateAnalysisState('analyzing');
    this.broadcast('ANALYSIS_START', { url, pageType });
    
    // Also notify service worker for coordination
    this.notifyServiceWorker('ANALYSIS_START', { url, pageType });
  }

  /**
   * Broadcast analysis completion event
   */
  broadcastAnalysisComplete(url: string, result: any): void {
    this.updateAnalysisState('completed');
    this.broadcast('ANALYSIS_COMPLETE', { url, result });
    
    // Also notify service worker for coordination
    this.notifyServiceWorker('ANALYSIS_COMPLETE', { url });
  }

  /**
   * Notify service worker of coordination events
   */
  private notifyServiceWorker(type: string, payload: any): void {
    try {
      chrome.runtime.sendMessage({
        action: 'CROSS_TAB_COORDINATE',
        payload: { type, ...payload }
      }).catch(err => {
        // Service worker might not be available, ignore
        console.warn('Failed to notify service worker:', err);
      });
    } catch (error) {
      // Ignore errors when service worker is not available
    }
  }

  /**
   * Update current tab's analysis state
   */
  private updateAnalysisState(state: TabSession['analysisState']): void {
    if (!this.currentTabId) return;

    const session = this.activeTabs.get(this.currentTabId);
    if (session) {
      session.analysisState = state;
      session.lastActivity = Date.now();
    }
  }

  /**
   * Update activity timestamp
   */
  private updateActivity(): void {
    if (!this.currentTabId) return;

    const session = this.activeTabs.get(this.currentTabId);
    if (session) {
      session.lastActivity = Date.now();
    }
  }

  /**
   * Start heartbeat to maintain presence
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = window.setInterval(() => {
      this.updateActivity();
    }, 30000); // Every 30 seconds
  }

  /**
   * Get list of active tabs with their current state
   */
  getActiveTabs(): TabSession[] {
    return Array.from(this.activeTabs.values());
  }

  /**
   * Check if another tab is currently analyzing the same URL
   */
  isUrlBeingAnalyzed(url: string): boolean {
    for (const session of this.activeTabs.values()) {
      if (session.url === url && session.analysisState === 'analyzing' && session.tabId !== this.currentTabId) {
        return true;
      }
    }
    return false;
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate a pseudo tab ID for content scripts that can't access chrome.tabs
   */
  private generatePseudoTabId(): number {
    // Create a stable ID based on the URL for content scripts
    let hash = 0;
    const url = window.location.href;
    for (let i = 0; i < url.length; i++) {
      const char = url.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    this.broadcastChannel.close();
    this.listeners.clear();
    this.activeTabs.clear();
  }
}

// Export singleton instance
export const crossTabSync = new CrossTabSyncService();