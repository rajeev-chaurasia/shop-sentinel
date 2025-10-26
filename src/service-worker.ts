/**
 * Background Service Worker
 * 
 * Handles background tasks including:
 * - Social media URL validation
 * - Network requests with proper error handling
 * - Message routing between content scripts and popup
 */

// Inline message utilities to avoid ES6 import issues in service worker
interface MessageRequest {
  action: string;
  payload: any;
  timestamp: number;
}

interface MessageResponse {
  success: boolean;
  data?: any;
  error?: string;
  timestamp: number;
}

function createSuccessResponse(data: any): MessageResponse {
  return {
    success: true,
    data,
    timestamp: Date.now(),
  };
}

function createErrorResponse(error: string): MessageResponse {
  return {
    success: false,
    error,
    timestamp: Date.now(),
  };
}

// Configuration constants
const VALIDATION_CONFIG = {
  REQUEST_TIMEOUT: 10000, // 10 seconds
  MAX_CONCURRENT_REQUESTS: 5,
  RETRY_ATTEMPTS: 2,
  RETRY_DELAY: 1000, // 1 second
  CACHE_DURATION: 5 * 60 * 1000, // 5 minutes
} as const;

// Types for tab state management
interface TabState {
  riskLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical';
  badgeText: string;
  url: string;
  timestamp: number;
}

// In-memory storage for tab states (persists during session)
const tabStates = new Map<number, TabState>();

/**
 * Update extension icon badge for a specific tab
 */
async function updateIconForTab(tabId: number, riskLevel: string, badgeText: string, url: string) {
  try {
    // Determine badge color based on risk level
    let badgeColor: [number, number, number, number];
    
    switch (riskLevel) {
      case 'safe':
        badgeColor = [16, 185, 129, 255]; // green-500
        break;
      case 'low':
        badgeColor = [132, 204, 22, 255]; // lime-500
        break;
      case 'medium':
        badgeColor = [245, 158, 11, 255]; // amber-500
        break;
      case 'high':
        badgeColor = [249, 115, 22, 255]; // orange-500
        break;
      case 'critical':
        badgeColor = [239, 68, 68, 255]; // red-500
        break;
      default:
        badgeColor = [156, 163, 175, 255]; // gray-400
    }
    
    // Set badge text and color for this specific tab
    await chrome.action.setBadgeText({ text: badgeText, tabId });
    await chrome.action.setBadgeBackgroundColor({ color: badgeColor, tabId });
    
    // Store tab state
    tabStates.set(tabId, {
      riskLevel: riskLevel as any,
      badgeText,
      url,
      timestamp: Date.now(),
    });
    
    console.log(`✅ Icon updated for tab ${tabId}: ${riskLevel} (${badgeText})`);
  } catch (error) {
    console.error(`❌ Failed to update icon for tab ${tabId}:`, error);
  }
}

/**
 * Clear badge for a specific tab
 */
async function clearIconForTab(tabId: number) {
  try {
    await chrome.action.setBadgeText({ text: '', tabId });
    tabStates.delete(tabId);
    console.log(`🧹 Badge cleared for tab ${tabId}`);
  } catch (error) {
    console.error(`❌ Failed to clear badge for tab ${tabId}:`, error);
  }
}

/**
 * Get stored tab state
 */
function getTabState(tabId: number): TabState | null {
  return tabStates.get(tabId) || null;
}

