import { RiskSeverity, getRiskColor } from '../types';

interface RiskMeterProps {
  score: number;
  level: RiskSeverity;
  size?: 'small' | 'medium' | 'large';
  showLabel?: boolean;
  animated?: boolean;
  className?: string;
}

export function RiskMeter({ 
  score, 
  level, 
  size = 'medium', 
  showLabel = true,
  animated = true,
  className = '' 
}: RiskMeterProps) {
  const sizeClasses = {
    small: 'w-20 h-20',
    medium: 'w-28 h-28',
    large: 'w-40 h-40',
  };

  const textSizeClasses = {
    small: 'text-xl',
    medium: 'text-3xl',
    large: 'text-5xl',
  };

  const labelSizeClasses = {
    small: 'text-xs',
    medium: 'text-sm',
    large: 'text-lg',
  };

  const strokeWidths = {
    small: 6,
    medium: 8,
    large: 10,
  };

  const color = getRiskColor(level);
  const percentage = Math.min(100, Math.max(0, score));
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;
  const strokeWidth = strokeWidths[size];

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

  const bgColors = {
    safe: 'bg-green-50 dark:bg-slate-700',
    low: 'bg-yellow-50 dark:bg-slate-700',
    medium: 'bg-orange-50 dark:bg-slate-700',
    high: 'bg-red-50 dark:bg-slate-700',
    critical: 'bg-red-100 dark:bg-slate-700',
  };

  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      {/* Circular Progress */}
      <div className={`relative ${sizeClasses[size]} flex items-center justify-center`}>
        {/* Background glow effect */}
        <div 
          className={`absolute inset-0 ${bgColors[level]} rounded-full opacity-30 blur-md`}
        />
        
        {/* SVG Circle */}
        <svg 
          className="transform -rotate-90 relative z-10" 
          viewBox="0 0 100 100"
          style={{ filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.1))' }}
        >
          {/* Background circle */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            className="fill-white dark:fill-gray-800"
            stroke="#e5e7eb"
            strokeWidth={strokeWidth}
          />
          {/* Progress circle */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={animated ? strokeDashoffset : 0}
            strokeLinecap="round"
            style={{ 
              transition: animated ? 'stroke-dashoffset 1.5s cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
            }}
          />
        </svg>
        
        {/* Score text overlay */}
        <div className="absolute inset-0 flex flex-col items-center justify-center z-20">
          <span 
            className={`font-extrabold ${textSizeClasses[size]} leading-none`} 
            style={{ color }}
          >
            {score}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-semibold">/ 100</span>
        </div>
      </div>

      {/* Label */}
      {showLabel && (
        <div className="mt-4 text-center space-y-1">
          <div 
            className={`font-extrabold ${labelSizeClasses[size]} flex items-center justify-center gap-2`}
            style={{ color }}
          >
            <span className="text-2xl">{levelEmoji[level]}</span>
            <span>{levelText[level]}</span>
          </div>
          <div className={`text-gray-500 dark:text-gray-400 ${labelSizeClasses[size]} font-semibold uppercase tracking-wide`}>
            Risk Assessment
          </div>
        </div>
      )}
    </div>
  );
}
