import { useEffect, useState } from 'react';
import { useAnalysisStore } from '../stores';
import { MessagingService } from '../services/messaging';
import type { AnalysisResult } from '../types';
import { RiskMeter, ReasonsList, PolicySummary } from '../components';

function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'reasons' | 'policies'>('overview');
  
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

  useEffect(() => {
    testConnection();
  }, []);

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

  const handleAnalyze = async () => {
    try {
      const tab = await MessagingService.getActiveTab();
      if (!tab?.url) {
        setError('No active tab found');
        return;
      }

      startAnalysis(tab.url);

      const response = await MessagingService.sendToActiveTab<any, AnalysisResult>(
        'ANALYZE_PAGE',
        { url: tab.url, includeAI: false }
      );

      if (response.success && response.data) {
        setAnalysisResult(response.data);
        completeAnalysis();
      } else {
        setError(response.error || 'Analysis failed');
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Analysis failed');
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

          {!analysisResult && (
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
                <button onClick={handleAnalyze} disabled={isLoading} className="w-full max-w-xs mx-auto bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 disabled:from-gray-400 disabled:to-gray-500 text-white font-bold py-4 px-6 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105 disabled:transform-none disabled:opacity-50">
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

          {analysisResult && (
            <div className="flex-1 flex flex-col">
              <div className="px-4 pt-4 pb-2">
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
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-200 shadow-sm">
                        <div className="text-xs font-semibold text-blue-600 mb-1.5 uppercase tracking-wide">Security</div>
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">{analysisResult.security.isHttps ? '🔒' : '⚠️'}</span>
                          <span className="font-bold text-gray-800">{analysisResult.security.isHttps ? 'HTTPS' : 'Not Secure'}</span>
                        </div>
                      </div>
                      <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl p-4 border border-purple-200 shadow-sm">
                        <div className="text-xs font-semibold text-purple-600 mb-1.5 uppercase tracking-wide">Issues Found</div>
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">{analysisResult.allSignals.length === 0 ? '✅' : '🚨'}</span>
                          <span className="font-bold text-gray-800">{analysisResult.allSignals.length} detected</span>
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
                    <button onClick={handleAnalyze} disabled={isLoading} className="w-full mt-2 py-3 px-4 bg-gradient-to-r from-gray-100 to-gray-200 hover:from-gray-200 hover:to-gray-300 disabled:from-gray-50 disabled:to-gray-100 border-2 border-gray-300 text-gray-700 font-semibold rounded-xl transition-all duration-200 shadow-sm hover:shadow disabled:opacity-50 disabled:cursor-not-allowed">
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
