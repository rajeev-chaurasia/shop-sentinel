import { create } from 'zustand';
import { AnalysisResult, PolicySummary } from '../types';
import { AppError } from '../types/errors';

/**
 * FIX #3: State Persistence Functions
 * Automatically persist store state to Chrome storage
 */
async function persistState(state: any, key: string) {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [key]: JSON.stringify(state) });
      console.log(`✅ State persisted to ${key}`);
    }
  } catch (error) {
    console.error(`Failed to persist state to ${key}:`, error);
  }
}

async function rehydrateState(key: string): Promise<any | null> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const result = await chrome.storage.local.get(key);
      if (result[key]) {
        console.log(`✅ State rehydrated from ${key}`);
        return JSON.parse(result[key]);
      }
    }
  } catch (error) {
    console.error(`Failed to rehydrate state from ${key}:`, error);
  }
  return null;
}

interface AnalysisState {
  currentUrl: string | null;
  analysisResult: AnalysisResult | null;
  partialResult: AnalysisResult | null; // Progressive loading support
  policySummaries: Record<string, PolicySummary>;
  isLoading: boolean;
  isAnalyzing: boolean;
  isSummarizingPolicy: boolean;
  error: AppError | null;
  lastAnalyzedAt: number | null;
  analysisProgress: number;
  
  // Backend job progress tracking
  backendJobId: string | null;
  backendJobProgress: number;
  backendJobStatus: 'idle' | 'pending' | 'processing' | 'completed' | 'failed';
  backendJobMessage: string;
  backendJobStage: string; // 'metadata', 'heuristics', 'ai_analysis', 'completed'
  backendJobEstimatedTimeRemaining: number | null; // milliseconds
  
  // Enhanced AI-specific state
  aiState: {
    isInitializing: boolean;
    isAnalyzing: boolean;
    isAvailable: boolean | null;
    modelDownloadProgress: number;
    sessionReady: boolean;
    lastError: string | null;
    analysisStage: 'idle' | 'initializing' | 'dark-patterns' | 'legitimacy' | 'complete';
    signalsFound: number;
    estimatedTimeRemaining: number | null;
  };
}

interface AnalysisActions {
  startAnalysis: (url: string) => void;
  setAnalysisResult: (result: AnalysisResult | null) => void;
  setPartialResult: (result: AnalysisResult | null) => void; // Progressive loading
  updateAnalysisProgress: (progress: number) => void;
  completeAnalysis: () => void;
  startPolicySummary: () => void;
  setPolicySummary: (policyType: string, summary: PolicySummary) => void;
  completePolicySummary: () => void;
  setError: (error: AppError | null) => void;
  clearError: () => void;
  setLoading: (isLoading: boolean) => void;
  reset: () => void;
  setCurrentUrl: (url: string) => void;
  
  // Backend job progress actions
  setBackendJob: (jobId: string) => void;
  updateBackendJobProgress: (progress: number, status?: string, message?: string, stage?: string, estimatedTimeRemaining?: number | null) => void;
  clearBackendJob: () => void;
  
  // Enhanced AI-specific actions
  setAIAvailable: (available: boolean) => void;
  setAIInitializing: (initializing: boolean) => void;
  setAIAnalyzing: (analyzing: boolean) => void;
  setAIStage: (stage: 'idle' | 'initializing' | 'dark-patterns' | 'legitimacy' | 'complete') => void;
  updateModelDownloadProgress: (progress: number) => void;
  setSessionReady: (ready: boolean) => void;
  setAIError: (error: string | null) => void;
  updateAISignalsFound: (count: number) => void;
  setEstimatedTimeRemaining: (seconds: number | null) => void;
  resetAIState: () => void;
}

type AnalysisStore = AnalysisState & AnalysisActions;

const initialAIState = {
  isInitializing: false,
  isAnalyzing: false,
  isAvailable: null,
  modelDownloadProgress: 0,
  sessionReady: false,
  lastError: null,
  analysisStage: 'idle' as const,
  signalsFound: 0,
  estimatedTimeRemaining: null,
};

