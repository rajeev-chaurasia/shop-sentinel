import { RiskSignal } from '../types';

interface ReasonsListProps {
  signals: RiskSignal[];
  maxItems?: number;
  showCategory?: boolean;
  compact?: boolean;
  className?: string;
}

export function ReasonsList({ 
  signals, 
  maxItems, 
  showCategory = true,
  compact = false,
  className = '' 
}: ReasonsListProps) {
  const displaySignals = maxItems ? signals.slice(0, maxItems) : signals;
  const hasMore = maxItems && signals.length > maxItems;

  // Sort by severity and score
  const sortedSignals = [...displaySignals].sort((a, b) => {
    const severityOrder = { critical: 5, high: 4, medium: 3, low: 2, safe: 1 };
    const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
    if (severityDiff !== 0) return severityDiff;
    return b.score - a.score;
  });

  const severityStyles = {
    safe: {
      bg: 'bg-gradient-to-br from-green-50 via-green-100 to-emerald-100',
      border: 'border-green-400',
      text: 'text-green-900',
      badge: 'bg-green-300 text-green-900',
      icon: '✅',
    },
    low: {
      bg: 'bg-gradient-to-br from-yellow-50 via-yellow-100 to-amber-100',
      border: 'border-yellow-400',
      text: 'text-yellow-900',
      badge: 'bg-yellow-300 text-yellow-900',
      icon: '⚠️',
    },
    medium: {
      bg: 'bg-gradient-to-br from-orange-50 via-orange-100 to-orange-200',
      border: 'border-orange-400',
      text: 'text-orange-900',
      badge: 'bg-orange-300 text-orange-900',
      icon: '�',
    },
    high: {
      bg: 'bg-gradient-to-br from-red-50 via-red-100 to-red-200',
      border: 'border-red-400',
      text: 'text-red-900',
      badge: 'bg-red-300 text-red-900',
      icon: '🚨',
    },
    critical: {
      bg: 'bg-gradient-to-br from-red-100 via-red-200 to-red-300',
      border: 'border-red-500',
      text: 'text-red-950',
      badge: 'bg-red-400 text-red-950',
      icon: '🔴',
    },
  };

  const categoryIcons = {
    security: '🔒',
    legitimacy: '✓',
    'dark-pattern': '🎭',
    policy: '📄',
  };

  const categoryLabels = {
    security: 'Security',
    legitimacy: 'Legitimacy',
    'dark-pattern': 'Dark Pattern',
    policy: 'Policy',
  };

  if (signals.length === 0) {
    return (
      <div className={`text-center py-12 ${className}`}>
        <div className="text-6xl mb-3 animate-bounce">✅</div>
        <p className="text-lg font-semibold text-gray-800 mb-1">All Clear!</p>
        <p className="text-sm text-gray-600">No security issues detected</p>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className={compact ? 'space-y-2' : 'space-y-3'}>
        {sortedSignals.map((signal, index) => {
          const styles = severityStyles[signal.severity];
          
          return (
            <div
              key={signal.id}
              className={`
                ${styles.bg} ${styles.border} ${styles.text}
                border-2 rounded-xl p-4 
                transform transition-all duration-200
                hover:scale-[1.02] hover:shadow-lg
                animate-fadeIn
              `}
              style={{
                animationDelay: `${index * 50}ms`,
              }}
            >
              {/* Header Row */}
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-xl flex-shrink-0">{styles.icon}</span>
                  {showCategory && (
                    <span 
                      className={`
                        text-xs font-semibold px-2 py-1 rounded-md 
                        ${styles.badge}
                        flex items-center gap-1
                      `}
                    >
                      <span>{categoryIcons[signal.category]}</span>
                      <span className="hidden sm:inline">{categoryLabels[signal.category]}</span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs font-bold px-2 py-1 bg-white bg-opacity-60 rounded-md shadow-sm">
                    +{signal.score}
                  </span>
                </div>
              </div>

              {/* Reason */}
              <p className={`font-semibold ${compact ? 'text-sm' : 'text-base'} mb-1 leading-snug break-any`}>
                {signal.reason}
              </p>

              {/* Details */}
              {signal.details && !compact && (
                <p className="text-xs opacity-80 leading-relaxed mt-2 pl-7 break-any truncate-2">
                  {signal.details}
                </p>
              )}

              {/* Source badge */}
              <div className="flex items-center gap-2 mt-3">
                <span className="text-xs px-2.5 py-1 rounded-full bg-white bg-opacity-70 font-medium shadow-sm">
                  {signal.source === 'ai' ? '🤖 AI Detection' : '🔍 Heuristic Analysis'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Show more indicator */}
      {hasMore && (
        <div className="mt-4 text-center">
          <div className="inline-block px-4 py-2 bg-gray-100 rounded-full border border-gray-300 shadow-sm">
            <p className="text-sm font-medium text-gray-700">
              +{signals.length - maxItems!} more issue{signals.length - maxItems! > 1 ? 's' : ''}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
