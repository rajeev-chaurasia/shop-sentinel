interface AnalysisProgressProps {
  progress: number; // 0-100
  stage: string; // 'metadata', 'heuristics', 'ai_analysis', etc
  isActive?: boolean;
  className?: string;
}

export function AnalysisProgress({
  progress,
  stage,
  isActive = true,
  className = ''
}: AnalysisProgressProps) {
  // Stage information with emojis and descriptions
  const stageInfo: Record<string, { emoji: string; label: string; description: string }> = {
    'metadata': {
      emoji: '📋',
      label: 'Gathering Metadata',
      description: 'Collecting page information and domain data'
    },
    'heuristics': {
      emoji: '🔍',
      label: 'Analyzing Heuristics',
      description: 'Detecting patterns and suspicious elements'
    },
    'ai_analysis': {
      emoji: '🤖',
      label: 'AI Analysis',
      description: 'Running deep learning models'
    },
    'completed': {
      emoji: '✅',
      label: 'Complete',
      description: 'Analysis finished'
    }
  };

  const currentStage = stageInfo[stage] || stageInfo['metadata'];

  // Calculate current stage percentage within the progress
  const getStageProgress = () => {
    // Map stages to percentage ranges
    const stageRanges: Record<string, { min: number; max: number }> = {
      'metadata': { min: 0, max: 33 },
      'heuristics': { min: 33, max: 66 },
      'ai_analysis': { min: 66, max: 99 },
      'completed': { min: 100, max: 100 }
    };

    const range = stageRanges[stage];
    if (!range) return progress;

    // If progress is within this stage's range, use it; otherwise cap at the stage's max
    if (progress >= range.min && progress <= range.max) {
      return progress;
    }
    return range.min;
  };

  const stageProgress = getStageProgress();

  if (!isActive) {
    return null;
  }

  return (
    <div className={`bg-gradient-to-br from-blue-50 via-cyan-50 to-indigo-50 dark:from-slate-700 dark:via-slate-600 dark:to-slate-700 rounded-xl p-4 border-2 border-blue-200 dark:border-slate-500 shadow-lg ${className}`}>
      {/* Header with stage info */}
      <div className="flex items-start gap-3 mb-4">
        {/* Stage emoji */}
        <div className="text-2xl flex-shrink-0 flex items-center justify-center w-8 h-8">
          {currentStage.emoji}
        </div>

        {/* Stage details */}
        <div className="flex-1 min-w-0">
          <div className="font-bold text-gray-800 dark:text-gray-200 text-sm">
            {currentStage.label}
          </div>
          <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
            {currentStage.description}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="relative w-full h-3 bg-gray-200 dark:bg-slate-500 rounded-full overflow-hidden">
        {/* Background track */}
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 dark:from-blue-600 dark:to-cyan-600 transition-all duration-300 ease-out"
          style={{ width: `${Math.min(100, Math.max(0, stageProgress))}%` }}
        />
        {/* Shimmer effect for active animation */}
        {isActive && (
          <div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent opacity-30 animate-pulse"
            style={{ width: `${Math.min(100, Math.max(0, stageProgress))}%` }}
          />
        )}
      </div>

      {/* Progress percentage text */}
      <div className="flex justify-between items-center mt-2">
        <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
          Progress
        </div>
        <div className="text-xs font-bold text-blue-600 dark:text-blue-400">
          {Math.round(stageProgress)}%
        </div>
      </div>

      {/* Stage indicators (optional detailed view) */}
      <div className="mt-3 flex items-center justify-between text-xs px-1">
        {/* Stage dots */}
        <div className="flex gap-2">
          {['metadata', 'heuristics', 'ai_analysis', 'completed'].map((s) => {
            const stageRanges: Record<string, { min: number; max: number }> = {
              'metadata': { min: 0, max: 33 },
              'heuristics': { min: 33, max: 66 },
              'ai_analysis': { min: 66, max: 99 },
              'completed': { min: 100, max: 100 }
            };

            const range = stageRanges[s];
            const isCompleted = progress >= (range?.max || 0);
            const isCurrent = s === stage;

            return (
              <div
                key={s}
                className={`w-2 h-2 rounded-full transition-all ${
                  isCompleted || isCurrent
                    ? 'bg-blue-500 dark:bg-blue-400'
                    : 'bg-gray-300 dark:bg-slate-400'
                }`}
                title={stageInfo[s]?.label || s}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
