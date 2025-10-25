import { PolicyAnalysis, PolicySummary as PolicySummaryType } from '../types';

interface PolicySummaryProps {
  policies: PolicyAnalysis;
  aiSummaries?: Record<string, PolicySummaryType>;
  compact?: boolean;
  className?: string;
}

export function PolicySummary({ 
  policies, 
  aiSummaries,
  compact = false,
  className = '' 
}: PolicySummaryProps) {
  const policyTypes = [
    { key: 'returns', label: 'Return Policy', icon: '↩️', urlKey: 'returns' as const },
    { key: 'shipping', label: 'Shipping Policy', icon: '📦', urlKey: 'shipping' as const },
    { key: 'refund', label: 'Refund Policy', icon: '💰', urlKey: 'refund' as const },
    { key: 'terms', label: 'Terms of Service', icon: '📋', urlKey: 'terms' as const },
    { key: 'privacy', label: 'Privacy Policy', icon: '🔒', urlKey: 'privacy' as const },
  ];

  const hasPolicy = (key: string) => {
    if (key === 'returns') return policies.hasReturnPolicy;
    if (key === 'shipping') return policies.hasShippingPolicy;
    if (key === 'refund') return policies.hasRefundPolicy;
    if (key === 'terms') return policies.hasTermsOfService;
    if (key === 'privacy') return policies.hasPrivacyPolicy;
    return false;
  };

  const availablePolicies = policyTypes.filter(p => hasPolicy(p.key));
  const missingPolicies = policyTypes.filter(p => !hasPolicy(p.key));
  const completionPercentage = (availablePolicies.length / policyTypes.length) * 100;

  if (compact) {
    return (
      <div className={`bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 rounded-xl p-4 border-2 border-blue-300 shadow-md ${className}`}>
        {/* Header with percentage */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 shadow-md flex items-center justify-center">
              <span className="text-xl">📄</span>
            </div>
            <div>
              <div className="text-sm font-extrabold text-gray-900">Policy Coverage</div>
              <div className="text-xs text-gray-600 font-semibold">{availablePolicies.length} of {policyTypes.length} found</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-black text-blue-600">{Math.round(completionPercentage)}%</div>
          </div>
        </div>
        
        {/* Progress bar */}
        <div className="w-full bg-gray-200 rounded-full h-3 mb-3 overflow-hidden shadow-inner">
          <div 
            className="bg-gradient-to-r from-blue-500 via-indigo-600 to-purple-600 h-3 rounded-full transition-all duration-1000 ease-out shadow-sm"
            style={{ width: `${completionPercentage}%` }}
          />
        </div>

        {/* Policy badges */}
        <div className="flex flex-wrap gap-2">
          {policyTypes.map((policy) => {
            const exists = hasPolicy(policy.key);
            return (
              <div
                key={policy.key}
                className={`
                  text-xs px-3 py-1.5 rounded-lg font-bold
                  flex items-center gap-1.5 
                  transition-all duration-200
                  ${exists
                    ? 'bg-gradient-to-r from-green-100 to-emerald-100 text-green-900 border-2 border-green-400 shadow-sm'
                    : 'bg-gray-100 text-gray-500 border-2 border-gray-300'
                  }
                `}
              >
                <span className="text-base">{policy.icon}</span>
                <span>{exists ? '✓' : '✗'}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Available Policies */}
      {availablePolicies.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center shadow-md">
              <span className="text-xl">✅</span>
            </div>
            <h3 className="text-base font-black text-gray-900">
              Available Policies ({availablePolicies.length})
            </h3>
          </div>
          <div className="space-y-3">
            {availablePolicies.map((policy, index) => {
              const url = policies.policyUrls[policy.urlKey];
              const summary = aiSummaries?.[policy.key];
              
              return (
                <div 
                  key={policy.key} 
                  className="
                    bg-gradient-to-br from-green-50 via-emerald-50 to-green-100
                    border-2 border-green-400 rounded-xl p-4
                    transform transition-all duration-200
                    hover:scale-[1.02] hover:shadow-lg
                    animate-fadeIn
                  "
                  style={{ animationDelay: `${index * 100}ms` }}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-3 flex-1">
                      <div className="w-11 h-11 rounded-lg bg-white shadow-md flex items-center justify-center flex-shrink-0">
                        <span className="text-2xl">{policy.icon}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-black text-green-900 text-base">
                          {policy.label}
                        </div>
                        {url && (
                          <div className="text-xs text-green-700 mt-0.5 font-medium break-words break-all whitespace-normal">
                            {url}
                          </div>
                        )}
                      </div>
                    </div>
                    {url && (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="
                          flex-shrink-0 px-3 py-2
                          bg-gradient-to-r from-green-600 to-emerald-700
                          hover:from-green-700 hover:to-emerald-800
                          text-white text-xs font-extrabold rounded-lg
                          transition-all duration-200
                          shadow-md hover:shadow-lg
                        "
                      >
                        View →
                      </a>
                    )}
                  </div>
                  
                  {/* AI Summary if available; otherwise a human-friendly helper */}
                  <div className="mt-3 pl-13 pt-3 border-t border-green-200">
                    <div className="text-xs text-green-800 space-y-1.5">
                      {summary ? (
                        <>
                          {summary.summary.slice(0, 2).map((point, idx) => (
                            <div key={idx} className="flex gap-2">
                              <span className="text-green-600 flex-shrink-0">•</span>
                              <span className="flex-1">{point}</span>
                            </div>
                          ))}
                          {summary.keyPoints.returnWindow && (
                            <div className="mt-2 px-3 py-1.5 bg-white bg-opacity-60 rounded-lg font-semibold">
                              ⏱️ Window: {summary.keyPoints.returnWindow}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="text-xs leading-relaxed break-any">
                          We found a {policy.label.toLowerCase()} page for this store. Please click “View” to see the exact conditions (who pays shipping, time window, exclusions).
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Missing Policies */}
      {missingPolicies.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-red-400 to-rose-500 flex items-center justify-center shadow-md">
              <span className="text-xl">❌</span>
            </div>
            <h3 className="text-base font-black text-gray-900">
              Missing Policies ({missingPolicies.length})
            </h3>
          </div>
          <div className="space-y-2">
            {missingPolicies.map((policy, index) => (
              <div 
                key={policy.key} 
                className="
                  bg-gradient-to-br from-gray-50 to-gray-100 
                  border-2 border-gray-400 rounded-xl p-3
                  opacity-70
                  animate-fadeIn
                "
                style={{ animationDelay: `${index * 100}ms` }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-white shadow-sm flex items-center justify-center">
                    <span className="text-xl opacity-50">{policy.icon}</span>
                  </div>
                  <span className="text-sm font-bold text-gray-700">{policy.label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