const initialState: AnalysisState = {
  currentUrl: null,
  analysisResult: null,
  partialResult: null,
  policySummaries: {},
  isLoading: false,
  isAnalyzing: false,
  isSummarizingPolicy: false,
  error: null,
  lastAnalyzedAt: null,
  analysisProgress: 0,
  
  // Backend job progress
  backendJobId: null,
  backendJobProgress: 0,
  backendJobStatus: 'idle',
  backendJobMessage: '',
  backendJobStage: 'metadata',
  backendJobEstimatedTimeRemaining: null,
  
  aiState: initialAIState,
};

export const useAnalysisStore = create<AnalysisStore>((set, get) => ({
  ...initialState,
  
  startAnalysis: (url: string) => {
    set({
      currentUrl: url,
      isAnalyzing: true,
      isLoading: true,
      error: null,
      analysisProgress: 0,
      partialResult: null, // Clear partial results for new analysis
      // Don't clear analysisResult - keep showing previous results during loading
      // This prevents UI "reset" when reopening popup during analysis
    });
  },
  
  setAnalysisResult: (result: AnalysisResult | null) => {
    set({
      analysisResult: result,
      partialResult: null, // Clear partial results when final result is available
      lastAnalyzedAt: result ? Date.now() : null,
      analysisProgress: result ? 100 : 0,
    });
  },
  
  setPartialResult: (result: AnalysisResult | null) => {
    set({
      partialResult: result,
      analysisProgress: result ? Math.min(90, 30 + (result.aiEnabled ? 40 : 0)) : 0, // Show progress based on completion
    });
  },
  
  updateAnalysisProgress: (progress: number) => {
    set({ analysisProgress: Math.min(100, Math.max(0, progress)) });
  },
  
  completeAnalysis: () => {
    set({
      isAnalyzing: false,
      isLoading: false,
      analysisProgress: 100,
    });
  },
  
  startPolicySummary: () => {
    set({
      isSummarizingPolicy: true,
      isLoading: true,
      error: null,
    });
  },
  
  setPolicySummary: (policyType: string, summary: PolicySummary) => {
    const { policySummaries } = get();
    set({
      policySummaries: {
        ...policySummaries,
        [policyType]: summary,
      },
    });
  },
  
  completePolicySummary: () => {
    set({
      isSummarizingPolicy: false,
      isLoading: false,
    });
  },
  
  setError: (error: AppError | null) => {
    set({
      error,
      isLoading: false,
      isAnalyzing: false,
      isSummarizingPolicy: false,
    });
  },
  
  clearError: () => {
    set({ error: null });
  },
  
  setLoading: (isLoading: boolean) => {
    set({ isLoading });
  },
  
  setCurrentUrl: (url: string) => {
    set({ currentUrl: url });
  },
  
  reset: () => {
    set(initialState);
  },

  // Backend job progress actions
  setBackendJob: (jobId: string) => {
    const newState = {
      backendJobId: jobId,
      backendJobProgress: 0,
      backendJobStatus: 'pending' as const,
      backendJobMessage: 'Job created'
    };
    set(newState);
    persistState(get(), 'analysisStore'); // Auto-persist
  },

  updateBackendJobProgress: (progress: number, status?: string, message?: string, stage?: string, estimatedTimeRemaining?: number | null) => {
    const newState = {
      backendJobProgress: Math.min(100, Math.max(0, progress)),
      backendJobStatus: (status as any) || get().backendJobStatus,
      backendJobMessage: message || get().backendJobMessage,
      backendJobStage: stage || get().backendJobStage,
      backendJobEstimatedTimeRemaining: estimatedTimeRemaining !== undefined ? estimatedTimeRemaining : get().backendJobEstimatedTimeRemaining
    };
    set(newState);
    persistState(get(), 'analysisStore'); // Auto-persist
  },

  clearBackendJob: () => {
    const newState = {
      backendJobId: null,
      backendJobProgress: 0,
      backendJobStatus: 'idle' as const,
      backendJobMessage: '',
      backendJobStage: 'metadata',
      backendJobEstimatedTimeRemaining: null
    };
    set(newState);
    persistState(get(), 'analysisStore'); // Auto-persist
  },

  // Enhanced AI-specific actions
  setAIAvailable: (available: boolean) => {
    set(state => ({
      aiState: { ...state.aiState, isAvailable: available }
    }));
  },

  setAIInitializing: (initializing: boolean) => {
    set(state => ({
      aiState: { 
        ...state.aiState, 
        isInitializing: initializing,
        analysisStage: initializing ? 'initializing' : 'idle'
      }
    }));
  },

  setAIAnalyzing: (analyzing: boolean) => {
    set(state => ({
      aiState: { ...state.aiState, isAnalyzing: analyzing }
    }));
  },

  setAIStage: (stage) => {
    set(state => ({
      aiState: { ...state.aiState, analysisStage: stage }
    }));
  },

  updateModelDownloadProgress: (progress: number) => {
    set(state => ({
      aiState: { 
        ...state.aiState, 
        modelDownloadProgress: Math.min(100, Math.max(0, progress))
      }
    }));
  },

  setSessionReady: (ready: boolean) => {
    set(state => ({
      aiState: { ...state.aiState, sessionReady: ready }
    }));
  },

  setAIError: (error: string | null) => {
    set(state => ({
      aiState: { ...state.aiState, lastError: error }
    }));
  },

  updateAISignalsFound: (count: number) => {
    set(state => ({
      aiState: { ...state.aiState, signalsFound: count }
    }));
  },

  setEstimatedTimeRemaining: (seconds: number | null) => {
    set(state => ({
      aiState: { ...state.aiState, estimatedTimeRemaining: seconds }
    }));
  },

  resetAIState: () => {
    set({
      aiState: initialAIState
    });
  },
}));

