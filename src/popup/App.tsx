import { useEffect } from 'react';
import { useAnalysisStore } from '../stores';
import { MessagingService } from '../services/messaging';
import type { AnalysisResult } from '../types';

function App() {
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
   * Get current page info
   */
  const handleGetPageInfo = async () => {
    try {
      const response = await MessagingService.sendToActiveTab('GET_PAGE_INFO');
      
      if (response.success) {
        alert(`Page Info:\n${JSON.stringify(response.data, null, 2)}`);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to get page info');
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
    <div className="w-[400px] min-h-[500px] bg-gradient-to-br from-blue-500 to-purple-600 p-6">
      <div className="bg-white rounded-lg shadow-xl p-6">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">
          🛡️ Shop Sentinel
        </h1>
        <p className="text-sm text-gray-600 mb-6">
          AI-Powered Shopping Safety
        </p>

        {/* Error Display */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-800">❌ {error}</p>
          </div>
        )}

        {/* Test Controls */}
        <div className="space-y-3 mb-6">
          <button
            onClick={handleGetPageInfo}
            className="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium py-2 px-4 rounded transition duration-200"
          >
            📄 Get Page Info
          </button>

          <button
            onClick={handleAnalyze}
            disabled={isLoading}
            className="w-full bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white font-bold py-3 px-4 rounded transition duration-200"
          >
            {isLoading ? '🔄 Analyzing...' : '🔍 Analyze This Page'}
          </button>
        </div>

        {/* Analysis Results */}
        {analysisResult && (
          <div className="border-t pt-4">
            <h2 className="font-semibold text-gray-800 mb-3">Analysis Results</h2>
            
            {/* Risk Score */}
            <div className="bg-gray-50 rounded-lg p-4 mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">Risk Score</span>
                <span className={`text-2xl font-bold ${
                  analysisResult.totalRiskScore > 50 ? 'text-red-600' : 'text-green-600'
                }`}>
                  {analysisResult.totalRiskScore}/100
                </span>
              </div>
              <div className="text-xs text-gray-500 capitalize">
                Level: {analysisResult.riskLevel}
              </div>
            </div>

            {/* Current URL */}
            {currentUrl && (
              <div className="text-xs text-gray-500 break-all">
                <strong>URL:</strong> {currentUrl}
              </div>
            )}

            {/* Security Info */}
            <div className="mt-3 text-sm">
              <div className="flex items-center gap-2">
                {analysisResult.security.isHttps ? '✅' : '❌'}
                <span>HTTPS: {analysisResult.security.isHttps ? 'Enabled' : 'Not Secure'}</span>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 pt-4 border-t text-center">
          <p className="text-xs text-gray-400">
            TG-01: Architecture Complete ✅
          </p>
        </div>
      </div>
    </div>
  );
}

export default App;