// Social media platform configurations
const SOCIAL_PLATFORMS = {
  facebook: {
    domains: ['facebook.com', 'fb.com'],
    patterns: [/facebook\.com\/[^\/]+/, /fb\.com\/[^\/]+/],
    userAgent: 'Mozilla/5.0 (compatible; ShopSentinel/1.0)',
  },
  twitter: {
    domains: ['twitter.com', 'x.com'],
    patterns: [/twitter\.com\/[^\/]+/, /x\.com\/[^\/]+/],
    userAgent: 'Mozilla/5.0 (compatible; ShopSentinel/1.0)',
  },
  instagram: {
    domains: ['instagram.com'],
    patterns: [/instagram\.com\/[^\/]+/],
    userAgent: 'Mozilla/5.0 (compatible; ShopSentinel/1.0)',
  },
  linkedin: {
    domains: ['linkedin.com'],
    patterns: [/linkedin\.com\/(company|in)\/[^\/]+/],
    userAgent: 'Mozilla/5.0 (compatible; ShopSentinel/1.0)',
  },
  youtube: {
    domains: ['youtube.com'],
    patterns: [/youtube\.com\/(@|c|channel)\/[^\/]+/],
    userAgent: 'Mozilla/5.0 (compatible; ShopSentinel/1.0)',
  },
  pinterest: {
    domains: ['pinterest.com'],
    patterns: [/pinterest\.com\/[^\/]+/],
    userAgent: 'Mozilla/5.0 (compatible; ShopSentinel/1.0)',
  },
  tiktok: {
    domains: ['tiktok.com'],
    patterns: [/tiktok\.com\/@[^\/]+/],
    userAgent: 'Mozilla/5.0 (compatible; ShopSentinel/1.0)',
  },
} as const;

// In-memory cache for URL validation results
const validationCache = new Map<string, {
  isValid: boolean;
  timestamp: number;
  platform: string;
  error?: string;
}>();

// Rate limiting constants for future use
const RATE_LIMIT_CONFIG = {
  MAX_CONCURRENT: 5,
  DELAY_BETWEEN_BATCHES: 500,
} as const;

/**
 * Social Media URL Validation Service
 * 
 * Validates social media URLs by checking if they return valid responses
 * Uses HEAD requests for efficiency and implements proper rate limiting
 */
class SocialMediaValidator {
  private static instance: SocialMediaValidator;

  private constructor() {}

  static getInstance(): SocialMediaValidator {
    if (!SocialMediaValidator.instance) {
      SocialMediaValidator.instance = new SocialMediaValidator();
    }
    return SocialMediaValidator.instance;
  }

