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

  if (compact) {
    return (
      <div className={`space-y-2 ${className}`}>
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-gray-700">Policies Found</span>
          <span className="font-bold text-gray-900">
            {availablePolicies.length}/{policyTypes.length}
          </span>
        </div>
        
        <div className="flex flex-wrap gap-1">
          {policyTypes.map((policy) => {
            const exists = hasPolicy(policy.key);
            return (
              <span
                key={policy.key}
                className={`text-xs px-2 py-1 rounded ${
                  exists
                    ? 'bg-green-100 text-green-800'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                {policy.icon} {exists ? '✓' : '✗'}
              </span>
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
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-800 mb-2">
            ✅ Available Policies ({availablePolicies.length})
          </h3>
          <div className="space-y-2">
            {availablePolicies.map((policy) => {
              const url = policies.policyUrls[policy.urlKey];
              const summary = aiSummaries?.[policy.key];
              
              return (
                <div key={policy.key} className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{policy.icon}</span>
                      <span className="font-medium text-green-900 text-sm">
                        {policy.label}
                      </span>
                    </div>
                    {url && (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-green-700 hover:underline"
                      >
                        View →
                      </a>
                    )}
                  </div>
                  
                  {/* AI Summary if available */}
                  {summary && (
                    <div className="mt-2 pl-7">
                      <div className="text-xs text-green-800 space-y-1">
                        {summary.summary.slice(0, 2).map((point, idx) => (
                          <div key={idx}>• {point}</div>
                        ))}
                        {summary.keyPoints.returnWindow && (
                          <div className="mt-1 font-semibold">
                            Window: {summary.keyPoints.returnWindow}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Missing Policies */}
      {missingPolicies.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-800 mb-2">
            ❌ Missing Policies ({missingPolicies.length})
          </h3>
          <div className="space-y-2">
            {missingPolicies.map((policy) => (
              <div key={policy.key} className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg opacity-50">{policy.icon}</span>
                  <span className="text-sm text-gray-600">{policy.label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