export const useRiskScore = () =>
  useAnalysisStore((state) => state.analysisResult?.totalRiskScore ?? 0);

export const useRiskLevel = () =>
  useAnalysisStore((state) => state.analysisResult?.riskLevel ?? 'safe');

export const useIsLoading = () =>
  useAnalysisStore((state) => state.isLoading);

export const useError = () =>
  useAnalysisStore((state) => state.error);

export const useRiskSignals = () =>
  useAnalysisStore((state) => state.analysisResult?.allSignals ?? []);

export const useHasAnalysis = () =>
  useAnalysisStore((state) => state.analysisResult !== null);

// Enhanced AI-specific selectors
export const useAIState = () =>
  useAnalysisStore((state) => state.aiState);

export const useAIAvailable = () =>
  useAnalysisStore((state) => state.aiState.isAvailable);

export const useAIAnalyzing = () =>
  useAnalysisStore((state) => state.aiState.isAnalyzing);

export const useAIStage = () =>
  useAnalysisStore((state) => state.aiState.analysisStage);

export const useModelDownloadProgress = () =>
  useAnalysisStore((state) => state.aiState.modelDownloadProgress);

export const useAIError = () =>
  useAnalysisStore((state) => state.aiState.lastError);

export const useAISignalsFound = () =>
  useAnalysisStore((state) => state.aiState.signalsFound);

export const useEstimatedTimeRemaining = () =>
  useAnalysisStore((state) => state.aiState.estimatedTimeRemaining);

/**
 * FIX #3: Initialize store from persisted state
 * Call this once on app startup to restore previous session
 */
export async function initializeAnalysisStore() {
  try {
    const persisted = await rehydrateState('analysisStore');
    if (persisted) {
      // Merge persisted state with current state (don't restore loading states)
      useAnalysisStore.setState({
        ...persisted,
        isLoading: false,
        isAnalyzing: false,
        isSummarizingPolicy: false
      });
      console.log('✅ Analysis store initialized from persisted state');
      return true;
    }
  } catch (error) {
    console.error('Failed to initialize store:', error);
  }
  return false;
}

/**
 * FIX #3: Export persistence functions for use in components
 */
export { persistState, rehydrateState };