  /**
   * Validate multiple social media URLs concurrently
   */
  async validateUrls(urls: Array<{
    platform: string;
    url: string;
    location: 'footer' | 'header' | 'body' | 'unknown';
  }>): Promise<Array<{
    platform: string;
    url: string;
    location: 'footer' | 'header' | 'body' | 'unknown';
    isValid: boolean;
    error?: string;
    validatedAt: number;
  }>> {
    console.log(`🔍 Validating ${urls.length} social media URLs...`);

    // Check cache first
    const cachedResults: Array<{
      platform: string;
      url: string;
      location: 'footer' | 'header' | 'body' | 'unknown';
      isValid: boolean;
      error?: string;
      validatedAt: number;
    }> = [];

    const urlsToValidate: Array<{
      platform: string;
      url: string;
      location: 'footer' | 'header' | 'body' | 'unknown';
    }> = [];

    for (const urlInfo of urls) {
      const cacheKey = this.getCacheKey(urlInfo.url);
      const cached = validationCache.get(cacheKey);

      if (cached && Date.now() - cached.timestamp < VALIDATION_CONFIG.CACHE_DURATION) {
        console.log(`✅ Cache hit for ${urlInfo.url}`);
        cachedResults.push({
          ...urlInfo,
          isValid: cached.isValid,
          error: cached.error,
          validatedAt: cached.timestamp,
        });
      } else {
        urlsToValidate.push(urlInfo);
      }
    }

    // Validate remaining URLs
    if (urlsToValidate.length === 0) {
      console.log('✅ All URLs found in cache');
      return cachedResults;
    }

    console.log(`🔍 Validating ${urlsToValidate.length} URLs not in cache...`);

    // Process URLs in batches to respect rate limits
    const batchSize = Math.min(RATE_LIMIT_CONFIG.MAX_CONCURRENT, urlsToValidate.length);
    const batches: Array<typeof urlsToValidate> = [];

    for (let i = 0; i < urlsToValidate.length; i += batchSize) {
      batches.push(urlsToValidate.slice(i, i + batchSize));
    }

    const validationResults: Array<{
      platform: string;
      url: string;
      location: 'footer' | 'header' | 'body' | 'unknown';
      isValid: boolean;
      error?: string;
      validatedAt: number;
    }> = [...cachedResults];

    for (const batch of batches) {
      const batchPromises = batch.map(urlInfo => this.validateSingleUrl(urlInfo));
      const batchResults = await Promise.allSettled(batchPromises);

      for (let i = 0; i < batch.length; i++) {
        const result = batchResults[i];
        if (result.status === 'fulfilled') {
          validationResults.push(result.value);
        } else {
          console.error(`❌ Validation failed for ${batch[i].url}:`, result.reason);
          validationResults.push({
            ...batch[i],
            isValid: false,
            error: result.reason instanceof Error ? result.reason.message : 'Validation failed',
            validatedAt: Date.now(),
          });
        }
      }

      // Add delay between batches to be respectful to social media platforms
      if (batches.indexOf(batch) < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_CONFIG.DELAY_BETWEEN_BATCHES));
      }
    }

    console.log(`✅ Validation complete: ${validationResults.length} URLs processed`);
    return validationResults;
  }

  /**
   * Validate a single social media URL
   */
  private async validateSingleUrl(urlInfo: {
    platform: string;
    url: string;
    location: 'footer' | 'header' | 'body' | 'unknown';
  }): Promise<{
    platform: string;
    url: string;
    location: 'footer' | 'header' | 'body' | 'unknown';
    isValid: boolean;
    error?: string;
    validatedAt: number;
  }> {
    const { platform, url } = urlInfo;
    const cacheKey = this.getCacheKey(url);

    try {
      // Normalize URL
      const normalizedUrl = this.normalizeUrl(url);
      if (!normalizedUrl) {
        throw new Error('Invalid URL format');
      }

      // Validate URL structure
      if (!this.isValidSocialMediaUrl(normalizedUrl, platform)) {
        throw new Error(`Invalid ${platform} URL format`);
      }

      // Perform HEAD request with timeout
      const isValid = await this.checkUrlExists(normalizedUrl, platform);
      const timestamp = Date.now();

      // Cache the result
      validationCache.set(cacheKey, {
        isValid,
        timestamp,
        platform,
      });

      return {
        ...urlInfo,
        isValid,
        validatedAt: timestamp,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const timestamp = Date.now();

      console.error(`❌ Validation error for ${url}:`, errorMessage);

      // Cache the error result
      validationCache.set(cacheKey, {
        isValid: false,
        timestamp,
        platform,
        error: errorMessage,
      });

      return {
        ...urlInfo,
        isValid: false,
        error: errorMessage,
        validatedAt: timestamp,
      };
    }
  }

  /**
   * Check if URL exists using HEAD request
   */
  private async checkUrlExists(url: string, platform: string): Promise<boolean> {
    const platformConfig = SOCIAL_PLATFORMS[platform as keyof typeof SOCIAL_PLATFORMS];
    if (!platformConfig) {
      throw new Error(`Unknown platform: ${platform}`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VALIDATION_CONFIG.REQUEST_TIMEOUT);

    try {
      const response = await fetch(url, {
        method: 'HEAD',
        headers: {
          'User-Agent': platformConfig.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
        signal: controller.signal,
        mode: 'no-cors', // Avoid CORS issues
      });

      clearTimeout(timeoutId);

      // Consider 200-299 and 300-399 as valid (redirects are OK)
      const isValid = response.status >= 200 && response.status < 400;
      
      console.log(`🔍 ${platform} URL ${url}: ${response.status} ${isValid ? '✅' : '❌'}`);
      return isValid;

    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error('Request timeout');
        }
        if (error.message.includes('CORS')) {
          // CORS errors might still indicate the URL exists
          console.log(`⚠️ CORS error for ${url}, assuming valid`);
          return true;
        }
        throw error;
      }
      throw new Error('Network error');
    }
  }

  /**
   * Normalize URL for validation
   */
  private normalizeUrl(url: string): string | null {
    try {
      // Handle relative URLs
      if (url.startsWith('/')) {
        return null; // We can't validate relative URLs
      }

      // Handle protocol-relative URLs
      if (url.startsWith('//')) {
        url = 'https:' + url;
      }

      // Handle URLs without protocol
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }

      const urlObj = new URL(url);
      
      // Remove fragments and query parameters for cleaner validation
      urlObj.hash = '';
      urlObj.search = '';
      
      return urlObj.toString();
    } catch {
      return null;
    }
  }

  /**
   * Validate URL format against platform patterns
   */
  private isValidSocialMediaUrl(url: string, platform: string): boolean {
    const platformConfig = SOCIAL_PLATFORMS[platform as keyof typeof SOCIAL_PLATFORMS];
    if (!platformConfig) {
      return false;
    }

    try {
      const urlObj = new URL(url);
      
      // Check domain
      const domainMatch = platformConfig.domains.some(domain => 
        urlObj.hostname === domain || urlObj.hostname.endsWith('.' + domain)
      );

      if (!domainMatch) {
        return false;
      }

      // Check URL pattern
      const patternMatch = platformConfig.patterns.some(pattern => 
        pattern.test(urlObj.pathname)
      );

      return patternMatch;
    } catch {
      return false;
    }
  }

  /**
   * Generate cache key for URL
   */
  private getCacheKey(url: string): string {
    try {
      const normalizedUrl = this.normalizeUrl(url);
      return normalizedUrl || url;
    } catch {
      return url;
    }
  }

  /**
   * Clear validation cache
   */
  clearCache(): void {
    validationCache.clear();
    console.log('🧹 Social media validation cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    entries: Array<{
      url: string;
      isValid: boolean;
      age: number;
      platform: string;
    }>;
  } {
    const now = Date.now();
    const entries = Array.from(validationCache.entries()).map(([url, data]) => ({
      url,
      isValid: data.isValid,
      age: now - data.timestamp,
      platform: data.platform,
    }));

    return {
      size: validationCache.size,
      entries,
    };
  }
}

