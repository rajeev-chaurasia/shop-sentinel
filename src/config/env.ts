/**
 * Environment Configuration
 * Centralized configuration for API endpoints
 * 
 * Uses Vite's import.meta.env for environment variables from .env.local
 * Falls back to defaults if not specified
 * 
 * Features always attempt to work with graceful error handling:
 * - If backend is unavailable, analysis continues with local caching
 * - If WebSocket fails, polling can be used instead
 * - No feature flags - simpler, more reliable architecture
 */

// API Configuration
export const API_CONFIG = {
  // Backend API base URL (e.g., http://localhost:3002 or https://api.shop-sentinel.com)
  BASE_URL: import.meta.env.VITE_BACKEND_API_URL || 'http://localhost:3002',
  
  // WebSocket URL for real-time updates (e.g., ws://localhost:3002 or wss://api.shop-sentinel.com)
  WS_URL: import.meta.env.VITE_BACKEND_WS_URL || 'ws://localhost:3002',
  
  // API Endpoints - constructed from BASE_URL
  ENDPOINTS: {
    // Job management endpoints
    JOBS: {
      CREATE: '/api/jobs',
      GET: (jobId: string) => `/api/jobs/${jobId}`,
      UPDATE: (jobId: string) => `/api/jobs/${jobId}`,
      LIST: '/api/jobs',
    },
    // Webhook endpoints
    WEBHOOKS: {
      REGISTER: '/api/webhooks',
      LIST: '/api/webhooks',
    },
  },
} as const;

/**
 * Construct full API URL for endpoints
 * @param endpoint - Relative endpoint path
 * @returns Full URL ready for fetch
 */
export function getApiUrl(endpoint: string): string {
  return `${API_CONFIG.BASE_URL}${endpoint}`;
}

/**
 * Get WebSocket URL
 * @returns WebSocket URL ready for ws connection
 */
export function getWsUrl(path: string = '/ws'): string {
  return `${API_CONFIG.WS_URL}${path}`;
}
