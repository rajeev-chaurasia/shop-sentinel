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

  // Test connectivity on mount
  useEffect(() => {
    testConnection();
  }, []);

  /**
   * Test if content script is ready
   */
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

  /**
   * Run analysis
   */
  const handleAnalyze = async () => {
    try {
      // Get current tab URL
      const tab = await MessagingService.getActiveTab();
      if (!tab?.url) {
        setError('No active tab found');
        return;
      }

      // Start analysis
      startAnalysis(tab.url);

      // Request analysis from content script
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
    <div className="w-[400px] min-h-[500px] bg-gradient-to-br from-blue-500 to-purple-600 p-4">
      <div className="bg-white rounded-lg shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-4 text-white">
          <h1 className="text-xl font-bold mb-1">
            🛡️ Shop Sentinel
          </h1>
          <p className="text-xs opacity-90">
            AI-Powered Shopping Safety
          </p>
        </div>

        <div className="p-4">
          {/* Error Display */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-800">❌ {error}</p>
            </div>
          )}

          {/* Analysis Button */}
          {!analysisResult && (
            <button
              onClick={handleAnalyze}
              disabled={isLoading}
              className="w-full bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white font-bold py-3 px-4 rounded-lg transition duration-200 shadow-md"
            >
              {isLoading ? '� Analyzing...' : '🔍 Analyze This Page'}
            </button>
          )}

          {/* Analysis Results */}
          {analysisResult && (
            <>
              {/* Tab Navigation */}
              <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setActiveTab('overview')}
                  className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition ${
                    activeTab === 'overview'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Overview
                </button>
                <button
                  onClick={() => setActiveTab('reasons')}
                  className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition ${
                    activeTab === 'reasons'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Issues ({analysisResult.allSignals.length})
                </button>
                <button
                  onClick={() => setActiveTab('policies')}
                  className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition ${
                    activeTab === 'policies'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Policies
                </button>
              </div>

              {/* Tab Content */}
              <div className="max-h-[400px] overflow-y-auto">
                {activeTab === 'overview' && (
                  <div className="space-y-4">
                    {/* Risk Meter */}
                    <div className="flex justify-center py-4">
                      <RiskMeter
                        score={analysisResult.totalRiskScore}
                        level={analysisResult.riskLevel}
                        size="large"
                      />
                    </div>

                    {/* Quick Stats */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-gray-50 rounded-lg p-3">
                        <div className="text-xs text-gray-600 mb-1">HTTPS</div>
                        <div className="font-semibold">
                          {analysisResult.security.isHttps ? '✅ Secure' : '❌ Not Secure'}
                        </div>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3">
                        <div className="text-xs text-gray-600 mb-1">Issues</div>
                        <div className="font-semibold">
                          {analysisResult.allSignals.length} found
                        </div>
                      </div>
                    </div>

                    {/* Top Issues Preview */}
                    {analysisResult.allSignals.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-gray-800 mb-2">
                          Top Issues
                        </h3>
                        <ReasonsList
                          signals={analysisResult.allSignals}
                          maxItems={3}
                          showCategory={false}
                        />
                      </div>
                    )}

                    {/* Policies Preview */}
                    <div>
                      <h3 className="text-sm font-semibold text-gray-800 mb-2">
                        Policies
                      </h3>
                      <PolicySummary
                        policies={analysisResult.policies}
                        compact={true}
                      />
                    </div>

                    {/* Re-analyze Button */}
                    <button
                      onClick={handleAnalyze}
                      disabled={isLoading}
                      className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2 px-4 rounded-lg transition duration-200"
                    >
                      🔄 Re-analyze
                    </button>
                  </div>
                )}

                {activeTab === 'reasons' && (
                  <div>
                    <ReasonsList
                      signals={analysisResult.allSignals}
                      showCategory={true}
                    />
                  </div>
                )}

                {activeTab === 'policies' && (
                  <div>
                    <PolicySummary
                      policies={analysisResult.policies}
                      compact={false}
                    />
                  </div>
                )}
              </div>

              {/* URL Footer */}
              {currentUrl && (
                <div className="mt-4 pt-3 border-t text-xs text-gray-500 break-all">
                  {new URL(currentUrl).hostname}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