// Message handlers
const messageHandlers = {
  /**
   * Validate social media URLs
   */
  VALIDATE_SOCIAL_URLS: async (payload: {
    urls: Array<{
      platform: string;
      url: string;
      location: 'footer' | 'header' | 'body' | 'unknown';
    }>;
  }): Promise<any> => {
    try {
      console.log('🔍 Service worker received VALIDATE_SOCIAL_URLS request:', payload);
      
      if (!payload?.urls || !Array.isArray(payload.urls)) {
        throw new Error('Invalid payload: urls array required');
      }

      if (payload.urls.length === 0) {
        console.log('✅ No URLs to validate, returning empty results');
        return [];
      }

      const validator = SocialMediaValidator.getInstance();
      const results = await validator.validateUrls(payload.urls);

      console.log(`✅ Social media validation complete: ${results.length} URLs processed`);
      return results;

    } catch (error) {
      console.error('❌ Social media validation error:', error);
      throw error;
    }
  },

  /**
   * Get validation cache statistics
   */
  GET_VALIDATION_STATS: async (): Promise<any> => {
    try {
      const validator = SocialMediaValidator.getInstance();
      return validator.getCacheStats();
    } catch (error) {
      console.error('❌ Error getting validation stats:', error);
      throw error;
    }
  },

  /**
   * Clear validation cache
   */
  CLEAR_VALIDATION_CACHE: async (): Promise<any> => {
    try {
      const validator = SocialMediaValidator.getInstance();
      validator.clearCache();
      return { success: true };
    } catch (error) {
      console.error('❌ Error clearing validation cache:', error);
      throw error;
    }
  },
};

/**
 * Cross-tab coordination state
 */
const crossTabState = new Map<string, {
  activeTabs: Set<number>;
  lastActivity: number;
  coordinatingTab?: number;
}>();

/**
 * Handle cross-tab coordination messages
 */
async function handleCrossTabCoordination(payload: any, sourceTabId?: number): Promise<void> {
  const { type, url } = payload;

  switch (type) {
    case 'ANALYSIS_START':
      // Register analysis start for coordination
      if (!crossTabState.has(url)) {
        crossTabState.set(url, {
          activeTabs: new Set(),
          lastActivity: Date.now()
        });
      }

      const state = crossTabState.get(url)!;
      state.activeTabs.add(sourceTabId!);
      state.coordinatingTab = sourceTabId;
      state.lastActivity = Date.now();

      console.log(`🚀 Cross-tab: Analysis started for ${url} by tab ${sourceTabId}`);
      break;

    case 'ANALYSIS_COMPLETE':
      // Clear coordination state when analysis completes
      if (crossTabState.has(url)) {
        const state = crossTabState.get(url)!;
        state.activeTabs.delete(sourceTabId!);

        // If this was the coordinating tab, clear the state
        if (state.coordinatingTab === sourceTabId) {
          crossTabState.delete(url);
          console.log(`✅ Cross-tab: Analysis completed for ${url}, clearing coordination`);
        }
      }
      break;

    case 'HEARTBEAT':
      // Update activity timestamp
      if (crossTabState.has(url)) {
        crossTabState.get(url)!.lastActivity = Date.now();
      }
      break;

    default:
      console.warn(`⚠️ Unknown cross-tab coordination type: ${type}`);
  }

  // Clean up stale coordination states (older than 10 minutes)
  const cutoff = Date.now() - (10 * 60 * 1000);
  for (const [urlKey, state] of crossTabState.entries()) {
    if (state.lastActivity < cutoff) {
      crossTabState.delete(urlKey);
      console.log(`🧹 Cleaned up stale cross-tab coordination for ${urlKey}`);
    }
  }
}

