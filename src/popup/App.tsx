import { useEffect, useState } from 'react';
import { useAnalysisStore } from '../stores';
import { MessagingService } from '../services/messaging';
import { StorageService } from '../services/storage';
import type { AnalysisResult } from '../types';
import { AIProgressIndicator, RiskMeter, ReasonsList, PolicySummary } from '../components';

function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'reasons' | 'policies'>('overview');
  const [useAI, setUseAI] = useState(true);
  const [isFromCache, setIsFromCache] = useState(false);
  const [pollInterval, setPollInterval] = useState<number | null>(null);
  const [annotationsVisible, setAnnotationsVisible] = useState(false);
  
  const {
    currentUrl,
    analysisResult,
    isLoading,
    error,
    startAnalysis,
    setAnalysisResult,
    completeAnalysis,
    setError,
    clearError,
  } = useAnalysisStore();

  useEffect(() => {
    initializePopup();
    
    return () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll for results when in loading state
  useEffect(() => {
    let interval: number | null = null;
    
    if (isLoading && !pollInterval) {
      console.log('⏳ Starting poll for analysis completion');
      interval = setInterval(async () => {
        try {
          const tab = await MessagingService.getActiveTab();
          if (!tab?.url) {
            console.log('⚠️ No active tab during polling');
            return;
          }

          // Get current page type and check if analysis is still in progress
          const pageInfoResponse = await MessagingService.sendToActiveTab('GET_PAGE_INFO');
          if (!pageInfoResponse.success || !pageInfoResponse.data) {
            console.log('⚠️ Failed to get page info during polling');
            return;
          }

          const pageType = pageInfoResponse.data.pageType || 'other';
          const isStillInProgress = pageInfoResponse.data.isAnalysisInProgress || false;
          
          console.log(`🔍 Polling: pageType=${pageType}, isInProgress=${isStillInProgress}`);
          
          // If analysis is no longer in progress, check cache
          if (!isStillInProgress) {
            console.log(`🔍 Analysis no longer in progress, checking cache for ${pageType}...`);
            const cached = await StorageService.getCachedAnalysis(tab.url, pageType);
            if (cached) {
              console.log(`✅ Analysis completed! Loading result (${pageType}):`, cached);
              clearError(); // Clear any errors before showing results
              setAnalysisResult(cached);
              completeAnalysis();
              setIsFromCache(true);
              if (interval) clearInterval(interval);
              setPollInterval(null);
              return;
            } else {
              console.log(`⚠️ Analysis no longer in progress but no cache found for ${pageType}`);
              // Analysis might have failed, stop polling
              completeAnalysis();
              if (interval) clearInterval(interval);
              setPollInterval(null);
              return;
            }
          } else {
            console.log(`⏳ Analysis still in progress for ${pageType}, continuing to poll...`);
          }
        } catch (error) {
          console.error('❌ Poll error:', error);
        }
      }, 2000); // Check every 2 seconds
      
      setPollInterval(interval);
    } else if (!isLoading && pollInterval) {
      console.log('🛑 Stopping poll (no longer loading)');
      clearInterval(pollInterval);
      setPollInterval(null);
    }
    
    // Cleanup on unmount
    return () => {
      if (interval) {
        clearInterval(interval);
      }
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [isLoading]); // Removed pollInterval from deps to prevent infinite loop

  // Monitor cross-tab storage changes for live updates
  useEffect(() => {
    const handleStorageChange = async (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName !== 'local') return;
      
      try {
        const tab = await MessagingService.getActiveTab();
        if (!tab?.url) return;
        
        const pageInfoResponse = await MessagingService.sendToActiveTab('GET_PAGE_INFO');
        if (!pageInfoResponse.success || !pageInfoResponse.data) return;
        
        const pageType = pageInfoResponse.data.pageType || 'other';
        const cacheKey = `analysis_${new URL(tab.url).hostname.replace(/^www\./, '')}:${pageType}`;
        
        // Check if analysis completed in another tab
        if (changes[cacheKey] && changes[cacheKey].newValue) {
          console.log('📡 Analysis completed in another tab, updating...');
          const cached = changes[cacheKey].newValue as any;
          
          if (cached.result && !cached.expiresAt) {
            // Old format, just use result
            clearError(); // Clear any stale errors
            setAnalysisResult(cached);
          } else if (cached.result && Date.now() < cached.expiresAt) {
            // New format with expiration
            clearError(); // Clear any stale errors
            setAnalysisResult(cached.result);
          }
          
          setIsFromCache(true);
          if (isLoading) {
            completeAnalysis();
          }
        }
      } catch (error) {
        console.error('Error handling storage change:', error);
      }
    };
    
    chrome.storage.onChanged.addListener(handleStorageChange);
    
    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [isLoading]);

  const initializePopup = async () => {
    await testConnection();
    await loadCachedAnalysis();
  };

  const testConnection = async () => {
    try {
      const response = await MessagingService.sendToActiveTab('PING');
      if (response.success) {
        console.log('✅ Connection successful:', response.data);
      }
    } catch (error) {
      console.error('❌ Connection failed:', error);
    }
  };

  const loadCachedAnalysis = async () => {
    try {
      const tab = await MessagingService.getActiveTab();
      if (!tab?.url) return;

      // Get current page type from content script FIRST
      console.log('🔍 Getting page type for:', tab.url);
      const pageInfoResponse = await MessagingService.sendToActiveTab('GET_PAGE_INFO');
      
      if (!pageInfoResponse.success || !pageInfoResponse.data) {
        console.log('❌ Could not get page info');
        return;
      }

      const pageType = pageInfoResponse.data.pageType || 'other';
      const confidence = pageInfoResponse.data.pageTypeConfidence || 0;
      const isInProgressFromContent = pageInfoResponse.data.isAnalysisInProgress || false;
      console.log(`📄 Detected page type: ${pageType} (confidence: ${confidence}%)`);

      // Check if analysis is in progress using both storage and content script
      const inProgressFromStorage = await StorageService.isAnalysisInProgress(tab.url, pageType);
      const inProgress = inProgressFromStorage || isInProgressFromContent;
      
      console.log(`🔍 Initialization check: storage=${inProgressFromStorage}, content=${isInProgressFromContent}, combined=${inProgress}`);
      
      if (inProgress) {
        console.log(`⏳ Analysis in progress for ${pageType}, entering loading state`);
        clearError(); // Clear any stale errors
        startAnalysis(tab.url);
        // Don't return early - continue to check cache in case analysis just completed
      }

      // Check cache only for this specific page type
      console.log(`🔍 Checking cache for: ${tab.url} (${pageType})`);
      const cached = await StorageService.getCachedAnalysis(tab.url, pageType);
      
      if (cached) {
        console.log(`✅ Cache hit for ${pageType}:`, cached);
        clearError(); // Clear any errors when loading cached results
        setAnalysisResult(cached);
        setIsFromCache(true);
      } else {
        console.log(`❌ No cache found for ${pageType} - ready to analyze`);
      }
    } catch (error) {
      console.error('Failed to load cache:', error);
    }
  };

  const handleAnalyze = async (force = false) => {
    try {
      const tab = await MessagingService.getActiveTab();
      if (!tab?.url) {
        setError('No active tab found');
        return;
      }

      // Clear any previous errors before starting
      clearError();
      
      // If forcing refresh, clear cache and results
      if (force) {
        await StorageService.clearCachedAnalysis(tab.url);
        setAnalysisResult(null); // Only clear on force refresh
        setIsFromCache(false);
      }
      
      // Start analysis (keeps previous results visible during loading)
      startAnalysis(tab.url);
      
      console.log('🚀 Triggering analysis, polling will handle results...');

      // Fire and forget with extended timeout for long-running analysis
      // The polling mechanism will pick up the results when ready
      MessagingService.sendToActiveTab<any, AnalysisResult>(
        'ANALYZE_PAGE',
        { url: tab.url, includeAI: useAI, forceRefresh: force },
        { timeout: 60000 } // 60 second timeout for AI analysis
      ).then((response) => {
        console.log('📨 Analysis response received:', response);
        
        if (response.success && response.data) {
          // Handle different response types
          if (response.data.status === 'in_progress') {
            console.log('⏳ Analysis already in progress, polling will handle it');
            return;
          }
          
          if (response.data.status === 'error') {
            console.error('❌ Analysis error:', response.data.error);
            setError(response.data.error || 'Analysis failed');
            completeAnalysis();
            return;
          }

          // Successful analysis result - update state
          // (polling might also update it, but that's okay - they're the same data)
          console.log('✅ Analysis complete via direct response');
          clearError();
          setAnalysisResult(response.data);
          completeAnalysis();
          setIsFromCache(false);
        } else if (response.error) {
          console.error('❌ Analysis failed:', response.error);
          // Only complete analysis if it's a genuine failure, not a timeout
          // Polling will handle timeout cases
          if (!response.error.includes('timeout')) {
            setError(response.error);
            completeAnalysis();
          } else {
            console.warn('⚠️ Message timeout, polling will continue checking');
          }
        }
      }).catch((error) => {
        console.error('❌ Analysis request failed:', error);
        // Don't call completeAnalysis() here! The analysis might still be running in the content script.
        // If it's a timeout, polling will detect completion and update state.
        // Only log the error - polling will handle state transitions.
        console.warn('⚠️ Message failed, but polling will continue to check for results');
      });

      // Don't wait - return immediately and let polling handle the rest
      console.log('✅ Analysis request sent, UI remains responsive');
      
    } catch (error) {
      console.error('❌ Failed to start analysis:', error);
      setError(error instanceof Error ? error.message : 'Failed to start analysis');
      completeAnalysis();
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
        // Show annotations with real AI elements
        const elements = analysisResult?.elements || [];
        
        if (elements.length === 0) {
          setError('No dark patterns detected to highlight');
          return;
        }
        
        console.log(`🎨 Highlighting ${elements.length} elements from AI analysis`);
        
        const response = await MessagingService.sendToActiveTab('HIGHLIGHT_ELEMENTS', {
          elements: elements,
        });
        
        if (response.success) {
          setAnnotationsVisible(true);
          console.log(`✅ Annotations displayed: ${response.data?.highlighted || 0} elements`);
        }
      }
    } catch (error) {
      console.error('❌ Error toggling annotations:', error);
      setError('Failed to toggle annotations');
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
              <div className="bg-red-50 border-2 border-red-300 rounded-xl p-3 shadow-sm">
                <div className="flex items-start gap-2">
                  <span className="text-xl flex-shrink-0">❌</span>
                  <p className="text-sm text-red-800 font-medium flex-1">{error}</p>
                </div>
              </div>
            </div>
          )}

          {!analysisResult && !isLoading && (
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
                
                <button onClick={() => handleAnalyze(false)} disabled={isLoading} className="w-full max-w-xs mx-auto bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 disabled:from-gray-400 disabled:to-gray-500 text-white font-bold py-4 px-6 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105 disabled:transform-none disabled:opacity-50">
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="animate-spin">⚙️</span>
                      <span>Analyzing...</span>
                    </span>
                  ) : ('🔍 Analyze This Page')}
                </button>
              </div>
            </div>
          )}

          {!analysisResult && isLoading && (
            <div className="flex-1 flex flex-col items-center justify-center p-6 space-y-6">
              {/* Main Loading Animation */}
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
                        🤖 Running comprehensive analysis
                        <br />
                        <span className="text-xs text-gray-500">Heuristics + AI analysis in progress</span>
                      </>
                    ) : (
                      <>
                        🔍 Running heuristic analysis
                        <br />
                        <span className="text-xs text-gray-500">Security, domain, and policy checks</span>
                      </>
                    )}
                  </p>
                </div>
                
                {/* Analysis Progress Steps */}
                <div className="space-y-3 max-w-sm mx-auto">
                  <div className="flex items-center gap-3 text-sm">
                    <span className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center text-white text-xs">✓</span>
                    <span className="text-gray-700">Page type detection</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs animate-pulse">⚙</span>
                    <span className="text-gray-700">Security & domain checks</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs animate-pulse">⚙</span>
                    <span className="text-gray-700">Content & policy analysis</span>
                  </div>
                  {useAI && (
                    <div className="flex items-center gap-3 text-sm">
                      <span className="w-5 h-5 bg-purple-500 rounded-full flex items-center justify-center text-white text-xs animate-pulse">🤖</span>
                      <span className="text-gray-700">AI-powered pattern detection</span>
                    </div>
                  )}
                  <div className="flex items-center gap-3 text-sm">
                    <span className="w-5 h-5 bg-gray-300 rounded-full flex items-center justify-center text-white text-xs">⏳</span>
                    <span className="text-gray-500">Risk scoring & aggregation</span>
                  </div>
                </div>
                
                <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
                  <span className="inline-block w-2 h-2 bg-blue-500 rounded-full animate-bounce"></span>
                  <span className="inline-block w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></span>
                  <span className="inline-block w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                </div>
              </div>

              {/* Enhanced AI Progress Indicator */}
              {useAI && (
                <div className="w-full max-w-sm animate-fadeIn" style={{ animationDelay: '0.5s' }}>
                  <AIProgressIndicator showDetails={true} />
                </div>
              )}
            </div>
          )}

          {analysisResult && (
            <div className="flex-1 flex flex-col">
              <div className="px-4 pt-4 pb-2">
                <div className="flex items-center justify-between mb-3">
                  {isFromCache && (
                    <div className="flex items-center gap-2 text-xs text-gray-600 bg-blue-50 px-3 py-1.5 rounded-lg">
                      <span>📦</span>
                      <span>Cached result</span>
                    </div>
                  )}
                  <button 
                    onClick={() => handleAnalyze(true)} 
                    disabled={isLoading}
                    className="ml-auto text-xs text-blue-600 hover:text-blue-700 disabled:text-gray-400 flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
                    title="Run fresh analysis"
                  >
                    <span className={isLoading ? 'animate-spin' : ''}>🔄</span>
                    <span>Refresh</span>
                  </button>
                </div>
                <div className="flex gap-1 bg-gray-100 rounded-xl p-1.5 shadow-inner">
                  <button onClick={() => setActiveTab('overview')} className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-semibold transition-all duration-200 ${activeTab === 'overview' ? 'bg-white text-blue-600 shadow-md transform scale-105' : 'text-gray-600 hover:text-gray-900 hover:bg-white hover:bg-opacity-50'}`}>
                    Overview
                  </button>
                  <button onClick={() => setActiveTab('reasons')} className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-semibold transition-all duration-200 relative ${activeTab === 'reasons' ? 'bg-white text-blue-600 shadow-md transform scale-105' : 'text-gray-600 hover:text-gray-900 hover:bg-white hover:bg-opacity-50'}`}>
                    Issues
                    {analysisResult.allSignals.length > 0 && (
                      <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs font-bold ${activeTab === 'reasons' ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-700'}`}>
                        {analysisResult.allSignals.length}
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
                      <RiskMeter score={analysisResult.totalRiskScore} level={analysisResult.riskLevel} size="large" animated={true} />
                    </div>
                    
                    {/* AI Status Indicator */}
                    {analysisResult.aiEnabled && (
                      <div className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl border border-purple-200">
                        <span className="text-lg">🤖</span>
                        <span className="text-sm font-bold text-gray-700">
                          AI Analysis: <span className="text-purple-600">{analysisResult.aiSignalsCount || 0} signals detected</span>
                        </span>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-200 shadow-sm">
                        <div className="text-xs font-semibold text-blue-600 mb-1.5 uppercase tracking-wide">Security</div>
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">{analysisResult.security.isHttps ? '🔒' : '⚠️'}</span>
                          <span className="font-bold text-gray-800">{analysisResult.security.isHttps ? 'HTTPS' : 'Not Secure'}</span>
                        </div>
                        <div className="text-xs text-gray-600 mt-1">
                          {analysisResult.domain.ageInDays ? 
                            `Domain age: ${Math.floor(analysisResult.domain.ageInDays / 365)}y` : 
                            'Domain age: Unknown'
                          }
                        </div>
                      </div>
                      <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl p-4 border border-purple-200 shadow-sm">
                        <div className="text-xs font-semibold text-purple-600 mb-1.5 uppercase tracking-wide">Issues Found</div>
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">{analysisResult.allSignals.length === 0 ? '✅' : '🚨'}</span>
                          <span className="font-bold text-gray-800">{analysisResult.allSignals.length} detected</span>
                        </div>
                        <div className="text-xs text-gray-600 mt-1">
                          {analysisResult.aiEnabled ? 
                            `${analysisResult.aiSignalsCount || 0} AI + ${analysisResult.allSignals.length - (analysisResult.aiSignalsCount || 0)} heuristic` :
                            'Heuristic analysis only'
                          }
                        </div>
                      </div>
                    </div>
                    
                    {/* Enhanced Heuristic Analysis Breakdown */}
                    <div className="bg-gradient-to-br from-gray-50 to-blue-50 rounded-xl p-4 border border-gray-200">
                      <h3 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
                        <span className="text-lg">📊</span>Analysis Breakdown
                      </h3>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Security:</span>
                          <span className={`font-semibold ${analysisResult.security.signals.length === 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {analysisResult.security.signals.length === 0 ? '✅ Secure' : `${analysisResult.security.signals.length} issues`}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Domain:</span>
                          <span className={`font-semibold ${analysisResult.domain.signals.length === 0 ? 'text-green-600' : 'text-orange-600'}`}>
                            {analysisResult.domain.signals.length === 0 ? '✅ Good' : `${analysisResult.domain.signals.length} issues`}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Contact:</span>
                          <span className={`font-semibold ${analysisResult.contact.signals.length === 0 ? 'text-green-600' : 'text-yellow-600'}`}>
                            {analysisResult.contact.signals.length === 0 ? '✅ Available' : `${analysisResult.contact.signals.length} missing`}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Policies:</span>
                          <span className={`font-semibold ${analysisResult.policies.signals.length === 0 ? 'text-green-600' : 'text-orange-600'}`}>
                            {analysisResult.policies.signals.length === 0 ? '✅ Complete' : `${analysisResult.policies.signals.length} missing`}
                          </span>
                        </div>
                      </div>
                    </div>
                    {analysisResult.allSignals.length > 0 && (
                      <div>
                        <h3 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
                          <span className="text-lg">⚠️</span>Top Issues
                        </h3>
                        <ReasonsList signals={analysisResult.allSignals} maxItems={2} showCategory={true} compact={true} />
                        {analysisResult.allSignals.length > 2 && (
                          <button onClick={() => setActiveTab('reasons')} className="w-full mt-3 py-2 px-4 bg-gradient-to-r from-orange-100 to-red-100 hover:from-orange-200 hover:to-red-200 border-2 border-orange-300 text-orange-900 font-semibold text-sm rounded-xl transition-all duration-200 shadow-sm hover:shadow">
                            View All {analysisResult.allSignals.length} Issues →
                          </button>
                        )}
                      </div>
                    )}
                    <div>
                      <h3 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
                        <span className="text-lg">📄</span>Policies
                      </h3>
                      <PolicySummary policies={analysisResult.policies} compact={true} />
                    </div>
                    
                    {/* TG-09: On-Page Annotations Toggle */}
                    {analysisResult.allSignals.length > 0 && (
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
                    <ReasonsList signals={analysisResult.allSignals} showCategory={true} compact={false} />
                  </div>
                )}
                {activeTab === 'policies' && (
                  <div className="pt-2 animate-fadeIn">
                    <PolicySummary policies={analysisResult.policies} compact={false} />
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
