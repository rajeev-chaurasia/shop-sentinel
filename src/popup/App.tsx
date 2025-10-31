import { useEffect, useState } from 'react';
import { useAnalysisStore, initializeAnalysisStore } from '../stores';
import { MessagingService } from '../services/messaging';
import { StorageService } from '../services/storage';
import { cacheService } from '../services/cache';
import { crossTabSync } from '../services/crossTabSync';
import { progressCache } from '../services/progressCache';
import type { AnalysisResult } from '../types';
import type { PhaseResult, AnalysisHistoryItem } from '../types/messages';
import { RiskMeter, ReasonsList, PolicySummary, AnalysisProgress } from '../components';
import { createErrorFromMessage } from '../types/errors';
import { TIMINGS } from '../config/constants';
import { getApiUrl } from '../config/env';

function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'reasons' | 'policies'>('overview');
  const [useAI, setUseAI] = useState(true);
  const [isFromCache, setIsFromCache] = useState(false);
  const [pollInterval, setPollInterval] = useState<number | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  const [isPolicyPage, setIsPolicyPage] = useState(false);
  const [policyAnalysis, setPolicyAnalysis] = useState<any>(null);
  const [isAnalyzingPolicy, setIsAnalyzingPolicy] = useState(false);
  const [policyLegitimacy, setPolicyLegitimacy] = useState<any>(null);
  
  const [theme, setTheme] = useState<'light' | 'dark' | 'auto'>('auto');
  const [notifications, setNotifications] = useState(true);
  
  const [operationLock, setOperationLock] = useState(false);
  const [isCheckingCache, setIsCheckingCache] = useState(false);
  
  const [currentPhase, setCurrentPhase] = useState<PhaseResult | null>(null);
  const [progressPercentage, setProgressPercentage] = useState(0);
  const [analysisHistory, setAnalysisHistory] = useState<AnalysisHistoryItem[]>([]);
  
  const {
    currentUrl,
    analysisResult,
    partialResult,
    isLoading,
    error,
    startAnalysis,
    setAnalysisResult,
    setPartialResult,
    completeAnalysis,
    setError,
    backendJobProgress,
    backendJobStage,
    updateBackendJobProgress,
    setBackendJob,
  } = useAnalysisStore();

  // Use full results if available, otherwise partial results
  const currentResult = analysisResult || partialResult;
  
  // Determine if we should show offline mode
  // Only show offline mode for final results or when we're sure AI is unavailable
  const showOfflineMode = analysisResult ? !analysisResult.aiEnabled : false;

  // Helper to prevent concurrent operations
  const withOperationLock = async <T,>(operation: () => Promise<T>): Promise<T | null> => {
    if (operationLock) {
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
      
      await MessagingService.sendToActiveTab('UPDATE_ICON', { riskLevel, badgeText });
    } catch (error) {
      console.error('Failed to update icon for cached result:', error);
    }
  };

  // Check if current page is a policy page
  const checkPolicyPage = async () => {
    try {
      const pageInfo = await MessagingService.sendToActiveTab('GET_PAGE_INFO');
      if (pageInfo?.data?.isPolicyPage) {
        setIsPolicyPage(true);
        setPolicyLegitimacy(pageInfo.data.policyLegitimacy || null);
      } else {
        setIsPolicyPage(false);
        setPolicyLegitimacy(null);
      }
    } catch (error) {
      console.error('Failed to check policy page:', error);
      setIsPolicyPage(false);
      setPolicyLegitimacy(null);
    }
  };

  // Analyze policy page using AI
  const analyzePolicy = async () => {
    if (isAnalyzingPolicy || !isPolicyPage) return;

    setIsAnalyzingPolicy(true);
    setPolicyAnalysis(null);

    try {
      const result = await MessagingService.sendToActiveTab('ANALYZE_POLICY');
      
      if (result?.data?.status === 'success') {
        setPolicyAnalysis(result.data);
      } else {
        setError(createErrorFromMessage(result?.data?.message || 'Policy analysis failed'));
      }
    } catch (error) {
      setError(createErrorFromMessage(error instanceof Error ? error.message : 'Policy analysis failed'));
    } finally {
      setIsAnalyzingPolicy(false);
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

  // Restore job progress when popup opens (handles tab close/reopen)
  useEffect(() => {
    const restoreActiveJob = async () => {
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'GET_ACTIVE_JOB'
        });

        if (response?.success && response?.jobId) {
          updateBackendJobProgress(
            response.progress,
            'processing',
            '',
            response.stage
          );
        }
      } catch (error) {
        console.warn('Failed to restore active job:', error);
      }
    };

    if (!backendJobProgress || backendJobProgress === 0) {
      restoreActiveJob();
    }
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
            setAnalysisResult(cached);
            updateIconForCachedResult(cached);
            completeAnalysis();
            checkPolicyPage();
            clearInterval(interval);
            setPollInterval(null);
          }
        } catch (error) {
          console.error('Poll error:', error);
        }
      }, TIMINGS.POLL_INTERVAL);

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
    }, TIMINGS.FALLBACK_CACHE_CHECK_TIMEOUT);
    
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
              const cached = change.newValue as any;
              
              if (cached.result && cached.expiresAt && Date.now() < cached.expiresAt) {
                if (isValidAnalysisResult(cached.result)) {
                  setAnalysisResult(cached.result);
                  setIsFromCache(true);
                  updateIconForCachedResult(cached.result);
                  showRiskNotification(cached.result);
                  completeAnalysis();
                  checkPolicyPage();
                }
              }
              else if (isValidAnalysisResult(cached)) {
                setAnalysisResult(cached);
                setIsFromCache(true);
                updateIconForCachedResult(cached);
                completeAnalysis();
                checkPolicyPage();
              }
            }
          }
        } catch (error) {
          console.error('Error handling storage change:', error);
        } finally {
          setIsUpdating(false);
        }
      }, 300);
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

  // Monitor active tab URL changes and detect domain switches (even after popup close/reopen)
  useEffect(() => {
    let isMounted = true;
    
    // Listen for progress updates from content script
    const handleMessage = (message: any) => {
      if (!isMounted || message.action !== 'ANALYSIS_PROGRESS') return;
      
      const payload = message.payload;
      
      setCurrentPhase({
        phase: payload.phase,
        subPhase: payload.subPhase,
        status: payload.status,
        progress: payload.progress,
        elapsedMs: payload.elapsedMs,
        timestamp: Date.now(),
        findings: payload.findings,
      });
      
      setProgressPercentage(payload.progress);
    };
    
    // Add runtime message listener
    chrome.runtime.onMessage.addListener(handleMessage);
    
    // Load analysis history on mount
    const loadHistory = () => {
      try {
        const history = progressCache.getHistory();
        setAnalysisHistory(history);
      } catch (error) {
        console.warn('Failed to load history:', error);
      }
    };
    
    loadHistory();
    
    return () => {
      isMounted = false;
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  // Monitor active tab URL changes and detect domain switches (even after popup close/reopen)
  useEffect(() => {
    let isMounted = true;
    const POPUP_LAST_TAB_KEY = 'shop-sentinel-popup-last-tab-url';
    
    const monitorTabChange = setInterval(async () => {
      if (!isMounted) return;
      
      try {
        const tab = await MessagingService.getActiveTab();
        if (!tab?.url) return;
        
        // Get the last known URL from storage
        const stored = await chrome.storage.local.get(POPUP_LAST_TAB_KEY);
        const previousUrl = stored[POPUP_LAST_TAB_KEY] as string | undefined;
        
        const newDomain = new URL(tab.url).hostname;
        const previousDomain = previousUrl ? new URL(previousUrl).hostname : null;
        
        if (previousDomain && newDomain !== previousDomain) {
          setAnalysisResult(null);
          setPartialResult(null);
          setIsFromCache(false);
          
          await loadCachedAnalysisFull();
        }
        
        await chrome.storage.local.set({ [POPUP_LAST_TAB_KEY]: tab.url });
      } catch (error) {
        // Silently ignore errors in monitoring
      }
    }, 500); // Check every 500ms
    
    return () => {
      isMounted = false;
      clearInterval(monitorTabChange);
    };
  }, []);

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedUseAI = localStorage.getItem('shop-sentinel-use-ai');
    const savedTheme = localStorage.getItem('shop-sentinel-theme');
    const savedNotifications = localStorage.getItem('shop-sentinel-notifications');

    if (savedUseAI !== null) {
      setUseAI(savedUseAI === 'true');
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
    if (!notifications || result.totalRiskScore < 30) {
      return;
    }

    try {
      const riskLevel = result.riskLevel;
      const title = riskLevel === 'high' ? '🚨 High Risk Site Detected!' : '⚠️ Risky Site Warning';
      const message = `This site has a risk score of ${result.totalRiskScore}. Check the analysis for details.`;

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

  // Listen for partial analysis results and analysis completion from content script
  useEffect(() => {
    const handleRuntimeMessage = async (message: any) => {
      if (message.action === 'PARTIAL_ANALYSIS_RESULT' && message.payload) {
        console.log('📊 Received partial analysis result:', message.payload.phase);
        setPartialResult(message.payload);
        
        // Persist partial result to storage for cross-session continuity
        try {
          const tab = await MessagingService.getActiveTab();
          if (tab?.url) {
            const pageInfoResponse = await MessagingService.sendToActiveTab('GET_PAGE_INFO');
            const pageType = pageInfoResponse.success ? pageInfoResponse.data.pageType || 'other' : 'other';
            await StorageService.savePartialResult(tab.url, pageType, message.payload);
          }
        } catch (error) {
          console.warn('⚠️ Failed to persist partial result:', error);
        }
      } else if (message.action === 'ANALYSIS_COMPLETE' && message.payload) {
        // Handle direct completion notification from content script
        console.log('✅ Received ANALYSIS_COMPLETE message immediately from content script');
        const result = message.payload;
        
        if (isValidAnalysisResult(result)) {
          console.log('✅ Analysis complete, displaying results immediately');
          setAnalysisResult(result);
          setIsFromCache(false);
          completeAnalysis();
          
          // Update icon badge
          updateIconForCachedResult(result);
          
          // Show notification for risky sites
          showRiskNotification(result);
          
          // Clear polling intervals as result is ready
          if (pollInterval) {
            clearInterval(pollInterval);
            setPollInterval(null);
          }
          
          // Clear partial results since we now have final results
          try {
            const tab = await MessagingService.getActiveTab();
            if (tab?.url) {
              const pageType = result.pageType || 'other';
              await StorageService.clearPartialResult(tab.url, pageType);
            }
          } catch (error) {
            console.warn('⚠️ Failed to clear partial results:', error);
          }
          
          // Check if current page is a policy page after analysis completes
          await checkPolicyPage();
        }
      } else if (message.action === 'POLICY_PAGE_DETECTED' && message.payload) {
        const { isPolicyPage: isPolicy, url } = message.payload;
        
        const tab = await MessagingService.getActiveTab();
        if (tab?.url === url) {
          setIsPolicyPage(isPolicy);
          if (isPolicy) {
            setPolicyAnalysis(null);
          }
        }
      }
    };

    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    
    return () => {
      chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
    };
  }, [setPartialResult, completeAnalysis, pollInterval]);

  // Listen for cross-tab synchronization messages
  useEffect(() => {
    const unsubscribeAnalysisUpdate = crossTabSync.on('ANALYSIS_UPDATE', (message) => {
      console.log('🔄 Cross-tab analysis update received:', message.payload);
      // Update local state if the URL matches
      if (message.payload.url === currentUrl && message.payload.result) {
        console.log('✅ Analysis complete via cross-tab sync, updating UI');
        
        // Always set the result and complete analysis, even if validation fails
        setAnalysisResult(message.payload.result);
        setIsFromCache(false);
        completeAnalysis();
        
        // Show notification for risky sites (only if result is valid)
        if (isValidAnalysisResult(message.payload.result)) {
          showRiskNotification(message.payload.result);
          
          // Clear any stored partial results since we now have final results (async, don't wait)
          const pageType = message.payload.result.pageType || 'other';
          StorageService.clearPartialResult(message.payload.url, pageType).catch(error => {
            console.warn('⚠️ Failed to clear partial results:', error);
          });
        } else {
          console.warn('⚠️ Analysis result received but failed validation');
        }
        
        // Check if current page is a policy page after analysis completes
        checkPolicyPage();
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

  // Listen for backend job progress updates
  useEffect(() => {
    const handleProgressMessage = (message: any) => {
      if (message.type === 'ANALYSIS_PROGRESS') {
        const { progress, stage } = message;
        console.log('📊 Progress update:', { progress, stage });
        updateBackendJobProgress(progress, 'processing', '', stage);
      } else if (message.type === 'BACKEND_JOB_STARTED') {
        const { jobId } = message;
        console.log('🚀 Backend job started:', jobId);
        setBackendJob(jobId);
      }
    };

    // Listen for messages from service worker
    chrome.runtime.onMessage.addListener(handleProgressMessage);

    // Cleanup: remove listener when effect re-runs or component unmounts
    return () => {
      chrome.runtime.onMessage.removeListener(handleProgressMessage);
    };
  }, [updateBackendJobProgress, setBackendJob]);

  const initializePopup = async () => {
    // Load persisted analysis state from storage
    await initializeAnalysisStore();

    // Don't show loading on startup for better UX
    setIsCheckingCache(false);

    try {
      // Initialize cross-tab sync
      await crossTabSync.initialize();

      await testConnection();

      // Start cache loading and show checking state only if it takes time
      const cacheCheckPromise = loadCachedAnalysisFast();
      const fullCheckPromise = loadCachedAnalysisFull();

      // Show checking cache UI only if fast cache loading takes more than 100ms
      const timeoutId = setTimeout(() => {
        setIsCheckingCache(true);
      }, 100);

      // Wait for fast cache loading
      await cacheCheckPromise;
      clearTimeout(timeoutId);

      // If we still don't have results after fast loading, hide checking state
      if (!analysisResult && !partialResult) {
        setIsCheckingCache(false);
      }

      // Continue with full analysis check in background
      await fullCheckPromise;

      // Check if current page is a policy page
      await checkPolicyPage();

      // Final cleanup
      setIsCheckingCache(false);
    } catch (error) {
      console.error('Initialization error:', error);
      setIsCheckingCache(false);
    }
  };  const testConnection = async () => {
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
  // Also checks backend database for persistent cache
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
          
          // Try to restore partial results if available
          const partialResult = await StorageService.loadPartialResult(tab.url, pageType);
          if (partialResult) {
            console.log(`📊 Restored partial result for ${pageType}`);
            setPartialResult(partialResult);
          }
          
          return;
        }

        // STEP 1: Check Chrome storage cache (fast, local)
        console.log(`🔍 Checking Chrome storage cache for: ${tab.url} (${pageType})`);
        const chromeCached = await StorageService.getCachedAnalysis(tab.url, pageType);
        
        if (chromeCached && isValidAnalysisResult(chromeCached)) {
          // Only update if we don't already have a result from fast loading
          if (!analysisResult) {
            console.log(`✅ Chrome cache hit for ${pageType}:`, chromeCached);
            setAnalysisResult(chromeCached);
            setIsFromCache(true);
          }
          return; // Found in Chrome cache, stop looking
        }

        // STEP 2: Check backend database cache (persistent, survives browser restart)
        console.log(`🔍 Checking backend cache for: ${tab.url} (${pageType})`);
        try {
          const backendCacheUrl = getApiUrl(`/api/jobs/cached?url=${encodeURIComponent(tab.url)}&pageType=${encodeURIComponent(pageType)}`);
          const backendResponse = await fetch(backendCacheUrl, { 
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
          });
          
          if (backendResponse.ok) {
            const backendData = await backendResponse.json();
            
            if (backendData.cached && backendData.analysis?.result_data) {
              const backendResult = backendData.analysis.result_data;
              
              // Validate the result from backend
              if (isValidAnalysisResult(backendResult)) {
                console.log(`✅ Backend cache hit for ${pageType} (${backendData.cacheAge || 0}s old):`, backendResult);
                
                // Also store in Chrome cache for faster next time
                await cacheService.set(tab.url, pageType, backendResult);
                
                // Only update if we don't already have a result from fast loading
                if (!analysisResult) {
                  setAnalysisResult(backendResult);
                  setIsFromCache(true);
                }
                return; // Found in backend cache, stop looking
              }
            }
          }
        } catch (backendError) {
          // Backend cache check failed - that's okay, continue to ready for analysis
          console.warn('⚠️ Backend cache check failed:', backendError);
        }

        // STEP 3: No cache found anywhere - ready for fresh analysis
        console.log(`❌ No cache found for ${pageType} - ready to analyze`);
        setIsFromCache(false);
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
          { url: tab.url, includeAI: useAI, includeWhois: true, delta: true }
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
    
    setIsUpdating(true);
    setIsFromCache(false); // Reset cache flag for fresh analysis
    
    const tab = await MessagingService.getActiveTab();
    if (!tab?.url) {
      setError(createErrorFromMessage('No active browser tab found - please make sure you have a website open'));
      setIsUpdating(false);
      return;
    }

    // If forcing refresh, clear cache, locks, and current results
    // This prevents "stuck re-analyzing" when settings change
    if (force) {
      await StorageService.clearCachedAnalysis(tab.url);
      await StorageService.clearAnalysisProgress(tab.url); // Clear progress markers
      await StorageService.clearLockForUrl(tab.url); // Clear any stale locks
      setAnalysisResult(null); // Clear current results to show loading state
    }

    startAnalysis(tab.url);

    // Start analysis asynchronously - don't wait for response since results come via cross-tab sync
    MessagingService.sendToActiveTab<any, AnalysisResult>(
      'ANALYZE_PAGE',
      { url: tab.url, includeAI: useAI, includeWhois: true }
    ).then((response) => {
      if (response.success && response.data) {
        console.log('✅ Analysis response received, but results will come via cross-tab sync');
      } else {
        console.warn('⚠️ Analysis request failed:', response.error);
        completeAnalysis(); // Reset loading state on failure
      }
    }).catch((error) => {
      console.error('❌ Analysis request error:', error);
      completeAnalysis(); // Reset loading state on error
    });
    
    // Reset the update lock since we're not waiting for completion
    setIsUpdating(false);
  };

  // Handle settings changes with async lock clearing (non-blocking)
  const handleSettingChange = (callback: () => void, shouldClearLocks = true) => {
    // Execute the state change immediately (synchronous)
    callback();
    
    // Clear locks asynchronously in background (non-blocking)
    if (shouldClearLocks && isLoading) {
      MessagingService.getActiveTab().then(tab => {
        if (tab?.url) {
          console.log('🔧 Settings changed during analysis, clearing locks...');
          StorageService.clearLockForUrl(tab.url).catch(err => 
            console.warn('Failed to clear locks:', err)
          );
        }
      }).catch(err => console.warn('Failed to get active tab:', err));
    }
  };

  // Save AI setting to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('shop-sentinel-use-ai', useAI.toString());
  }, [useAI]);

  return (
    <div className="w-[420px] min-h-[600px] bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700 dark:from-slate-800 dark:via-slate-700 dark:to-slate-800">
        <div className="h-full flex flex-col bg-white dark:bg-slate-800 rounded-b-xl">
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
            <div className="flex items-center gap-2">
              {/* Re-analyze button (top-right, compact) */}
              {currentResult && (
                <button 
                  onClick={() => handleAnalyze(true)} 
                  disabled={isLoading}
                  title="Re-analyze this page with current settings"
                  className="px-3 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 disabled:bg-opacity-10 disabled:cursor-not-allowed rounded-full text-sm font-semibold transition-all duration-200 flex items-center gap-1 border border-white border-opacity-30"
                >
                  {isLoading ? (
                    <>
                      <span className="animate-spin">🔄</span>
                      <span className="hidden sm:inline">Analyzing</span>
                    </>
                  ) : (
                    <>
                      <span>🔄</span>
                      <span className="hidden sm:inline">Re-analyze</span>
                    </>
                  )}
                </button>
              )}
              {/* Settings button */}
              <div className="w-9 h-9 bg-white bg-opacity-25 rounded-full flex items-center justify-center backdrop-blur-sm shadow-lg border-2 border-white border-opacity-30 cursor-pointer hover:bg-opacity-35 transition-all duration-200" onClick={() => setShowSettings(true)}>
                <span className="text-xl">⚙️</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col">
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

          {isCheckingCache && !analysisResult && !partialResult && !error && (
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

          {!analysisResult && !partialResult && !isLoading && !isCheckingCache && (
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

                {/* Policy Analysis Option - Only show when on policy page */}
                {isPolicyPage && (
                  <div className="mt-6 p-4 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900 dark:to-emerald-800 border-2 border-green-300 dark:border-green-600 rounded-xl shadow-sm">
                    <div className="text-center space-y-3">
                      <div className="flex items-center justify-center gap-2">
                        <span className="text-2xl">📄</span>
                        <h3 className="text-lg font-bold text-green-800 dark:text-green-200">
                          Policy Page Detected
                        </h3>
                      </div>
                      <p className="text-sm text-green-700 dark:text-green-300">
                        Get AI-powered insights about key terms and conditions.
                      </p>
                      
                      {policyLegitimacy && (!policyLegitimacy.isLegitimate || policyLegitimacy.score < 80) && (policyLegitimacy.warnings.length > 0 || policyLegitimacy.redFlags.length > 0) && (
                        <div className={`mt-3 p-3 border-2 rounded-lg ${
                          policyLegitimacy.score < 50 || policyLegitimacy.redFlags.length > 0
                            ? 'bg-red-50 dark:bg-red-900 border-red-400 dark:border-red-600'
                            : policyLegitimacy.score < 70
                            ? 'bg-orange-50 dark:bg-orange-900 border-orange-400 dark:border-orange-600'
                            : 'bg-yellow-50 dark:bg-yellow-900 border-yellow-400 dark:border-yellow-600'
                        }`}>
                          <div className="flex items-start gap-2">
                            <span className="text-xl flex-shrink-0">{policyLegitimacy.score < 50 || policyLegitimacy.redFlags.length > 0 ? '🚨' : '⚠️'}</span>
                            <div className="flex-1 text-left">
                              <h4 className={`text-sm font-bold mb-2 ${
                                policyLegitimacy.score < 50 || policyLegitimacy.redFlags.length > 0
                                  ? 'text-red-800 dark:text-red-200'
                                  : policyLegitimacy.score < 70
                                  ? 'text-orange-800 dark:text-orange-200'
                                  : 'text-yellow-800 dark:text-yellow-200'
                              }`}>Policy Quality {policyLegitimacy.score < 50 ? 'Issues' : 'Concerns'}</h4>
                              
                              {policyLegitimacy.redFlags.length > 0 && (
                                <div className="mb-2">
                                  <p className="text-xs font-semibold text-red-700 dark:text-red-300 mb-1">Critical Issues:</p>
                                  <ul className="text-xs text-red-600 dark:text-red-400 space-y-1">
                                    {policyLegitimacy.redFlags.map((flag: string, idx: number) => (
                                      <li key={idx} className="flex items-start gap-1">
                                        <span>•</span>
                                        <span>{flag}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              
                              {policyLegitimacy.warnings.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-orange-700 dark:text-orange-300 mb-1">Warnings:</p>
                                  <ul className="text-xs text-orange-600 dark:text-orange-400 space-y-1">
                                    {policyLegitimacy.warnings.slice(0, 3).map((warning: string, idx: number) => (
                                      <li key={idx} className="flex items-start gap-1">
                                        <span>•</span>
                                        <span>{warning}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              
                              <div className="mt-2 text-xs text-red-700 dark:text-red-300 font-semibold">
                                Legitimacy Score: {policyLegitimacy.score}/100
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      
                      {!policyAnalysis ? (
                        <button 
                          onClick={analyzePolicy} 
                          disabled={isAnalyzingPolicy}
                          className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 disabled:from-gray-400 disabled:to-gray-500 text-white font-bold py-3 px-4 rounded-lg transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-105 disabled:transform-none disabled:opacity-50"
                        >
                          {isAnalyzingPolicy ? (
                            <span className="flex items-center justify-center gap-2">
                              <span className="animate-spin">🤖</span>
                              <span>Analyzing Policy...</span>
                            </span>
                          ) : (
                            <span className="flex items-center justify-center gap-2">
                              <span>🤖</span>
                              <span>Analyze Policy</span>
                            </span>
                          )}
                        </button>
                      ) : (
                        <div className="text-left space-y-2">
                          <h4 className="font-bold text-green-800 dark:text-green-200">AI Summary:</h4>
                          <div className="space-y-1">
                            {policyAnalysis.policySummary?.summary?.map((point: string, idx: number) => (
                              <div key={idx} className="text-sm text-green-700 dark:text-green-300 flex items-start gap-2">
                                <span className="text-green-600 dark:text-green-400 flex-shrink-0">•</span>
                                <span>{point}</span>
                              </div>
                            ))}
                          </div>
                          
                          {policyAnalysis.policySummary?.keyPoints?.returnWindow && (
                            <div className="mt-2 p-2 bg-white dark:bg-green-800 bg-opacity-60 rounded-lg">
                              <span className="text-sm font-semibold text-green-800 dark:text-green-200">
                                ⏱️ Return Window: {policyAnalysis.policySummary.keyPoints.returnWindow}
                              </span>
                            </div>
                          )}
                          
                          {policyAnalysis.policySummary?.riskFactors?.length > 0 && (
                            <div className="mt-2">
                              <h5 className="text-sm font-bold text-red-700 dark:text-red-300">⚠️ Important Conditions:</h5>
                              <ul className="text-xs text-red-600 dark:text-red-400 space-y-1">
                                {policyAnalysis.policySummary.riskFactors.map((risk: string, idx: number) => (
                                  <li key={idx} className="flex items-start gap-1">
                                    <span>•</span>
                                    <span>{risk}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
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
                
                {/* Real-time progress tracking */}
                {(currentPhase || progressPercentage > 0) && (
                  <div className="mt-6 px-4 w-full max-w-sm space-y-4">
                    {/* Progress bar */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                          {currentPhase?.phase === 'heuristic' && '🔍 Heuristic Analysis'}
                          {currentPhase?.phase === 'ai_init' && '⚙️ AI Initialization'}
                          {currentPhase?.phase === 'ai_domain' && '🔗 Domain Analysis'}
                          {currentPhase?.phase === 'ai_darkpattern' && '🎭 Dark Pattern Detection'}
                          {currentPhase?.phase === 'ai_legitimacy' && '✓ Legitimacy Check'}
                          {currentPhase?.phase === 'consolidation' && '📊 Consolidating Results'}
                        </span>
                        <span className="text-xs font-bold text-gray-600 dark:text-gray-400">{progressPercentage}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className="h-full transition-all duration-300"
                          style={{
                            width: `${progressPercentage}%`,
                            backgroundColor:
                              currentPhase?.phase === 'heuristic' ? '#3b82f6' :
                              currentPhase?.phase === 'ai_init' ? '#8b5cf6' :
                              currentPhase?.phase === 'ai_domain' ? '#ec4899' :
                              currentPhase?.phase === 'ai_darkpattern' ? '#f97316' :
                              currentPhase?.phase === 'ai_legitimacy' ? '#10b981' :
                              currentPhase?.phase === 'consolidation' ? '#06b6d4' :
                              '#3b82f6',
                          }}
                        ></div>
                      </div>
                    </div>
                    
                    {/* Current phase status */}
                    {currentPhase && (
                      <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                        <div className="flex items-center gap-2">
                          <span>{currentPhase.status === 'completed' ? '✅' : currentPhase.status === 'processing' ? '🔄' : '⏳'}</span>
                          <span>{currentPhase.subPhase}</span>
                          {currentPhase.elapsedMs !== undefined && <span className="text-gray-500">({(currentPhase.elapsedMs / 1000).toFixed(1)}s)</span>}
                        </div>
                        {currentPhase.findings && currentPhase.findings.signalsFound > 0 && (
                          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                            <span>+{currentPhase.findings.signalsFound} signals</span>
                            {currentPhase.findings.topFinding && <span className="text-gray-600 dark:text-gray-400">({currentPhase.findings.topFinding.substring(0, 30)}...)</span>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                
                {/* Backend job progress if available */}
                {backendJobProgress > 0 && !progressPercentage && (
                  <div className="mt-6 px-4 w-full max-w-sm">
                    <AnalysisProgress
                      progress={backendJobProgress}
                      stage={backendJobStage}
                      isActive={true}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {(analysisResult || partialResult) ? ( 
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
                <div className="flex gap-1 bg-gray-100 dark:bg-slate-700 rounded-xl p-1.5 shadow-inner">
                  <button onClick={() => setActiveTab('overview')} className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-semibold transition-all duration-200 ${activeTab === 'overview' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-md transform scale-105' : 'text-gray-600 dark:text-slate-200 hover:text-gray-900 dark:hover:text-slate-100 hover:bg-white dark:hover:bg-slate-600 hover:bg-opacity-50'}`}>
                    Overview
                  </button>
                  <button onClick={() => setActiveTab('reasons')} className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-semibold transition-all duration-200 relative ${activeTab === 'reasons' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-md transform scale-105' : 'text-gray-600 dark:text-slate-200 hover:text-gray-900 dark:hover:text-slate-100 hover:bg-white dark:hover:bg-slate-600 hover:bg-opacity-50'}`}>
                    Issues
                    {(currentResult!.allSignals?.length ?? 0) > 0 && (
                      <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-xs font-bold ${activeTab === 'reasons' ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300' : 'bg-gray-200 dark:bg-slate-600 text-gray-700 dark:text-slate-300'}`}>
                        {currentResult!.allSignals?.length ?? 0}
                      </span>
                    )}
                  </button>
                  <button onClick={() => setActiveTab('policies')} className={`flex-1 py-2.5 px-3 rounded-lg text-sm font-semibold transition-all duration-200 ${activeTab === 'policies' ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-md transform scale-105' : 'text-gray-600 dark:text-slate-200 hover:text-gray-900 dark:hover:text-slate-100 hover:bg-white dark:hover:bg-slate-600 hover:bg-opacity-50'}`}>
                    Policies
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-thin px-4 pb-4">
                {activeTab === 'overview' && (
                  <div className="space-y-4 animate-fadeIn">
                    <div className="flex justify-center py-6 bg-gradient-to-br from-gray-50 to-blue-50 dark:from-slate-700 dark:to-slate-800 rounded-xl">
                      <RiskMeter score={currentResult!.totalRiskScore} level={currentResult!.riskLevel} size="large" animated={true} />
                    </div>
                    
                    {/* Trust-Based Dampening Indicator */}
                    {currentResult!.trustFactor !== undefined && currentResult!.trustFactor > 0.6 && (
                      <div className="flex items-start gap-2 px-4 py-3 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-slate-700 dark:to-slate-600 rounded-xl border border-emerald-300 dark:border-slate-500">
                        <span className="text-lg flex-shrink-0 mt-0.5">🛡️</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-gray-800 dark:text-gray-200">
                            Score adjusted for established domain
                          </p>
                          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                            This domain has been verified and is{' '}
                            {currentResult!.trustFactor > 0.8 ? 'highly trusted' : 'well-established'}
                            . Security concerns are dampened accordingly.
                          </p>
                        </div>
                      </div>
                    )}
                    
                    {/* AI Status Indicator */}
                    {showOfflineMode ? (
                      <div className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-yellow-50 to-orange-50 dark:from-slate-700 dark:to-slate-600 rounded-xl border border-yellow-300 dark:border-slate-500">
                        <span className="text-lg">📱</span>
                        <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
                          Offline Mode: <span className="text-orange-600 dark:text-orange-400">Basic analysis only</span>
                        </span>
                        <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 text-center">
                          AI features unavailable - showing heuristic analysis results
                        </div>
                      </div>
                    ) : currentResult!.aiEnabled ? (
                      <div className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-slate-700 dark:to-slate-600 rounded-xl border border-purple-200 dark:border-slate-600">
                        <span className="text-lg">🤖</span>
                        <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
                          AI Analysis: <span className="text-purple-600 dark:text-purple-400">{currentResult!.aiSignalsCount || 0} signals detected</span>
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-slate-700 dark:to-slate-600 rounded-xl border border-blue-200 dark:border-slate-600">
                        <span className="text-lg">🔍</span>
                        <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
                          Analyzing with AI...
                        </span>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-slate-700 dark:to-slate-600 rounded-xl p-4 border border-blue-200 dark:border-slate-500 shadow-sm">
                        <div className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1.5 uppercase tracking-wide">Security</div>
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">{(currentResult!.security?.isHttps ?? false) ? '🔒' : '⚠️'}</span>
                          <span className="font-bold text-gray-800 dark:text-gray-200">{(currentResult!.security?.isHttps ?? false) ? 'HTTPS' : 'Not Secure'}</span>
                        </div>
                      </div>
                      <div className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-slate-700 dark:to-slate-600 rounded-xl p-4 border border-purple-200 dark:border-slate-500 shadow-sm">
                        <div className="text-xs font-semibold text-purple-600 dark:text-purple-400 mb-1.5 uppercase tracking-wide">Issues Found</div>
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">{(currentResult!.allSignals?.length ?? 0) === 0 ? '✅' : '🚨'}</span>
                          <span className="font-bold text-gray-800 dark:text-gray-200">{currentResult!.allSignals?.length ?? 0} detected</span>
                        </div>
                      </div>
                    </div>
                    {(currentResult!.allSignals?.length ?? 0) > 0 && (
                      <div>
                        <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
                          <span className="text-lg">⚠️</span>Top Issues
                        </h3>
                        <ReasonsList signals={currentResult!.allSignals ?? []} maxItems={2} showCategory={true} compact={true} />
                        {(currentResult!.allSignals?.length ?? 0) > 2 && (
                          <button onClick={() => setActiveTab('reasons')} className="w-full mt-3 py-2 px-4 bg-gradient-to-r from-orange-100 to-red-100 dark:from-slate-600 dark:to-slate-500 hover:from-orange-200 hover:to-red-200 dark:hover:from-slate-500 dark:hover:to-slate-400 border-2 border-orange-300 dark:border-slate-400 text-orange-900 dark:text-slate-200 font-semibold text-sm rounded-xl transition-all duration-200 shadow-sm hover:shadow">
                            View All {currentResult!.allSignals?.length ?? 0} Issues →
                          </button>
                        )}
                      </div>
                    )}
                    <div>
                      <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
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
                    
                    {/* Policy Analysis Option - Show when on policy page */}
                    {isPolicyPage && (
                      <div className="mt-4 p-4 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900 dark:to-emerald-800 border-2 border-green-300 dark:border-green-600 rounded-xl shadow-sm">
                        <div className="text-center space-y-3">
                          <div className="flex items-center justify-center gap-2">
                            <span className="text-2xl">📄</span>
                            <h3 className="text-lg font-bold text-green-800 dark:text-green-200">
                              Policy Page Detected
                            </h3>
                          </div>
                          <p className="text-sm text-green-700 dark:text-green-300">
                            Get AI-powered insights about key terms and conditions.
                          </p>
                          
                          {policyLegitimacy && (!policyLegitimacy.isLegitimate || policyLegitimacy.score < 80) && (policyLegitimacy.warnings.length > 0 || policyLegitimacy.redFlags.length > 0) && (
                            <div className={`mt-3 p-3 border-2 rounded-lg ${
                              policyLegitimacy.score < 50 || policyLegitimacy.redFlags.length > 0
                                ? 'bg-red-50 dark:bg-red-900 border-red-400 dark:border-red-600'
                                : policyLegitimacy.score < 70
                                ? 'bg-orange-50 dark:bg-orange-900 border-orange-400 dark:border-orange-600'
                                : 'bg-yellow-50 dark:bg-yellow-900 border-yellow-400 dark:border-yellow-600'
                            }`}>
                              <div className="flex items-start gap-2">
                                <span className="text-xl flex-shrink-0">{policyLegitimacy.score < 50 || policyLegitimacy.redFlags.length > 0 ? '🚨' : '⚠️'}</span>
                                <div className="flex-1 text-left">
                                  <h4 className={`text-sm font-bold mb-2 ${
                                    policyLegitimacy.score < 50 || policyLegitimacy.redFlags.length > 0
                                      ? 'text-red-800 dark:text-red-200'
                                      : policyLegitimacy.score < 70
                                      ? 'text-orange-800 dark:text-orange-200'
                                      : 'text-yellow-800 dark:text-yellow-200'
                                  }`}>Policy Quality {policyLegitimacy.score < 50 ? 'Issues' : 'Concerns'}</h4>
                                  
                                  {policyLegitimacy.redFlags.length > 0 && (
                                    <div className="mb-2">
                                      <p className="text-xs font-semibold text-red-700 dark:text-red-300 mb-1">Critical Issues:</p>
                                      <ul className="text-xs text-red-600 dark:text-red-400 space-y-1">
                                        {policyLegitimacy.redFlags.map((flag: string, idx: number) => (
                                          <li key={idx} className="flex items-start gap-1">
                                            <span>•</span>
                                            <span>{flag}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                  
                                  {policyLegitimacy.warnings.length > 0 && (
                                    <div>
                                      <p className="text-xs font-semibold text-orange-700 dark:text-orange-300 mb-1">Warnings:</p>
                                      <ul className="text-xs text-orange-600 dark:text-orange-400 space-y-1">
                                        {policyLegitimacy.warnings.slice(0, 3).map((warning: string, idx: number) => (
                                          <li key={idx} className="flex items-start gap-1">
                                            <span>•</span>
                                            <span>{warning}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                  
                                  <div className="mt-2 text-xs text-red-700 dark:text-red-300 font-semibold">
                                    Legitimacy Score: {policyLegitimacy.score}/100
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                          
                          {!policyAnalysis ? (
                            <button 
                              onClick={analyzePolicy} 
                              disabled={isAnalyzingPolicy}
                              className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 disabled:from-gray-400 disabled:to-gray-500 text-white font-bold py-3 px-4 rounded-lg transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-105 disabled:transform-none disabled:opacity-50"
                            >
                              {isAnalyzingPolicy ? (
                                <span className="flex items-center justify-center gap-2">
                                  <span className="animate-spin">🤖</span>
                                  <span>Analyzing Policy...</span>
                                </span>
                              ) : (
                                <span className="flex items-center justify-center gap-2">
                                  <span>🤖</span>
                                  <span>Analyze Policy</span>
                                </span>
                              )}
                            </button>
                          ) : (
                            <div className="text-left space-y-2">
                              <h4 className="font-bold text-green-800 dark:text-green-200">AI Summary:</h4>
                              <div className="space-y-1">
                                {policyAnalysis.policySummary?.summary?.map((point: string, idx: number) => (
                                  <div key={idx} className="text-sm text-green-700 dark:text-green-300 flex items-start gap-2">
                                    <span className="text-green-600 dark:text-green-400 flex-shrink-0">•</span>
                                    <span>{point}</span>
                                  </div>
                                ))}
                              </div>
                              
                              {policyAnalysis.policySummary?.keyPoints?.returnWindow && (
                                <div className="mt-2 p-2 bg-white dark:bg-green-800 bg-opacity-60 rounded-lg">
                                  <span className="text-sm font-semibold text-green-800 dark:text-green-200">
                                    ⏱️ Return Window: {policyAnalysis.policySummary.keyPoints.returnWindow}
                                  </span>
                                </div>
                              )}
                              
                              {policyAnalysis.policySummary?.riskFactors?.length > 0 && (
                                <div className="mt-2">
                                  <h5 className="text-sm font-bold text-red-700 dark:text-red-300">⚠️ Important Conditions:</h5>
                                  <ul className="text-xs text-red-600 dark:text-red-400 space-y-1">
                                    {policyAnalysis.policySummary.riskFactors.map((risk: string, idx: number) => (
                                      <li key={idx} className="flex items-start gap-1">
                                        <span>•</span>
                                        <span>{risk}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {currentUrl && (
                <div className="px-4 py-3 bg-gray-50 dark:bg-slate-700 border-t border-gray-200 dark:border-slate-600 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">🌐</span>
                    <span className="text-xs text-gray-600 dark:text-gray-400 truncate flex-1">{new URL(currentUrl).hostname}</span>
                  </div>
                  
                  {/* Analysis History */}
                  {analysisHistory.length > 1 && (
                    <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-600">
                      <div className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">📜 Recent Analyses</div>
                      <div className="space-y-1">
                        {analysisHistory.slice(0, 3).map((item, idx) => (
                          <div key={idx} className="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-2 p-1 rounded hover:bg-white hover:dark:bg-slate-600 transition-colors cursor-pointer">
                            <span className={
                              item.riskLevel === 'high' ? '🔴' :
                              item.riskLevel === 'medium' ? '🟡' :
                              item.riskLevel === 'low' ? '🟢' :
                              '⚪'
                            }></span>
                            <span>{item.finalScore}/100</span>
                            <span className="text-gray-500 dark:text-gray-500">
                              {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}
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
                        onChange={(e) => handleSettingChange(() => setUseAI(e.target.checked))}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
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
                            hasReturnRefundPolicy: false, 
                            hasShippingPolicy: false, 
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
                          setTheme('auto');
                          setNotifications(true);
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
    </div>
  );
}

export default App;