/**
 * Check if URL is currently being analyzed by another tab
 */
function isUrlBeingAnalyzed(url: string, excludeTabId?: number): boolean {
  const state = crossTabState.get(url);
  if (!state) return false;

  // Check if any other tab is actively analyzing
  for (const tabId of state.activeTabs) {
    if (tabId !== excludeTabId) {
      return true;
    }
  }

  return false;
}

/**
 * Message listener for background service worker
 */
chrome.runtime.onMessage.addListener((
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: MessageResponse) => void
): boolean => {
  console.log('📨 Service worker received message:', message);
  
  if (!message || typeof message !== 'object' || !('action' in message)) {
    console.error('❌ Invalid message format');
    sendResponse(createErrorResponse('Invalid message format'));
    return false;
  }

  const typedMessage = message as MessageRequest;
  console.log(`🔍 Handling action: ${typedMessage.action}`);
  
  // Handle special cases that need sender information
  const tabId = sender.tab?.id;
  
  switch (typedMessage.action) {
    case 'UPDATE_ICON':
      // Handle both content script (with sender.tab) and popup messages
      let targetTabId = tabId;
      
      if (!targetTabId) {
        // If no tabId from sender (popup message), get the active tab
        try {
          // This is async, so we need to handle it differently
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTab = tabs[0];
            if (activeTab?.id) {
              const { riskLevel, badgeText } = typedMessage.payload;
              const url = activeTab.url || '';
              updateIconForTab(activeTab.id, riskLevel, badgeText, url)
                .then(() => {
                  // Send response if still waiting
                  try {
                    if (sendResponse) {
                      sendResponse(createSuccessResponse({ success: true }));
                    }
                  } catch (e) {
                    // Response already sent
                  }
                })
                .catch(error => {
                  try {
                    if (sendResponse) {
                      sendResponse(createErrorResponse(error.message));
                    }
                  } catch (e) {
                    // Response already sent
                  }
                });
            } else {
              sendResponse(createErrorResponse('No active tab found'));
            }
          });
          return true; // Keep channel open for async response
        } catch (error) {
          sendResponse(createErrorResponse('Failed to get active tab'));
          return false;
        }
      } else {
        // Content script message with tabId
        const { riskLevel, badgeText } = typedMessage.payload;
        const url = sender.tab?.url || '';
        updateIconForTab(targetTabId, riskLevel, badgeText, url)
          .then(() => sendResponse(createSuccessResponse({ success: true })))
          .catch(error => sendResponse(createErrorResponse(error.message)));
        return true;
      }
      
    case 'CLEAR_ICON':
      if (tabId) {
        clearIconForTab(tabId)
          .then(() => sendResponse(createSuccessResponse({ success: true })))
          .catch(error => sendResponse(createErrorResponse(error.message)));
        return true;
      } else {
        sendResponse(createErrorResponse('No tab ID available'));
        return false;
      }
      
    case 'GET_TAB_STATE':
      if (tabId) {
        const state = getTabState(tabId);
        sendResponse(createSuccessResponse(state));
      } else {
        sendResponse(createErrorResponse('No tab ID available'));
      }
      return false;
      
    case 'SET_TAB_STATE':
      if (tabId && typedMessage.payload) {
        const { riskLevel, badgeText, url } = typedMessage.payload;
        updateIconForTab(tabId, riskLevel, badgeText, url)
          .then(() => sendResponse(createSuccessResponse({ success: true })))
          .catch(error => sendResponse(createErrorResponse(error.message)));
        return true;
      } else {
        sendResponse(createErrorResponse('Invalid payload or tab ID'));
        return false;
      }
      
    case 'CLEAR_TAB_STATE':
      if (tabId) {
        clearIconForTab(tabId)
          .then(() => sendResponse(createSuccessResponse({ success: true })))
          .catch(error => sendResponse(createErrorResponse(error.message)));
        return true;
      } else {
        sendResponse(createErrorResponse('No tab ID available'));
        return false;
      }
      
    case 'GET_TAB_ID':
      if (tabId) {
        sendResponse(createSuccessResponse({ tabId }));
      } else {
        sendResponse(createErrorResponse('No tab ID available'));
      }
      return false;
      
    case 'CROSS_TAB_COORDINATE':
      // Handle cross-tab coordination messages
      if (typedMessage.payload && typedMessage.payload.type) {
        handleCrossTabCoordination(typedMessage.payload, tabId)
          .then(() => sendResponse(createSuccessResponse({ success: true })))
          .catch((error: any) => sendResponse(createErrorResponse(error.message)));
        return true;
      } else {
        sendResponse(createErrorResponse('Invalid cross-tab coordination payload'));
        return false;
      }
  }
  
  // Handle other actions with the messageHandlers object
  const handler = messageHandlers[typedMessage.action as keyof typeof messageHandlers];

  if (!handler) {
    console.error(`❌ No handler for action: ${typedMessage.action}`);
    sendResponse(createErrorResponse(`No handler for action: ${typedMessage.action}`));
    return false;
  }

  try {
    const result = handler(typedMessage.payload);

    if (result instanceof Promise) {
      result
        .then((data) => {
          try {
            console.log(`✅ Handler ${typedMessage.action} completed successfully`);
            sendResponse(createSuccessResponse(data));
          } catch (responseError) {
            console.error('❌ Error sending success response:', responseError);
          }
        })
        .catch((error) => {
          try {
            console.error(`❌ Handler ${typedMessage.action} failed:`, error);
            sendResponse(createErrorResponse(error.message || 'Handler error'));
          } catch (responseError) {
            console.error('❌ Error sending error response:', responseError);
          }
        });
      return true; // Keep channel open for async response
    }

    console.log(`✅ Synchronous handler ${typedMessage.action} completed`);
    sendResponse(createSuccessResponse(result));
    return false;
  } catch (error: any) {
    console.error(`❌ Synchronous handler ${typedMessage.action} error:`, error);
    sendResponse(createErrorResponse(error.message || 'Handler execution error'));
    return false;
  }
});

