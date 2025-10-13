/**
 * Background Service Worker
 * 
 * Handles background tasks including:
 * - Social media URL validation
 * - Network requests with proper error handling
 * - Message routing between content scripts and popup
 * 
 * This service worker implements TG-11: Social Proof Audit
 * with production-quality error handling and performance optimization.
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
 * Message listener for background service worker
 */
chrome.runtime.onMessage.addListener((
  message: unknown,
  _sender: chrome.runtime.MessageSender,
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

// Service worker lifecycle events
chrome.runtime.onStartup.addListener(() => {
  console.log('🚀 Shop Sentinel service worker started');
});

chrome.runtime.onInstalled.addListener((details) => {
  console.log('📦 Shop Sentinel service worker installed:', details.reason);
  
  if (details.reason === 'install') {
    console.log('🎉 Shop Sentinel extension installed successfully!');
  } else if (details.reason === 'update') {
    console.log('🔄 Shop Sentinel extension updated');
  }
});

// Cleanup on service worker shutdown
self.addEventListener('beforeunload', () => {
  console.log('🛑 Shop Sentinel service worker shutting down');
  // Clear any pending timeouts or intervals if needed
});

console.log('🛡️ Shop Sentinel service worker loaded');
