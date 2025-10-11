import { create } from 'zustand';
import { AnalysisResult, PolicySummary } from '../types';

interface AnalysisState {
  currentUrl: string | null;
  analysisResult: AnalysisResult | null;
  policySummaries: Record<string, PolicySummary>;
  isLoading: boolean;
  isAnalyzing: boolean;
  isSummarizingPolicy: boolean;
  error: string | null;
  lastAnalyzedAt: number | null;
  analysisProgress: number;
}

interface AnalysisActions {
  startAnalysis: (url: string) => void;
  setAnalysisResult: (result: AnalysisResult) => void;
  updateAnalysisProgress: (progress: number) => void;
  completeAnalysis: () => void;
  startPolicySummary: () => void;
  setPolicySummary: (policyType: string, summary: PolicySummary) => void;
  completePolicySummary: () => void;
  setError: (error: string) => void;
  clearError: () => void;
  setLoading: (isLoading: boolean) => void;
  reset: () => void;
  setCurrentUrl: (url: string) => void;
}

type AnalysisStore = AnalysisState & AnalysisActions;

const initialState: AnalysisState = {
  currentUrl: null,
  analysisResult: null,
  policySummaries: {},
  isLoading: false,
  isAnalyzing: false,
  isSummarizingPolicy: false,
  error: null,
  lastAnalyzedAt: null,
  analysisProgress: 0,
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
      analysisResult: null, // Clear result to show loading state
    });
  },
  
  setAnalysisResult: (result: AnalysisResult) => {
    set({
      analysisResult: result,
      lastAnalyzedAt: Date.now(),
      analysisProgress: 100,
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
  
  setError: (error: string) => {
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