// Tab event listeners for badge management
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tabId = activeInfo.tabId;
  const state = getTabState(tabId);
  
  if (state) {
    console.log(`🔄 Tab ${tabId} activated - restoring badge:`, state.riskLevel);
    await updateIconForTab(tabId, state.riskLevel, state.badgeText, state.url);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, _tab) => {
  // Only act on navigation (URL changed and page started loading)
  if (changeInfo.status === 'loading' && changeInfo.url) {
    const storedState = getTabState(tabId);
    
    // If URL changed, clear the old badge
    if (storedState && storedState.url !== changeInfo.url) {
      console.log(`🔄 Tab ${tabId} navigated to new URL - clearing badge`);
      await clearIconForTab(tabId);
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabStates.has(tabId)) {
    console.log(`🗑️ Tab ${tabId} closed - removing state`);
    tabStates.delete(tabId);
  }
});

// Service worker lifecycle events
chrome.runtime.onStartup.addListener(() => {
  console.log('🚀 Shop Sentinel service worker started');
  initializeBackgroundTasks();
});

chrome.runtime.onInstalled.addListener((details) => {
  console.log('📦 Shop Sentinel service worker installed:', details.reason);
  
  if (details.reason === 'install') {
    console.log('🎉 Shop Sentinel extension installed successfully!');
    initializeBackgroundTasks();
  } else if (details.reason === 'update') {
    console.log('🔄 Shop Sentinel extension updated');
    initializeBackgroundTasks();
  }
});

