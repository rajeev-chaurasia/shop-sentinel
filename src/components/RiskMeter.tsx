import { RiskSeverity, getRiskColor } from '../types';

interface RiskMeterProps {
  score: number;
  level: RiskSeverity;
  size?: 'small' | 'medium' | 'large';
  showLabel?: boolean;
  className?: string;
}

export function RiskMeter({ 
  score, 
  level, 
  size = 'medium', 
  showLabel = true,
  className = '' 
}: RiskMeterProps) {
  const sizeClasses = {
    small: 'w-16 h-16',
    medium: 'w-24 h-24',
    large: 'w-32 h-32',
  };

  const textSizeClasses = {
    small: 'text-lg',
    medium: 'text-2xl',
    large: 'text-4xl',
  };

  const labelSizeClasses = {
    small: 'text-xs',
    medium: 'text-sm',
    large: 'text-base',
  };

  const color = getRiskColor(level);
  const percentage = Math.min(100, Math.max(0, score));
  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  const levelEmoji = {
    safe: '✅',
    low: '⚠️',
    medium: '⚠️',
    high: '🚨',
    critical: '🔴',
  };

  const levelText = {
    safe: 'Safe',
    low: 'Low Risk',
    medium: 'Medium Risk',
    high: 'High Risk',
    critical: 'Critical',
  };

  return (
    <div className={`flex flex-col items-center ${className}`}>
      <div className={`relative ${sizeClasses[size]}`}>
        {/* Background circle */}
        <svg className="transform -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="45"
            stroke="#e5e7eb"
            strokeWidth="8"
            fill="none"
          />
          {/* Progress circle */}
          <circle
            cx="50"
            cy="50"
            r="45"
            stroke={color}
            strokeWidth="8"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.5s ease-in-out' }}
          />
        </svg>
        
        {/* Score text */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`font-bold ${textSizeClasses[size]}`} style={{ color }}>
            {score}
          </span>
        </div>
      </div>

      {/* Label */}
      {showLabel && (
        <div className="mt-2 text-center">
          <div className={`font-semibold ${labelSizeClasses[size]}`}>
            {levelEmoji[level]} {levelText[level]}
          </div>
          <div className={`text-gray-500 ${labelSizeClasses[size]}`}>
            Risk Score
          </div>
        </div>
      )}
    </div>
  );
}
