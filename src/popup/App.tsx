import { useEffect, useState } from 'react';
import { useAnalysisStore } from '../stores';
import { MessagingService } from '../services/messaging';
import { StorageService } from '../services/storage';
import type { AnalysisResult } from '../types';
import { RiskMeter, ReasonsList, PolicySummary } from '../components';

function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'reasons' | 'policies'>('overview');
  const [useAI, setUseAI] = useState(true);
  const [useWhoisVerification, setUseWhoisVerification] = useState(false);
  const [isFromCache, setIsFromCache] = useState(false);
  const [pollInterval, setPollInterval] = useState<number | null>(null);
  const [annotationsVisible, setAnnotationsVisible] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false); // Prevent race conditions
  const [showSettings, setShowSettings] = useState(false);
  
  // Additional settings state
  const [theme, setTheme] = useState<'light' | 'dark' | 'auto'>('auto');
  const [notifications, setNotifications] = useState(false);
  
  const {
    currentUrl,
    analysisResult,
    isLoading,
    error,
    startAnalysis,
    setAnalysisResult,
    completeAnalysis,
    setError,
  } = useAnalysisStore();

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
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, []);

  // Poll for results when in loading state (non-blocking, no isUpdating guard)
  useEffect(() => {
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

      setPollInterval(interval);
    } else if (!isLoading && pollInterval) {
      clearInterval(pollInterval);
      setPollInterval(null);
    }
  }, [isLoading, pollInterval]);

  // Safety net: in case storage event is missed, re-check cache once after 8s of loading
  useEffect(() => {
    if (!isLoading) return;
    const t = setTimeout(() => {
      loadCachedAnalysis();
    }, 8000);
    return () => clearTimeout(t);
  }, [isLoading]);

  // Monitor cross-tab storage changes for live updates
  useEffect(() => {
    let updateTimeout: number | null = null;
    
    const handleStorageChange = async (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName !== 'local') return;
      
      // Debounce the update
      if (updateTimeout) {
        clearTimeout(updateTimeout);
      }
      
      updateTimeout = setTimeout(async () => {
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
          // Show notification for risky cached results
          showRiskNotification(cached.result);
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
      chrome.storage.onChanged.removeListener(handleStorageChange);
      if (updateTimeout) {
        clearTimeout(updateTimeout);
      }
    };
  }, [isLoading, isUpdating]);

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedUseAI = localStorage.getItem('shop-sentinel-use-ai');
    const savedUseWhois = localStorage.getItem('shop-sentinel-use-whois');
    const savedTheme = localStorage.getItem('shop-sentinel-theme');
    const savedNotifications = localStorage.getItem('shop-sentinel-notifications');

    if (savedUseAI !== null) {
      setUseAI(savedUseAI === 'true');
    }
    if (savedUseWhois !== null) {
      setUseWhoisVerification(savedUseWhois === 'true');
    }
    if (savedTheme !== null) {
      setTheme(savedTheme as 'light' | 'dark' | 'auto');
    }
    if (savedNotifications !== null) {
      setNotifications(savedNotifications === 'true');
    }
  }, []);

  // Notification system for risky sites
  const showRiskNotification = async (result: AnalysisResult) => {
    // Only notify if enabled and risk score is high enough
    if (!notifications || result.totalRiskScore < 30) {
      console.log('🔔 Notification skipped:', {
        enabled: notifications,
        riskScore: result.totalRiskScore,
        threshold: 30
      });
      return;
    }

    try {
      const riskLevel = result.riskLevel;
      const title = riskLevel === 'high' ? '🚨 High Risk Site Detected!' : '⚠️ Risky Site Warning';
      const message = `This site has a risk score of ${result.totalRiskScore}. Check the analysis for details.`;

      console.log('🔔 Showing notification:', { title, riskScore: result.totalRiskScore });

      await chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
        title,
        message,
        priority: riskLevel === 'high' ? 2 : 1,
      });

      console.log('✅ Notification displayed successfully');
    } catch (error) {
      console.error('❌ Failed to show notification:', error);
    }
  };

  useEffect(() => {
    localStorage.setItem('shop-sentinel-use-whois', useWhoisVerification.toString());
  }, [useWhoisVerification]);

  useEffect(() => {
    localStorage.setItem('shop-sentinel-theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('shop-sentinel-notifications', notifications.toString());
  }, [notifications]);

  // Theme management - apply theme changes to the UI
  useEffect(() => {
    const applyTheme = (themeValue: 'light' | 'dark' | 'auto') => {
      const root = document.documentElement;
      
      if (themeValue === 'auto') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.classList.toggle('dark', prefersDark);
      } else {
        root.classList.toggle('dark', themeValue === 'dark');
      }
    };

    applyTheme(theme);

    // Listen for system theme changes when in auto mode
    if (theme === 'auto') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => applyTheme('auto');
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [theme]);

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
        console.log(`✅ Cache hit for ${pageType}:`, cached);
        setAnalysisResult(cached);
        setIsFromCache(true);
      } else {
        console.log(`❌ No cache found for ${pageType} - ready to analyze`);
        setIsFromCache(false);
      }
    } catch (error) {
      console.error('Failed to load cache:', error);
    }
  };

  // New: Intelligent Scan (cache-first, then analyze)
  const handleSmartScan = async () => {
    try {
      const tab = await MessagingService.getActiveTab();
      if (!tab?.url) {
        setError('No active tab found');
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
        // Show notification for risky cached results
        showRiskNotification(cached);
        return;
      }

      // Cache miss → try delta mode if we have any cached analysis for this domain
      const latestForDomain = await StorageService.getLatestDomainAnalysis(tab.url, pageType);
      if (latestForDomain && new URL(latestForDomain.url).hostname.replace(/^www\./,'') === new URL(tab.url).hostname.replace(/^www\./,'')) {
        // Ask content script to run fast delta analysis (reuse domain/contact/security)
        startAnalysis(tab.url);
        const response = await MessagingService.sendToActiveTab<any, AnalysisResult>(
          'ANALYZE_PAGE',
          { url: tab.url, includeAI: useAI, includeWhois: useWhoisVerification, delta: true }
        );
        if (response.success && response.data) {
          setAnalysisResult(response.data);
          completeAnalysis();
          // Show notification for risky sites
          showRiskNotification(response.data);
          // Cache is saved in content script
          return;
        }
      }

      // Fallback: full analysis
      await handleAnalyze(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Scan failed');
    }
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
        setError('No active tab found');
        return;
      }

      // If forcing refresh, clear cache first
      if (force) {
        await StorageService.clearCachedAnalysis(tab.url);
      }

      startAnalysis(tab.url);

      const response = await MessagingService.sendToActiveTab<any, AnalysisResult>(
        'ANALYZE_PAGE',
        { url: tab.url, includeAI: useAI, includeWhois: useWhoisVerification }
      );

      if (response.success && response.data) {
        console.log('✅ Analysis complete, caching result for:', tab.url);
        if (isValidAnalysisResult(response.data)) {
          setAnalysisResult(response.data);
          completeAnalysis();
          // Show notification for risky sites
          showRiskNotification(response.data);
        } else {
          console.log('ℹ️ Non-final response received; waiting for cache/storage update');
        }
        
        // Cache the result with pageType from the analysis
        const pageType = response.data.pageType || 'other';
        const cached = await StorageService.cacheAnalysis(tab.url, pageType, response.data);
        console.log('💾 Cache saved:', cached);
        
      } else {
        setError(response.error || 'Analysis failed');
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Analysis failed');
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
      setError('Failed to toggle annotations');
    }
  };

  return (
    <div className="w-[420px] min-h-[600px] bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 dark:from-slate-800 dark:via-slate-700 dark:to-slate-800">
        <div className="h-full flex flex-col bg-white dark:bg-slate-800">
        <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-purple-800 dark:from-slate-800 dark:via-slate-700 dark:to-slate-800 px-5 py-4 text-white shadow-xl">
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
            <div className="w-9 h-9 bg-white bg-opacity-25 rounded-full flex items-center justify-center backdrop-blur-sm shadow-lg border-2 border-white border-opacity-30 cursor-pointer hover:bg-opacity-35 transition-all duration-200" onClick={() => setShowSettings(true)}>
              <span className="text-xl">⚙️</span>
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
                  <h2 className="text-lg font-bold text-gray-800 dark:text-gray-200">Ready to Analyze</h2>
                  <p className="text-sm text-gray-600 dark:text-gray-400 max-w-xs mx-auto">
                    Check this website for security issues, dark patterns, and policy concerns
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 max-w-xs mx-auto">
                    Configure analysis settings using the ⚙️ icon above
                  </p>
                </div>
                
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
                  <h2 className="text-xl font-bold text-gray-800 dark:text-gray-200">Analyzing Website...</h2>
                  <p className="text-sm text-gray-600 dark:text-gray-400 max-w-sm mx-auto">
                    {useAI ? (
                      <>
                        🤖 Running AI-powered analysis
                        <br />
                        <span className="text-xs text-gray-500 dark:text-gray-400">This may take 15-30 seconds</span>
                      </>
                    ) : (
                      'Running security and pattern checks...'
                    )}
                  </p>
                </div>
                <div className="flex items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <span className="inline-block w-2 h-2 bg-blue-500 rounded-full animate-bounce"></span>
                  <span className="inline-block w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></span>
                  <span className="inline-block w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                </div>
              </div>
            </div>
          )}

          {analysisResult && (
            <div className="flex-1 flex flex-col">
              <div className="px-4 pt-4 pb-2">
                <div className="flex items-center justify-between mb-3">
                  {isFromCache && (
                    <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 bg-blue-50 dark:bg-blue-900 px-3 py-1.5 rounded-lg">
                      <span>⚡</span>
                      <span>Previously analyzed</span>
                    </div>
                  )}
                  {/* Removed manual refresh; smart button handles cache vs analyze */}
                </div>
                <div className="flex gap-1 bg-gray-100 dark:bg-slate-200 rounded-xl p-1.5 shadow-inner">
                  <button onClick={() => setActiveTab('overview')} className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-semibold transition-all duration-200 ${activeTab === 'overview' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-md transform scale-105' : 'text-gray-600 dark:text-slate-300 hover:text-gray-900 dark:hover:text-slate-100 hover:bg-white dark:hover:bg-slate-600 hover:bg-opacity-50'}`}>
                    Overview
                  </button>
                    <button onClick={() => setActiveTab('reasons')} className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-semibold transition-all duration-200 relative ${activeTab === 'reasons' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-md transform scale-105' : 'text-gray-600 dark:text-slate-300 hover:text-gray-900 dark:hover:text-slate-100 hover:bg-white dark:hover:bg-slate-600 hover:bg-opacity-50'}`}>
                    Issues
                    {(analysisResult.allSignals?.length ?? 0) > 0 && (
                      <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs font-bold ${activeTab === 'reasons' ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300' : 'bg-gray-200 dark:bg-slate-600 text-gray-700 dark:text-slate-300'}`}>
                        {analysisResult.allSignals?.length ?? 0}
                      </span>
                    )}
                  </button>
                  <button onClick={() => setActiveTab('policies')} className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-semibold transition-all duration-200 ${activeTab === 'policies' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-md transform scale-105' : 'text-gray-600 dark:text-slate-300 hover:text-gray-900 dark:hover:text-slate-100 hover:bg-white dark:hover:bg-slate-600 hover:bg-opacity-50'}`}>
                    Policies
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-thin px-4 pb-4">
                {activeTab === 'overview' && (
                  <div className="space-y-4 animate-fadeIn">
                    <div className="flex justify-center py-6 bg-gradient-to-br from-gray-50 to-blue-50 dark:from-slate-700 dark:to-slate-800 rounded-xl">
                      <RiskMeter score={analysisResult.totalRiskScore} level={analysisResult.riskLevel} size="large" animated={true} />
                    </div>
                    
                    {/* AI Status Indicator */}
                    {analysisResult.aiEnabled && (
                      <div className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-slate-700 dark:to-slate-600 rounded-xl border border-purple-200 dark:border-slate-600">
                        <span className="text-lg">🤖</span>
                        <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
                          AI Analysis: <span className="text-purple-600 dark:text-purple-400">{analysisResult.aiSignalsCount || 0} signals detected</span>
                        </span>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-slate-700 dark:to-slate-600 rounded-xl p-4 border border-blue-200 dark:border-slate-500 shadow-sm">
                        <div className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1.5 uppercase tracking-wide">Security</div>
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">{(analysisResult.security?.isHttps ?? false) ? '🔒' : '⚠️'}</span>
                          <span className="font-bold text-gray-800 dark:text-gray-200">{(analysisResult.security?.isHttps ?? false) ? 'HTTPS' : 'Not Secure'}</span>
                        </div>
                      </div>
                      <div className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-slate-700 dark:to-slate-600 rounded-xl p-4 border border-purple-200 dark:border-slate-500 shadow-sm">
                        <div className="text-xs font-semibold text-purple-600 dark:text-purple-400 mb-1.5 uppercase tracking-wide">Issues Found</div>
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">{(analysisResult.allSignals?.length ?? 0) === 0 ? '✅' : '🚨'}</span>
                          <span className="font-bold text-gray-800 dark:text-gray-200">{analysisResult.allSignals?.length ?? 0} detected</span>
                        </div>
                      </div>
                    </div>
                    {(analysisResult.allSignals?.length ?? 0) > 0 && (
                      <div>
                        <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
                          <span className="text-lg">⚠️</span>Top Issues
                        </h3>
                        <ReasonsList signals={analysisResult.allSignals ?? []} maxItems={2} showCategory={true} compact={true} />
                        {(analysisResult.allSignals?.length ?? 0) > 2 && (
                          <button onClick={() => setActiveTab('reasons')} className="w-full mt-3 py-2 px-4 bg-gradient-to-r from-orange-100 to-red-100 dark:from-slate-600 dark:to-slate-500 hover:from-orange-200 hover:to-red-200 dark:hover:from-slate-500 dark:hover:to-slate-400 border-2 border-orange-300 dark:border-slate-400 text-orange-900 dark:text-slate-200 font-semibold text-sm rounded-xl transition-all duration-200 shadow-sm hover:shadow">
                            View All {analysisResult.allSignals?.length ?? 0} Issues →
                          </button>
                        )}
                      </div>
                    )}
                    <div>
                      <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
                        <span className="text-lg">📄</span>Policies
                      </h3>
                      <PolicySummary 
                        policies={analysisResult.policies ?? {
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
                    {(analysisResult.allSignals?.length ?? 0) > 0 && (
                      <div className="bg-gradient-to-br from-orange-50 to-yellow-50 dark:from-slate-700 dark:to-slate-600 rounded-xl p-4 border-2 border-orange-300 dark:border-slate-500">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">🎨</span>
                            <div>
                              <div className="text-sm font-bold text-gray-900 dark:text-gray-100">Page Annotations</div>
                              <div className="text-xs text-gray-600 dark:text-gray-400">Highlight issues on page</div>
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
                        <p className="text-xs text-gray-600 dark:text-gray-400 mt-2 text-center">
                          {annotationsVisible 
                            ? 'Highlights are visible on the page' 
                            : 'Click to see issues highlighted on the page'}
                        </p>
                      </div>
                    )}
                    
                    <button onClick={() => handleAnalyze(true)} disabled={isLoading} className="w-full mt-2 py-3 px-4 bg-gradient-to-r from-gray-100 to-gray-200 dark:from-slate-600 dark:to-slate-500 hover:from-gray-200 hover:to-gray-300 dark:hover:from-slate-500 dark:hover:to-slate-400 disabled:from-gray-50 disabled:to-gray-100 dark:disabled:from-slate-700 dark:disabled:to-slate-600 border-2 border-gray-300 dark:border-slate-400 text-gray-700 dark:text-slate-200 font-semibold rounded-xl transition-all duration-200 shadow-sm hover:shadow disabled:opacity-50 disabled:cursor-not-allowed">
                      {isLoading ? '🔄 Re-analyzing...' : '🔄 Re-analyze Page'}
                    </button>
                  </div>
                )}
                {activeTab === 'reasons' && (
                  <div className="pt-2 animate-fadeIn">
                    <ReasonsList signals={analysisResult.allSignals ?? []} showCategory={true} compact={false} />
                  </div>
                )}
                {activeTab === 'policies' && (
                  <div className="pt-2 animate-fadeIn">
                    <PolicySummary policies={analysisResult.policies} compact={false} />
                  </div>
                )}
              </div>
              {currentUrl && (
                <div className="px-4 py-3 bg-gray-50 dark:bg-slate-700 border-t border-gray-200 dark:border-slate-600">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">🌐</span>
                    <span className="text-xs text-gray-600 dark:text-gray-400 truncate flex-1">{new URL(currentUrl).hostname}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Settings Panel Overlay */}
      {showSettings && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowSettings(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-sm w-full mx-4 max-h-[90vh] flex flex-col animate-scaleIn" onClick={(e) => e.stopPropagation()}>
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 dark:from-slate-700 dark:to-slate-600 px-6 py-4 rounded-t-2xl flex-shrink-0">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <span>⚙️</span>
                  Analysis Settings
                </h2>
                <button
                  onClick={() => setShowSettings(false)}
                  className="w-8 h-8 bg-white bg-opacity-20 rounded-full flex items-center justify-center hover:bg-opacity-30 transition-all duration-200"
                >
                  <span className="text-white text-lg">×</span>
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6 flex-1 overflow-y-auto">
              {/* Core Features */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 border-b border-gray-200 dark:border-gray-700 pb-2">🛡️ Protection Features</h3>
                
                {/* AI Analysis */}
                <div className="flex items-center justify-between p-4 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-slate-700 dark:to-slate-600 rounded-xl border border-purple-200 dark:border-slate-500">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🤖</span>
                    <div>
                      <div className="text-sm font-bold text-gray-800 dark:text-gray-200">Smart Scam Detection</div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">AI finds hidden tricks and fake reviews</div>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useAI}
                      onChange={(e) => setUseAI(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                  </label>
                </div>

                {/* Domain Trust Check */}
                <div className="flex items-center justify-between p-4 bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-slate-700 dark:to-slate-600 rounded-xl border border-blue-200 dark:border-slate-500">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🛡️</span>
                    <div>
                      <div className="text-sm font-bold text-gray-800 dark:text-gray-200">Website Legitimacy Check</div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">Verify if the site is trustworthy and established</div>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useWhoisVerification}
                      onChange={(e) => setUseWhoisVerification(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
              </div>

              {/* Preferences */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 border-b border-gray-200 dark:border-gray-700 pb-2">⚙️ Preferences</h3>
                
                {/* Theme */}
                <div className="flex items-center justify-between p-4 bg-gradient-to-r from-gray-50 to-slate-50 dark:from-slate-700 dark:to-slate-600 rounded-xl border border-gray-200 dark:border-slate-500">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🎨</span>
                    <div>
                      <div className="text-sm font-bold text-gray-800 dark:text-gray-200">Theme</div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">Choose your preferred appearance</div>
                    </div>
                  </div>
                  <select
                    value={theme}
                    onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'auto')}
                    className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200"
                  >
                    <option value="auto">Auto</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </div>

                {/* Notifications */}
                <div className="flex items-center justify-between p-4 bg-gradient-to-r from-pink-50 to-rose-50 dark:from-slate-700 dark:to-slate-600 rounded-xl border border-pink-200 dark:border-slate-500">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🔔</span>
                    <div>
                      <div className="text-sm font-bold text-gray-800 dark:text-gray-200">Risk Alerts</div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">Notify me when I visit risky sites</div>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notifications}
                      onChange={(e) => setNotifications(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-pink-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-pink-500"></div>
                  </label>
                </div>
              </div>

              {/* Reset Settings */}
              <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={async () => {
                      // Test notification with mock data
                      const mockResult: AnalysisResult = {
                        url: 'https://example-risky-site.com',
                        timestamp: Date.now(),
                        pageType: 'home',
                        security: { 
                          isHttps: false, 
                          hasMixedContent: false, 
                          hasValidCertificate: false, 
                          signals: [] 
                        },
                        domain: { 
                          domain: 'example-risky-site.com', 
                          ageInDays: 30, 
                          registrar: null, 
                          isSuspicious: true, 
                          signals: [] 
                        },
                        contact: { 
                          hasContactPage: false, 
                          hasPhoneNumber: false, 
                          hasPhysicalAddress: false, 
                          hasEmail: false, 
                          socialMediaLinks: [], 
                          socialMediaProfiles: [], 
                          signals: [] 
                        },
                        policies: { 
                          hasReturnPolicy: false, 
                          hasShippingPolicy: false, 
                          hasRefundPolicy: false, 
                          hasTermsOfService: false, 
                          hasPrivacyPolicy: false, 
                          policyUrls: {}, 
                          signals: [] 
                        },
                        payment: { 
                          acceptedMethods: [], 
                          hasReversibleMethods: false, 
                          hasIrreversibleOnly: false, 
                          signals: [] 
                        },
                        totalRiskScore: 75,
                        riskLevel: 'high',
                        allSignals: [],
                        analysisVersion: '1.0.0',
                        isEcommerceSite: true
                      };
                      await showRiskNotification(mockResult);
                    }}
                    disabled={!notifications}
                    className="flex-1 py-2 px-3 bg-gradient-to-r from-blue-100 to-indigo-100 dark:from-slate-600 dark:to-slate-500 hover:from-blue-200 hover:to-indigo-200 dark:hover:from-slate-500 dark:hover:to-slate-400 border-2 border-blue-300 dark:border-slate-400 text-blue-700 dark:text-slate-200 font-semibold text-sm rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    🔔 Test Notification
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('Reset all settings to defaults?')) {
                        setUseAI(true);
                        setUseWhoisVerification(false);
                        setTheme('auto');
                        setNotifications(false);
                      }
                    }}
                    className="flex-1 py-2 px-3 bg-gradient-to-r from-red-100 to-red-200 dark:from-slate-600 dark:to-slate-500 hover:from-red-200 hover:to-red-300 dark:hover:from-slate-500 dark:hover:to-slate-400 border-2 border-red-300 dark:border-slate-400 text-red-700 dark:text-slate-200 font-semibold text-sm rounded-xl transition-all duration-200"
                  >
                    🔄 Reset to Defaults
                  </button>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                  Settings are saved automatically
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
