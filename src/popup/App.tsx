import { useEffect, useState } from 'react';
import { useAnalysisStore } from '../stores';
import { MessagingService } from '../services/messaging';
import { StorageService } from '../services/storage';
import { cacheService } from '../services/cache';
import { crossTabSync } from '../services/crossTabSync';
import type { AnalysisResult } from '../types';
import { RiskMeter, ReasonsList, PolicySummary } from '../components';
import { createErrorFromMessage } from '../types/errors';

function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'reasons' | 'policies'>('overview');
  const [useAI, setUseAI] = useState(true);
  const [isFromCache, setIsFromCache] = useState(false);
  const [pollInterval, setPollInterval] = useState<number | null>(null);
  const [annotationsVisible, setAnnotationsVisible] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false); // Prevent race conditions
  const [operationLock, setOperationLock] = useState(false); // Global lock for all operations
  const [isInitializing, setIsInitializing] = useState(true); // Show brief loading during init
  
  const {
    currentUrl,
    analysisResult,
    partialResult,
    isLoading,
    error,
    analysisProgress,
    startAnalysis,
    setAnalysisResult,
    setPartialResult,
    completeAnalysis,
    setError,
  } = useAnalysisStore();

  // Use full results if available, otherwise partial results
  const currentResult = analysisResult || partialResult;
  
  // Determine if we should show offline mode
  // Only show offline mode for final results or when we're sure AI is unavailable
  const showOfflineMode = analysisResult ? !analysisResult.aiEnabled : false;

  // Helper to prevent concurrent operations
  const withOperationLock = async <T,>(operation: () => Promise<T>): Promise<T | null> => {
    if (operationLock) {
      console.log('⏸️ Operation in progress, skipping');
      return null;
    }
    
    setOperationLock(true);
    try {
      return await operation();
    } finally {
      setOperationLock(false);
    }
  };

  // Validate that an object is a full AnalysisResult (not an in-progress/status payload)
  const isValidAnalysisResult = (data: any): data is AnalysisResult => {
    return (
      data && typeof data === 'object' &&
      typeof data.totalRiskScore === 'number' &&
      typeof data.riskLevel === 'string' &&
      data.security && typeof data.security === 'object' &&
      Array.isArray(data.allSignals)
    );
  };

  // Update icon badge when loading cached results
  const updateIconForCachedResult = async (result: AnalysisResult) => {
    try {
      const riskLevel = result.riskLevel || 'safe';
      const badgeText = result.totalRiskScore > 0 ? result.totalRiskScore.toString() : '';
      
      // Send UPDATE_ICON message to the active tab's content script
      await MessagingService.sendToActiveTab('UPDATE_ICON', { riskLevel, badgeText });
      console.log(`✅ Icon update sent to content script: ${riskLevel} (${badgeText})`);
    } catch (error) {
      console.error('❌ Failed to update icon for cached result:', error);
    }
  };

  useEffect(() => {
    initializePopup();
    
    return () => {
      // Cleanup polling interval on unmount
      if (pollInterval) {
        clearInterval(pollInterval);
        setPollInterval(null);
      }
    };
  }, []);

  // Poll for results when in loading state (non-blocking, no isUpdating guard)
  useEffect(() => {
    let currentInterval: number | null = null;
    
    if (isLoading && !pollInterval) {
      console.log('⏳ Starting poll for analysis completion');
      const interval = setInterval(async () => {
        try {
          const tab = await MessagingService.getActiveTab();
          if (!tab?.url) return;

          const pageInfoResponse = await MessagingService.sendToActiveTab('GET_PAGE_INFO');
          if (!pageInfoResponse.success || !pageInfoResponse.data) return;

          const pageType = pageInfoResponse.data.pageType || 'other';
          const cached = await StorageService.getCachedAnalysis(tab.url, pageType);
          if (cached && isValidAnalysisResult(cached)) {
            console.log(`✅ Analysis completed! Loading result (${pageType})...`);
            setAnalysisResult(cached);
            // Update icon badge for cached results
            updateIconForCachedResult(cached);
            completeAnalysis();
            clearInterval(interval);
            setPollInterval(null);
          }
        } catch (error) {
          console.error('Poll error:', error);
        }
      }, 1500);

      currentInterval = interval;
      setPollInterval(interval);
    } else if (!isLoading && pollInterval) {
      clearInterval(pollInterval);
      setPollInterval(null);
    }
    
    // Cleanup function
    return () => {
      if (currentInterval) {
        clearInterval(currentInterval);
      }
    };
  }, [isLoading, pollInterval]);

  // Safety net: in case storage event is missed, re-check cache once after 8s of loading
  useEffect(() => {
    if (!isLoading) return;
    const timeout = setTimeout(() => {
      loadCachedAnalysis();
    }, 8000);
    
    return () => clearTimeout(timeout);
  }, [isLoading]);

  // Monitor cross-tab storage changes for live updates
  useEffect(() => {
    let updateTimeout: number | null = null;
    let isMounted = true;
    
    const handleStorageChange = async (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName !== 'local' || !isMounted) return;
      
      // Debounce the update
      if (updateTimeout) {
        clearTimeout(updateTimeout);
      }
      
      updateTimeout = setTimeout(async () => {
        if (!isMounted) return;
        
        try {
          const tab = await MessagingService.getActiveTab();
          if (!tab?.url) return;
          
          const pageInfoResponse = await MessagingService.sendToActiveTab('GET_PAGE_INFO');
          if (!pageInfoResponse.success || !pageInfoResponse.data) return;
          
          const pageType = pageInfoResponse.data.pageType || 'other';
          const domain = new URL(tab.url).hostname.replace(/^www\./, '');
          const prefix = `analysis_${domain}:${pageType}`; // may include :path suffix

          // Find any changed key for this domain+pageType (path-scoped or not)
          const relevantKey = Object.keys(changes).find(k => k.startsWith(prefix));
          if (relevantKey) {
            const change = changes[relevantKey];
            if (change && change.newValue) {
              console.log('📡 Analysis updated via storage change:', relevantKey);
              const cached = change.newValue as any;
              
              // Handle new format: { result, expiresAt }
              if (cached.result && cached.expiresAt && Date.now() < cached.expiresAt) {
                if (isValidAnalysisResult(cached.result)) {
                  setAnalysisResult(cached.result);
                  setIsFromCache(true);
                  // Update icon badge for cached results
                  updateIconForCachedResult(cached.result);
                  if (isLoading) completeAnalysis();
                }
              }
              // Legacy support: direct result object (shouldn't happen with new storage format)
              else if (isValidAnalysisResult(cached)) {
                setAnalysisResult(cached);
                setIsFromCache(true);
                // Update icon badge for cached results
                updateIconForCachedResult(cached);
                if (isLoading) completeAnalysis();
              }
            }
          }
        } catch (error) {
          console.error('Error handling storage change:', error);
        } finally {
          setIsUpdating(false);
        }
      }, 300); // 300ms debounce to batch rapid changes
    };
    
    chrome.storage.onChanged.addListener(handleStorageChange);
    
    return () => {
      isMounted = false;
      chrome.storage.onChanged.removeListener(handleStorageChange);
      if (updateTimeout) {
        clearTimeout(updateTimeout);
      }
    };
  }, [isLoading, isUpdating]);

  // Listen for partial analysis results from content script
  useEffect(() => {
    const handleRuntimeMessage = (message: any) => {
      if (message.action === 'PARTIAL_ANALYSIS_RESULT' && message.payload) {
        console.log('📊 Received partial analysis result:', message.payload.phase);
        setPartialResult(message.payload);
      }
    };

    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    
    return () => {
      chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
    };
  }, [setPartialResult]);

  // Listen for cross-tab synchronization messages
  useEffect(() => {
    const unsubscribeAnalysisUpdate = crossTabSync.on('ANALYSIS_UPDATE', (message) => {
      console.log('🔄 Cross-tab analysis update received:', message.payload);
      // Update local state if the URL matches
      if (message.payload.url === currentUrl && message.payload.result) {
        setAnalysisResult(message.payload.result);
        setIsFromCache(false);
        completeAnalysis();
      }
    });

    const unsubscribeCacheInvalidation = crossTabSync.on('CACHE_INVALIDATION', (message) => {
      console.log('🗑️ Cross-tab cache invalidation:', message.payload);
      // Clear local cache if URL matches
      if (message.payload.url === currentUrl) {
        setIsFromCache(false);
        // Optionally reload cached analysis
        loadCachedAnalysis();
      }
    });

    const unsubscribeAnalysisStart = crossTabSync.on('ANALYSIS_START', (message) => {
      console.log('🚀 Cross-tab analysis started:', message.payload);
      // Show that another tab is analyzing the same URL
      if (message.payload.url === currentUrl && !isLoading) {
        console.log('📋 Another tab is analyzing this URL - staying synced');
      }
    });

    return () => {
      unsubscribeAnalysisUpdate();
      unsubscribeCacheInvalidation();
      unsubscribeAnalysisStart();
    };
  }, [currentUrl, isLoading]);

  const initializePopup = async () => {
    setIsInitializing(true);
    
    try {
      // Initialize cross-tab sync
      await crossTabSync.initialize();

      await testConnection();
      
      // Fast cache loading - prioritize showing cached results immediately
      await loadCachedAnalysisFast();
      
      // Then do the full analysis check in background
      loadCachedAnalysisFull();
    } finally {
      // Hide initializing state after a brief moment to show results
      setTimeout(() => setIsInitializing(false), 500);
    }
  };

  const testConnection = async () => {
    try {
      const response = await MessagingService.sendToActiveTab('PING');
      if (response.success) {
        console.log('✅ Connection successful:', response.data);
      }
    } catch (error) {
      console.error('❌ Connection failed:', error);
      setError(createErrorFromMessage('Connection to website failed - check your internet connection'));
    }
  };

  // Fast cache loading - immediately show cached results without complex checks
  const loadCachedAnalysisFast = async () => {
    try {
      const tab = await MessagingService.getActiveTab();
      if (!tab?.url) return;

      // Try to get cached analysis for common page types immediately using fast cache service
      const commonPageTypes = ['product', 'checkout', 'home', 'category'];
      
      for (const pageType of commonPageTypes) {
        try {
          const cached = await cacheService.get(tab.url, pageType);
          if (cached && isValidAnalysisResult(cached)) {
            console.log(`🚀 Fast cache hit for ${pageType}:`, cached);
            setAnalysisResult(cached);
            setIsFromCache(true);
            return; // Found cached result, stop looking
          }
        } catch (e) {
          // Continue to next page type
        }
      }
      
      console.log('⚡ No fast cache found, will check thoroughly');
    } catch (error) {
      console.warn('Fast cache loading failed:', error);
    }
  };

  // Full cache loading with page type detection and analysis state checking
  const loadCachedAnalysisFull = async () => {
    return withOperationLock(async () => {
      try {
        const tab = await MessagingService.getActiveTab();
        if (!tab?.url) return;

        // Get current page type from content script
        console.log('🔍 Getting page type for:', tab.url);
        const pageInfoResponse = await MessagingService.sendToActiveTab('GET_PAGE_INFO');
        
        if (!pageInfoResponse.success || !pageInfoResponse.data) {
          console.log('❌ Could not get page info');
          return;
        }

        const pageType = pageInfoResponse.data.pageType || 'other';
        const confidence = pageInfoResponse.data.pageTypeConfidence || 0;
        console.log(`📄 Detected page type: ${pageType} (confidence: ${confidence}%)`);

        // Check if analysis is in progress for THIS specific page type
        const inProgress = await StorageService.isAnalysisInProgress(tab.url, pageType);
        if (inProgress) {
          console.log(`⏳ Analysis in progress for ${pageType}, entering loading state`);
          startAnalysis(tab.url);
          return;
        }

        // Check cache only for this specific page type
        console.log(`🔍 Checking cache for: ${tab.url} (${pageType})`);
        const cached = await StorageService.getCachedAnalysis(tab.url, pageType);
        
        if (cached && isValidAnalysisResult(cached)) {
          // Only update if we don't already have a result from fast loading
          if (!analysisResult) {
            console.log(`✅ Cache hit for ${pageType}:`, cached);
            setAnalysisResult(cached);
            setIsFromCache(true);
          }
        } else {
          console.log(`❌ No cache found for ${pageType} - ready to analyze`);
          setIsFromCache(false);
        }
      } catch (error) {
        console.error('Failed to load cache:', error);
        setError(createErrorFromMessage('Failed to load cached analysis - storage access error'));
      }
    });
  };

  // Keep the old function name for backward compatibility
  const loadCachedAnalysis = loadCachedAnalysisFull;

  // New: Intelligent Scan (cache-first, then analyze)
  const handleSmartScan = async () => {
    return withOperationLock(async () => {
      try {
        const tab = await MessagingService.getActiveTab();
      if (!tab?.url) {
        setError(createErrorFromMessage('No active browser tab found - please make sure you have a website open'));
        return;
      }

      // Ask content script for page type first
      const pageInfoResponse = await MessagingService.sendToActiveTab('GET_PAGE_INFO');
      if (!pageInfoResponse.success || !pageInfoResponse.data) {
        // Fallback to full analyze if page info fails
        await handleAnalyze(false);
        return;
      }

      const pageType = pageInfoResponse.data.pageType || 'other';

      // Try cache for this specific page type (domain:pageType:path)
      const cached = await StorageService.getCachedAnalysis(tab.url, pageType);
      if (cached) {
        // Immediate UI update from cache
        setAnalysisResult(cached);
        completeAnalysis();
        return;
      }

      // Cache miss → try delta mode if we have any cached analysis for this domain
      const latestForDomain = await StorageService.getLatestDomainAnalysis(tab.url, pageType);
      if (latestForDomain && new URL(latestForDomain.url).hostname.replace(/^www\./,'') === new URL(tab.url).hostname.replace(/^www\./,'')) {
        // Ask content script to run fast delta analysis (reuse domain/contact/security)
        startAnalysis(tab.url);
        const response = await MessagingService.sendToActiveTab<any, AnalysisResult>(
          'ANALYZE_PAGE',
          { url: tab.url, includeAI: useAI, delta: true }
        );
        if (response.success && response.data) {
          setAnalysisResult(response.data);
          completeAnalysis();
          // Cache is saved in content script
          return;
        }
      }

      // Fallback: full analysis
      await handleAnalyze(false);
    } catch (error) {
      setError(createErrorFromMessage(error));
    }
    });
  };

  const handleAnalyze = async (force = false) => {
    // Guard against concurrent analysis requests
    if (isUpdating) {
      console.log('⏸️ Update in progress, please wait');
      return;
    }
    
    try {
      setIsUpdating(true);
      setIsFromCache(false); // Reset cache flag for fresh analysis
      
      const tab = await MessagingService.getActiveTab();
      if (!tab?.url) {
        setError(createErrorFromMessage('No active browser tab found - please make sure you have a website open'));
        return;
      }

      // If forcing refresh, clear cache first
      if (force) {
        await StorageService.clearCachedAnalysis(tab.url);
      }

      startAnalysis(tab.url);

      const response = await MessagingService.sendToActiveTab<any, AnalysisResult>(
        'ANALYZE_PAGE',
        { url: tab.url, includeAI: useAI }
      );

      if (response.success && response.data) {
        console.log('✅ Analysis complete, caching result for:', tab.url);
        if (isValidAnalysisResult(response.data)) {
          setAnalysisResult(response.data);
          completeAnalysis();
        } else {
          console.log('ℹ️ Non-final response received; waiting for cache/storage update');
        }
        
        // Cache the result with pageType from the analysis
        const pageType = response.data.pageType || 'other';
        const cached = await StorageService.cacheAnalysis(tab.url, pageType, response.data);
        console.log('💾 Cache saved:', cached);
        
      } else {
        setError(createErrorFromMessage(response.error || 'Website analysis failed - content script error'));
      }
    } catch (error) {
      setError(createErrorFromMessage(error));
    } finally {
      setIsUpdating(false);
    }
  };

  const handleToggleAnnotations = async () => {
    try {
      if (annotationsVisible) {
        // Clear annotations
        const response = await MessagingService.sendToActiveTab('CLEAR_HIGHLIGHTS');
        if (response.success) {
          setAnnotationsVisible(false);
          console.log('✅ Annotations cleared');
        }
      } else {
        // Show annotations with mock data (TG-07 will provide real data)
        const response = await MessagingService.sendToActiveTab('HIGHLIGHT_ELEMENTS', {
          // TODO [TG-07 Integration]: Replace with real AI elements
          // Currently using mock data from annotator
          elements: undefined, // Will use MOCK_ANNOTATIONS in content script
        });
        
        if (response.success) {
          setAnnotationsVisible(true);
          console.log(`✅ Annotations displayed: ${response.data?.highlighted || 0} elements`);
        }
      }
    } catch (error) {
      console.error('❌ Error toggling annotations:', error);
      setError(createErrorFromMessage(error));
    }
  };

  return (
    <div className="w-[420px] min-h-[600px] bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700">
      <div className="h-full flex flex-col bg-white">
        <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-purple-800 px-5 py-4 text-white shadow-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-white bg-opacity-25 rounded-full flex items-center justify-center backdrop-blur-sm shadow-lg border-2 border-white border-opacity-30">
                <span className="text-3xl">🛡️</span>
              </div>
              <div>
                <h1 className="text-xl font-black leading-tight tracking-tight">Shop Sentinel</h1>
                <p className="text-xs opacity-95 font-semibold">AI-Powered Shopping Safety</p>
              </div>
            </div>
            <div className="w-9 h-9 bg-white bg-opacity-25 rounded-full flex items-center justify-center backdrop-blur-sm shadow-lg border-2 border-white border-opacity-30">
              <span className="text-xl">⚡</span>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          {error && (
            <div className="mx-4 mt-4 animate-slideUp">
              <div className={`border-2 rounded-xl p-4 shadow-sm ${
                error.userMessage.severity === 'high' ? 'bg-red-50 border-red-300' :
                error.userMessage.severity === 'medium' ? 'bg-orange-50 border-orange-300' :
                'bg-yellow-50 border-yellow-300'
              }`}>
                <div className="flex items-start gap-3">
                  <span className="text-2xl flex-shrink-0">{error.userMessage.icon}</span>
                  <div className="flex-1">
                    <h3 className={`font-bold text-sm mb-1 ${
                      error.userMessage.severity === 'high' ? 'text-red-800' :
                      error.userMessage.severity === 'medium' ? 'text-orange-800' :
                      'text-yellow-800'
                    }`}>
                      {error.userMessage.title}
                    </h3>
                    <p className={`text-sm mb-2 ${
                      error.userMessage.severity === 'high' ? 'text-red-700' :
                      error.userMessage.severity === 'medium' ? 'text-orange-700' :
                      'text-yellow-700'
                    }`}>
                      {error.userMessage.message}
                    </p>
                    {error.userMessage.suggestion && (
                      <p className={`text-xs italic ${
                        error.userMessage.severity === 'high' ? 'text-red-600' :
                        error.userMessage.severity === 'medium' ? 'text-orange-600' :
                        'text-yellow-600'
                      }`}>
                        💡 {error.userMessage.suggestion}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {isInitializing && !analysisResult && !error && (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="text-center space-y-4 animate-fadeIn">
                <div className="w-20 h-20 mx-auto bg-gradient-to-br from-blue-100 to-purple-100 rounded-full flex items-center justify-center shadow-lg">
                  <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
                <div className="space-y-2">
                  <h3 className="text-lg font-bold text-gray-800">Checking Cache</h3>
                  <p className="text-sm text-gray-600 max-w-xs mx-auto">
                    Looking for previous analysis results to show instantly
                  </p>
                  <div className="flex items-center justify-center gap-1 mt-3">
                    <span className="inline-block w-2 h-2 bg-blue-500 rounded-full animate-bounce"></span>
                    <span className="inline-block w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></span>
                    <span className="inline-block w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {!analysisResult && !isLoading && !isInitializing && (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="text-center space-y-4 animate-scaleIn">
                <div className="w-24 h-24 mx-auto bg-gradient-to-br from-blue-100 to-purple-100 rounded-full flex items-center justify-center shadow-lg">
                  <span className="text-5xl">🔍</span>
                </div>
                <div className="space-y-2">
                  <h2 className="text-lg font-bold text-gray-800">Ready to Analyze</h2>
                  <p className="text-sm text-gray-600 max-w-xs mx-auto">
                    Check this website for security issues, dark patterns, and policy concerns
                  </p>
                </div>
                
                {/* AI Toggle */}
                <div className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl border border-purple-200 max-w-xs mx-auto">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useAI}
                      onChange={(e) => setUseAI(e.target.checked)}
                      className="w-4 h-4 text-purple-600 rounded focus:ring-2 focus:ring-purple-500"
                      title="Enable AI-powered analysis using Chrome's built-in Gemini Nano model"
                    />
                    <span className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                      <span className="text-base">🤖</span>
                      <span>AI-Powered Analysis</span>
                    </span>
                  </label>
                </div>
                
                {useAI && (
                  <p className="text-xs text-center text-gray-500 max-w-xs mx-auto -mt-2">
                    First use will download AI model (large download, one-time)
                  </p>
                )}
                
                <button onClick={() => handleSmartScan()} disabled={isLoading} className="w-full max-w-xs mx-auto bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 disabled:from-gray-400 disabled:to-gray-500 text-white font-bold py-4 px-6 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105 disabled:transform-none disabled:opacity-50">
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="animate-spin">⚙️</span>
                      <span>Analyzing...</span>
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <span>🔍</span>
                      <span>{analysisResult ? 'Re-scan Page' : 'Scan Page'}</span>
                    </span>
                  )}
                </button>
              </div>
            </div>
          )}

          {!analysisResult && isLoading && (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="text-center space-y-6 animate-scaleIn">
                <div className="relative">
                  <div className="w-32 h-32 mx-auto bg-gradient-to-br from-blue-100 to-purple-100 rounded-full flex items-center justify-center shadow-lg animate-pulse">
                    <span className="text-6xl animate-spin">⚙️</span>
                  </div>
                  <div className="absolute inset-0 w-32 h-32 mx-auto rounded-full border-4 border-purple-300 border-t-purple-600 animate-spin"></div>
                </div>
                <div className="space-y-2">
                  <h2 className="text-xl font-bold text-gray-800">Analyzing Website...</h2>
                  <p className="text-sm text-gray-600 max-w-sm mx-auto">
                    {useAI ? (
                      <>
                        🤖 Running AI-powered analysis
                        <br />
                        <span className="text-xs text-gray-500">This may take 15-30 seconds</span>
                      </>
                    ) : (
                      'Running security and pattern checks...'
                    )}
                  </p>
                </div>
                <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
                  <span className="inline-block w-2 h-2 bg-blue-500 rounded-full animate-bounce"></span>
                  <span className="inline-block w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></span>
                  <span className="inline-block w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                </div>
              </div>
            </div>
          )}

          {(analysisResult || partialResult) && (
            <div className="flex-1 flex flex-col">
              <div className="px-4 pt-4 pb-2">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">📊</span>
                    <span className="font-bold text-gray-800">Analysis Results</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {isFromCache && (
                      <div className="px-3 py-1.5 bg-gradient-to-r from-green-100 to-emerald-100 text-green-800 text-xs font-bold rounded-full border border-green-300 shadow-sm">
                        <span className="flex items-center gap-1">
                          <span>📋</span>
                          <span>Previously Analyzed</span>
                        </span>
                      </div>
                    )}
                    <button onClick={() => handleAnalyze(true)} disabled={isUpdating} className="p-2 text-gray-500 hover:text-gray-700 hover:bg-white hover:bg-opacity-50 rounded-lg transition-colors duration-200 disabled:opacity-50" title="Refresh analysis">
                      <span className="text-sm">🔄</span>
                    </button>
                  </div>
                </div>
                
                {/* Progress indicator for partial results */}
                {partialResult && !analysisResult && (
                  <div className="mb-3">
                    <div className="flex items-center justify-between text-sm text-gray-600 mb-1">
                      <span>Analyzing...</span>
                      <span>{Math.round(analysisProgress)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-gradient-to-r from-blue-500 to-purple-600 h-2 rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${analysisProgress}%` }}
                      />
                    </div>
                  </div>
                )}
                
                {/* Removed manual refresh; smart button handles cache vs analyze */}
                <div className="flex gap-1 bg-gray-100 rounded-xl p-1.5 shadow-inner">
                  <button onClick={() => setActiveTab('overview')} className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-semibold transition-all duration-200 ${activeTab === 'overview' ? 'bg-white text-blue-600 shadow-md transform scale-105' : 'text-gray-600 hover:text-gray-900 hover:bg-white hover:bg-opacity-50'}`}>
                    Overview
                  </button>
                    <button onClick={() => setActiveTab('reasons')} className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-semibold transition-all duration-200 relative ${activeTab === 'reasons' ? 'bg-white text-blue-600 shadow-md transform scale-105' : 'text-gray-600 hover:text-gray-900 hover:bg-white hover:bg-opacity-50'}`}>
                    Issues
                    {((analysisResult || partialResult)?.allSignals?.length ?? 0) > 0 && (
                      <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs font-bold ${activeTab === 'reasons' ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-700'}`}>
                        {(analysisResult || partialResult)?.allSignals?.length ?? 0}
                      </span>
                    )}
                  </button>
                  <button onClick={() => setActiveTab('policies')} className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-semibold transition-all duration-200 ${activeTab === 'policies' ? 'bg-white text-blue-600 shadow-md transform scale-105' : 'text-gray-600 hover:text-gray-900 hover:bg-white hover:bg-opacity-50'}`}>
                    Policies
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-thin px-4 pb-4">
                {activeTab === 'overview' && (
                  <div className="space-y-4 animate-fadeIn">
                    <div className="flex justify-center py-6 bg-gradient-to-br from-gray-50 to-blue-50 rounded-xl">
                      <RiskMeter score={currentResult!.totalRiskScore} level={currentResult!.riskLevel} size="large" animated={true} />
                    </div>
                    
                    {/* AI Status Indicator */}
                    {showOfflineMode ? (
                      <div className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-yellow-50 to-orange-50 rounded-xl border border-yellow-300">
                        <span className="text-lg">📱</span>
                        <span className="text-sm font-bold text-gray-700">
                          Offline Mode: <span className="text-orange-600">Basic analysis only</span>
                        </span>
                        <div className="text-xs text-gray-600 mt-1 text-center">
                          AI features unavailable - showing heuristic analysis results
                        </div>
                      </div>
                    ) : currentResult!.aiEnabled ? (
                      <div className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl border border-purple-200">
                        <span className="text-lg">🤖</span>
                        <span className="text-sm font-bold text-gray-700">
                          AI Analysis: <span className="text-purple-600">{currentResult!.aiSignalsCount || 0} signals detected</span>
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200">
                        <span className="text-lg">🔍</span>
                        <span className="text-sm font-bold text-gray-700">
                          Analyzing with AI...
                        </span>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-200 shadow-sm">
                        <div className="text-xs font-semibold text-blue-600 mb-1.5 uppercase tracking-wide">Security</div>
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">{(currentResult!.security?.isHttps ?? false) ? '🔒' : '⚠️'}</span>
                          <span className="font-bold text-gray-800">{(currentResult!.security?.isHttps ?? false) ? 'HTTPS' : 'Not Secure'}</span>
                        </div>
                      </div>
                      <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl p-4 border border-purple-200 shadow-sm">
                        <div className="text-xs font-semibold text-purple-600 mb-1.5 uppercase tracking-wide">Issues Found</div>
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">{(currentResult!.allSignals?.length ?? 0) === 0 ? '✅' : '🚨'}</span>
                          <span className="font-bold text-gray-800">{currentResult!.allSignals?.length ?? 0} detected</span>
                        </div>
                      </div>
                    </div>
                    {(currentResult!.allSignals?.length ?? 0) > 0 && (
                      <div>
                        <h3 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
                          <span className="text-lg">⚠️</span>Top Issues
                        </h3>
                        <ReasonsList signals={currentResult!.allSignals ?? []} maxItems={2} showCategory={true} compact={true} />
                        {(currentResult!.allSignals?.length ?? 0) > 2 && (
                          <button onClick={() => setActiveTab('reasons')} className="w-full mt-3 py-2 px-4 bg-gradient-to-r from-orange-100 to-red-100 hover:from-orange-200 hover:to-red-200 border-2 border-orange-300 text-orange-900 font-semibold text-sm rounded-xl transition-all duration-200 shadow-sm hover:shadow">
                            View All {currentResult!.allSignals?.length ?? 0} Issues →
                          </button>
                        )}
                      </div>
                    )}
                    <div>
                      <h3 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
                        <span className="text-lg">📄</span>Policies
                      </h3>
                      <PolicySummary 
                        policies={currentResult!.policies ?? {
                          hasReturnPolicy: false,
                          hasShippingPolicy: false,
                          hasRefundPolicy: false,
                          hasTermsOfService: false,
                          hasPrivacyPolicy: false,
                          policyUrls: {},
                          signals: [],
                        }} 
                        compact={true} 
                      />
                    </div>
                    
                    {/* TG-09: On-Page Annotations Toggle */}
                    {(currentResult!.allSignals?.length ?? 0) > 0 && (
                      <div className="bg-gradient-to-br from-orange-50 to-yellow-50 rounded-xl p-4 border-2 border-orange-300">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">🎨</span>
                            <div>
                              <div className="text-sm font-bold text-gray-900">Page Annotations</div>
                              <div className="text-xs text-gray-600">Highlight issues on page</div>
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={handleToggleAnnotations}
                          className={`w-full py-2.5 px-4 rounded-lg font-semibold text-sm transition-all duration-200 shadow-sm ${
                            annotationsVisible
                              ? 'bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-white'
                              : 'bg-gradient-to-r from-orange-500 to-yellow-500 hover:from-orange-600 hover:to-yellow-600 text-white'
                          }`}
                        >
                          {annotationsVisible ? '👁️ Hide Highlights' : '🔍 Show Highlights'}
                        </button>
                        <p className="text-xs text-gray-600 mt-2 text-center">
                          {annotationsVisible 
                            ? 'Highlights are visible on the page' 
                            : 'Click to see issues highlighted on the page'}
                        </p>
                      </div>
                    )}
                    
                    <button onClick={() => handleAnalyze(true)} disabled={isLoading} className="w-full mt-2 py-3 px-4 bg-gradient-to-r from-gray-100 to-gray-200 hover:from-gray-200 hover:to-gray-300 disabled:from-gray-50 disabled:to-gray-100 border-2 border-gray-300 text-gray-700 font-semibold rounded-xl transition-all duration-200 shadow-sm hover:shadow disabled:opacity-50 disabled:cursor-not-allowed">
                      {isLoading ? '🔄 Re-analyzing...' : '🔄 Re-analyze Page'}
                    </button>
                  </div>
                )}
                {activeTab === 'reasons' && (
                  <div className="pt-2 animate-fadeIn">
                    <ReasonsList signals={currentResult!.allSignals ?? []} showCategory={true} compact={false} />
                  </div>
                )}
                {activeTab === 'policies' && (
                  <div className="pt-2 animate-fadeIn">
                    <PolicySummary policies={currentResult!.policies} compact={false} />
                  </div>
                )}
              </div>
              {currentUrl && (
                <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-500">🌐</span>
                    <span className="text-xs text-gray-600 truncate flex-1">{new URL(currentUrl).hostname}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