// Enhanced background task management
class BackgroundTaskManager {
  private static instance: BackgroundTaskManager;
  private maintenanceInterval: number | null = null;
  private cacheCleanupInterval: number | null = null;
  private retryQueue: Array<{
    id: string;
    action: string;
    payload: any;
    attempts: number;
    nextRetry: number;
  }> = [];
  private isOnline: boolean = navigator.onLine;

  private constructor() {}

  static getInstance(): BackgroundTaskManager {
    if (!BackgroundTaskManager.instance) {
      BackgroundTaskManager.instance = new BackgroundTaskManager();
    }
    return BackgroundTaskManager.instance;
  }

  /**
   * Initialize all background tasks
   */
  initialize(): void {
    this.startMaintenanceTasks();
    this.startCacheCleanup();
    this.setupNetworkListeners();
    this.processRetryQueue();
  }

  /**
   * Start periodic maintenance tasks
   */
  private startMaintenanceTasks(): void {
    // Run maintenance every 30 minutes
    this.maintenanceInterval = self.setInterval(() => {
      this.performMaintenance();
    }, 30 * 60 * 1000);

    // Initial maintenance run
    setTimeout(() => this.performMaintenance(), 5000);
  }

  /**
   * Start cache cleanup tasks
   */
  private startCacheCleanup(): void {
    // Clean up expired cache entries every 15 minutes
    this.cacheCleanupInterval = self.setInterval(() => {
      this.cleanupExpiredCache();
    }, 15 * 60 * 1000);

    // Initial cleanup
    setTimeout(() => this.cleanupExpiredCache(), 10000);
  }

  /**
   * Set up network status listeners
   */
  private setupNetworkListeners(): void {
    self.addEventListener('online', () => {
      console.log('🌐 Network connection restored');
      this.isOnline = true;
      this.processRetryQueue();
    });

    self.addEventListener('offline', () => {
      console.log('📴 Network connection lost');
      this.isOnline = false;
    });
  }

  /**
   * Perform periodic maintenance tasks
   */
  private async performMaintenance(): Promise<void> {
    try {
      console.log('🔧 Running background maintenance...');

      // Clean up old tab states
      this.cleanupTabStates();

      // Validate cache integrity
      await this.validateCacheIntegrity();

      // Update statistics
      this.updateBackgroundStats();

      console.log('✅ Background maintenance completed');
    } catch (error) {
      console.error('❌ Background maintenance failed:', error);
    }
  }

  /**
   * Clean up expired cache entries
   */
  private async cleanupExpiredCache(): Promise<void> {
    try {
      console.log('🧹 Cleaning up expired cache entries...');

      const now = Date.now();
      let cleanedCount = 0;

      // Clean up validation cache
      for (const [key, entry] of validationCache.entries()) {
        if (now - entry.timestamp > VALIDATION_CONFIG.CACHE_DURATION) {
          validationCache.delete(key);
          cleanedCount++;
        }
      }

      // Clean up Chrome storage cache entries
      const allStorage = await chrome.storage.local.get(null);
      const expiredKeys: string[] = [];

      for (const [key, value] of Object.entries(allStorage)) {
        if (key.startsWith('analysis_') && typeof value === 'object' && value !== null) {
          const cached = value as any;
          if (cached.expiresAt && now > cached.expiresAt) {
            expiredKeys.push(key);
            cleanedCount++;
          }
        }
      }

      if (expiredKeys.length > 0) {
        await chrome.storage.local.remove(expiredKeys);
        console.log(`🗑️ Removed ${expiredKeys.length} expired storage cache entries`);
      }

      console.log(`✅ Cache cleanup completed: ${cleanedCount} entries removed`);
    } catch (error) {
      console.error('❌ Cache cleanup failed:', error);
    }
  }

