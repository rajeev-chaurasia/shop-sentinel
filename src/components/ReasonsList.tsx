import { RiskSignal } from '../types';

interface ReasonsListProps {
  signals: RiskSignal[];
  maxItems?: number;
  showCategory?: boolean;
  className?: string;
}

export function ReasonsList({ 
  signals, 
  maxItems, 
  showCategory = true,
  className = '' 
}: ReasonsListProps) {
  const displaySignals = maxItems ? signals.slice(0, maxItems) : signals;
  const hasMore = maxItems && signals.length > maxItems;

  const severityColors = {
    safe: 'bg-green-100 text-green-800 border-green-200',
    low: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    medium: 'bg-orange-100 text-orange-800 border-orange-200',
    high: 'bg-red-100 text-red-800 border-red-200',
    critical: 'bg-red-200 text-red-900 border-red-300',
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
      <div className={`text-center py-8 ${className}`}>
        <div className="text-4xl mb-2">✅</div>
        <p className="text-gray-600">No issues detected</p>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="space-y-3">
        {displaySignals.map((signal) => (
          <div
            key={signal.id}
            className={`border rounded-lg p-3 ${severityColors[signal.severity]}`}
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-1">
              <div className="flex items-center gap-2">
                {showCategory && (
                  <span className="text-xs font-medium opacity-75">
                    {categoryIcons[signal.category]} {categoryLabels[signal.category]}
                  </span>
                )}
              </div>
              <span className="text-xs font-bold">
                +{signal.score}
              </span>
            </div>

            {/* Reason */}
            <p className="font-semibold text-sm mb-1">{signal.reason}</p>

            {/* Details */}
            {signal.details && (
              <p className="text-xs opacity-80">{signal.details}</p>
            )}

            {/* Source badge */}
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs px-2 py-0.5 rounded bg-white bg-opacity-50">
                {signal.source === 'ai' ? '🤖 AI' : '🔍 Heuristic'}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Show more indicator */}
      {hasMore && (
        <div className="mt-3 text-center">
          <p className="text-sm text-gray-500">
            +{signals.length - maxItems!} more issue{signals.length - maxItems! > 1 ? 's' : ''}
          </p>
        </div>
      )}
    </div>
  );
}
