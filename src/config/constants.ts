/**
 * Application-wide constants
 * Centralized configuration for timeouts, intervals, and other magic numbers
 */

// Polling and UI intervals (milliseconds)
export const TIMINGS = {
  // Poll interval for checking cache/analysis progress
  POLL_INTERVAL: 1500,
  
  // Fallback timeout for redundant cache check when storage events may be missed
  FALLBACK_CACHE_CHECK_TIMEOUT: 8000,
  
  // Small delay for API calls (e.g., WHOIS lookups)
  API_CALL_DELAY: 100,
  
  // Maintenance task execution interval
  MAINTENANCE_INTERVAL: 5000,
  
  // Cache cleanup execution interval
  CACHE_CLEANUP_INTERVAL: 10000,
  
  // Message passing timeout between extension components
  MESSAGE_TIMEOUT: 30000,
  
  // Retry backoff base delay
  RETRY_BACKOFF_BASE: 500,
  
  // Ping timeout for tab connectivity checks
  PING_TIMEOUT: 1000,
  
  // Request timeout for HTTP calls (10 seconds)
  REQUEST_TIMEOUT: 10000,
};

// Retry configuration
export const RETRY_CONFIG = {
  // Maximum retry attempts for failed operations
  MAX_RETRIES: 2,
  
  // Calculate exponential backoff: baseDelay * (attempt + 1)
  getBackoffDelay: (attempt: number) => TIMINGS.RETRY_BACKOFF_BASE * (attempt + 1),
};

// Cache configuration
export const CACHE_CONFIG = {
  // Cache entry expiration time in hours
  CACHE_DURATION_HOURS: 24,
};
