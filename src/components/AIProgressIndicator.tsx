import { useAIState } from '../stores';

interface AIProgressIndicatorProps {
  className?: string;
  showDetails?: boolean;
}

export function AIProgressIndicator({ 
  className = '', 
  showDetails = true 
}: AIProgressIndicatorProps) {
  const aiState = useAIState();

  if (!aiState.isAnalyzing && !aiState.isInitializing) {
    return null;
  }

  const getStageInfo = () => {
    switch (aiState.analysisStage) {
      case 'initializing':
        return {
          emoji: '🤖',
          title: 'Initializing AI',
          description: aiState.modelDownloadProgress > 0 
            ? `Downloading model: ${aiState.modelDownloadProgress}%`
            : 'Preparing AI analysis engine...',
          progress: aiState.modelDownloadProgress || 10,
        };
      case 'dark-patterns':
        return {
          emoji: '🎭',
          title: 'Analyzing Dark Patterns',
          description: 'Detecting deceptive practices and UI manipulation',
          progress: 40,
        };
      case 'legitimacy':
        return {
          emoji: '🔍',
          title: 'Verifying Legitimacy',
          description: 'Assessing business credibility and trust signals',
          progress: 70,
        };
      case 'complete':
        return {
          emoji: '✅',
          title: 'Analysis Complete',
          description: `Found ${aiState.signalsFound} AI signals`,
          progress: 100,
        };
      default:
        return {
          emoji: '⚙️',
          title: 'AI Processing',
          description: 'Running advanced analysis...',
          progress: 20,
        };
    }
  };

  const stageInfo = getStageInfo();
  const timeRemaining = aiState.estimatedTimeRemaining;

  return (
    <div className={`bg-gradient-to-br from-purple-50 via-indigo-50 to-blue-50 dark:from-slate-700 dark:via-slate-600 dark:to-slate-700 rounded-xl p-4 border-2 border-purple-200 dark:border-slate-500 shadow-lg ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div className="text-2xl animate-pulse">{stageInfo.emoji}</div>
        <div className="flex-1">
          <div className="font-bold text-gray-800 dark:text-gray-200 text-sm">{stageInfo.title}</div>
          {showDetails && (
            <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{stageInfo.description}</div>
          )}
        </div>
        {timeRemaining && (
          <div className="text-xs text-purple-600 dark:text-purple-400 font-medium">
            ~{timeRemaining}s
          </div>
        )}
      </div>

      {/* Progress Bar */}
      <div className="relative">
        <div className="w-full bg-white dark:bg-gray-700 bg-opacity-60 rounded-full h-2 shadow-inner">
          <div 
            className="bg-gradient-to-r from-purple-500 to-indigo-500 h-2 rounded-full transition-all duration-500 ease-out shadow-sm"
            style={{ width: `${stageInfo.progress}%` }}
          />
        </div>
        
        {/* Animated glow effect */}
        <div 
          className="absolute top-0 h-2 bg-gradient-to-r from-purple-400 to-indigo-400 rounded-full opacity-50 blur-sm transition-all duration-500 ease-out"
          style={{ width: `${stageInfo.progress}%` }}
        />
      </div>

      {/* Stage Details */}
      {showDetails && aiState.analysisStage !== 'idle' && (
        <div className="flex items-center justify-between mt-3 text-xs">
          <div className="flex items-center gap-4">
            <div className={`flex items-center gap-1 ${aiState.analysisStage === 'initializing' ? 'text-purple-600 dark:text-purple-400 font-medium' : 'text-gray-400 dark:text-gray-500'}`}>
              <span>🤖</span>
              <span>Init</span>
            </div>
            <div className={`flex items-center gap-1 ${aiState.analysisStage === 'dark-patterns' ? 'text-purple-600 dark:text-purple-400 font-medium' : 'text-gray-400 dark:text-gray-500'}`}>
              <span>🎭</span>
              <span>Patterns</span>
            </div>
            <div className={`flex items-center gap-1 ${aiState.analysisStage === 'legitimacy' ? 'text-purple-600 dark:text-purple-400 font-medium' : 'text-gray-400 dark:text-gray-500'}`}>
              <span>🔍</span>
              <span>Trust</span>
            </div>
            <div className={`flex items-center gap-1 ${aiState.analysisStage === 'complete' ? 'text-green-600 dark:text-green-400 font-medium' : 'text-gray-400 dark:text-gray-500'}`}>
              <span>✅</span>
              <span>Done</span>
            </div>
          </div>
          
          {aiState.signalsFound > 0 && (
            <div className="text-orange-600 dark:text-orange-400 font-medium">
              {aiState.signalsFound} signals found
            </div>
          )}
        </div>
      )}

      {/* Error State */}
      {aiState.lastError && (
        <div className="mt-3 p-2 bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded-lg">
          <div className="flex items-center gap-2 text-red-800 dark:text-red-200 text-xs">
            <span>❌</span>
            <span className="font-medium">AI Error:</span>
            <span>{aiState.lastError}</span>
          </div>
        </div>
      )}
    </div>
  );
}