  /**
   * Clean up old tab states
   */
  private cleanupTabStates(): void {
    const now = Date.now();
    const cutoff = now - (60 * 60 * 1000); // 1 hour ago

    let cleanedCount = 0;
    for (const [tabId, state] of tabStates.entries()) {
      if (now - state.timestamp > cutoff) {
        tabStates.delete(tabId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} stale tab states`);
    }
  }

  /**
   * Validate cache integrity
   */
  private async validateCacheIntegrity(): Promise<void> {
    try {
      const allStorage = await chrome.storage.local.get(null);
      let invalidCount = 0;

      for (const [key, value] of Object.entries(allStorage)) {
        if (key.startsWith('analysis_')) {
          if (!this.isValidCacheEntry(value)) {
            await chrome.storage.local.remove(key);
            invalidCount++;
          }
        }
      }

      if (invalidCount > 0) {
        console.log(`🔧 Fixed ${invalidCount} invalid cache entries`);
      }
    } catch (error) {
      console.error('❌ Cache integrity validation failed:', error);
    }
  }

  /**
   * Check if a cache entry is valid
   */
  private isValidCacheEntry(entry: any): boolean {
    return (
      entry &&
      typeof entry === 'object' &&
      typeof entry.result === 'object' &&
      typeof entry.expiresAt === 'number' &&
      entry.expiresAt > Date.now()
    );
  }

  /**
   * Update background processing statistics
   */
  private updateBackgroundStats(): void {
    const stats = {
      tabStatesCount: tabStates.size,
      validationCacheSize: validationCache.size,
      retryQueueSize: this.retryQueue.length,
      isOnline: this.isOnline,
      timestamp: Date.now()
    };

    // Store stats in memory for debugging (could be persisted if needed)
    (self as any).backgroundStats = stats;
  }

  /**
   * Add operation to retry queue for offline scenarios
   */
  addToRetryQueue(action: string, payload: any): string {
    const retryId = `retry_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    this.retryQueue.push({
      id: retryId,
      action,
      payload,
      attempts: 0,
      nextRetry: Date.now() + 5000 // Initial retry in 5 seconds
    });

    console.log(`📋 Added ${action} to retry queue (${retryId})`);
    return retryId;
  }

  /**
   * Process retry queue when online
   */
  private async processRetryQueue(): Promise<void> {
    if (!this.isOnline || this.retryQueue.length === 0) return;

    console.log(`🔄 Processing ${this.retryQueue.length} items in retry queue...`);

    const now = Date.now();
    const toProcess = this.retryQueue.filter(item => item.nextRetry <= now);

    for (const item of toProcess) {
      try {
        await this.executeRetryItem(item);
        // Remove successful items
        this.retryQueue = this.retryQueue.filter(i => i.id !== item.id);
        console.log(`✅ Retry successful for ${item.action}`);
      } catch (error) {
        item.attempts++;
        if (item.attempts >= 3) {
          // Remove after 3 failed attempts
          this.retryQueue = this.retryQueue.filter(i => i.id !== item.id);
          console.error(`❌ Retry failed permanently for ${item.action}:`, error);
        } else {
          // Exponential backoff
          item.nextRetry = now + Math.pow(2, item.attempts) * 30000; // 30s, 1m, 2m
          console.log(`⏳ Retry scheduled for ${item.action} (attempt ${item.attempts + 1})`);
        }
      }
    }
  }

  /**
   * Execute a retry queue item
   */
  private async executeRetryItem(item: any): Promise<void> {
    // This would contain the actual retry logic based on the action type
    switch (item.action) {
      case 'VALIDATE_SOCIAL_URLS':
        await SocialMediaValidator.getInstance().validateUrls(item.payload.urls);
        break;
      default:
        throw new Error(`Unknown retry action: ${item.action}`);
    }
  }

  /**
   * Shutdown background tasks
   */
  shutdown(): void {
    if (this.maintenanceInterval) {
      clearInterval(this.maintenanceInterval);
      this.maintenanceInterval = null;
    }
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
      this.cacheCleanupInterval = null;
    }
  }
}

// Initialize background tasks
async function initializeBackgroundTasks(): Promise<void> {
  // Import cleanup function dynamically to avoid ES6 import issues in service worker
  try {
    const { cleanupStorageOnStartup } = await import('./services/cleanup');
    await cleanupStorageOnStartup();
  } catch (error) {
    console.warn('⚠️ Could not run storage cleanup:', error);
  }
  
  BackgroundTaskManager.getInstance().initialize();
}

// Cleanup on service worker shutdown
self.addEventListener('beforeunload', () => {
  console.log('🛑 Shop Sentinel service worker shutting down');
  BackgroundTaskManager.getInstance().shutdown();
});

console.log('🛡️ Shop Sentinel service worker loaded with enhanced background processing');
