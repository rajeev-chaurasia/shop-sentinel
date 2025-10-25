export enum ErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR',
  AI_UNAVAILABLE = 'AI_UNAVAILABLE',
  ANALYSIS_TIMEOUT = 'ANALYSIS_TIMEOUT',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  INVALID_URL = 'INVALID_URL',
  ANALYSIS_IN_PROGRESS = 'ANALYSIS_IN_PROGRESS',
  CONTENT_SCRIPT_ERROR = 'CONTENT_SCRIPT_ERROR',
  STORAGE_ERROR = 'STORAGE_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export interface UserFriendlyError {
  type: ErrorType;
  title: string;
  message: string;
  suggestion?: string;
  icon: string;
  severity: 'low' | 'medium' | 'high';
}

export class AppError extends Error {
  public readonly type: ErrorType;
  public readonly userMessage: UserFriendlyError;
  public readonly originalError?: Error;

  constructor(type: ErrorType, originalError?: Error) {
    const userMessage = getUserFriendlyError(type);
    super(userMessage.message);

    this.type = type;
    this.userMessage = userMessage;
    this.originalError = originalError;
    this.name = 'AppError';
  }
}

export function getUserFriendlyError(type: ErrorType): UserFriendlyError {
  const errors: Record<ErrorType, UserFriendlyError> = {
    [ErrorType.NETWORK_ERROR]: {
      type: ErrorType.NETWORK_ERROR,
      title: 'Connection Problem',
      message: 'Unable to connect to the website. Please check your internet connection and try again.',
      suggestion: 'Make sure you\'re online and the website is accessible.',
      icon: '🌐',
      severity: 'medium',
    },
    [ErrorType.AI_UNAVAILABLE]: {
      type: ErrorType.AI_UNAVAILABLE,
      title: 'AI Analysis Unavailable',
      message: 'Advanced AI analysis is not available right now. Basic security checks will still work.',
      suggestion: 'Try again later or continue with basic analysis.',
      icon: '🤖',
      severity: 'low',
    },
    [ErrorType.ANALYSIS_TIMEOUT]: {
      type: ErrorType.ANALYSIS_TIMEOUT,
      title: 'Analysis Taking Too Long',
      message: 'The analysis is taking longer than expected. You can try again or check back later.',
      suggestion: 'Try refreshing the page or analyzing a different site.',
      icon: '⏱️',
      severity: 'medium',
    },
    [ErrorType.PERMISSION_DENIED]: {
      type: ErrorType.PERMISSION_DENIED,
      title: 'Permission Required',
      message: 'Shop Sentinel needs permission to analyze this website.',
      suggestion: 'Please refresh the page and allow the extension when prompted.',
      icon: '🔒',
      severity: 'high',
    },
    [ErrorType.INVALID_URL]: {
      type: ErrorType.INVALID_URL,
      title: 'Invalid Website',
      message: 'This doesn\'t appear to be a valid website that can be analyzed.',
      suggestion: 'Try analyzing a different website or check the URL.',
      icon: '❓',
      severity: 'medium',
    },
    [ErrorType.ANALYSIS_IN_PROGRESS]: {
      type: ErrorType.ANALYSIS_IN_PROGRESS,
      title: 'Analysis in Progress',
      message: 'An analysis is already running. Please wait for it to complete.',
      suggestion: 'Check back in a few seconds or try again later.',
      icon: '⏳',
      severity: 'low',
    },
    [ErrorType.CONTENT_SCRIPT_ERROR]: {
      type: ErrorType.CONTENT_SCRIPT_ERROR,
      title: 'Analysis Error',
      message: 'Something went wrong while analyzing the website.',
      suggestion: 'Try refreshing the page and analyzing again.',
      icon: '⚠️',
      severity: 'medium',
    },
    [ErrorType.STORAGE_ERROR]: {
      type: ErrorType.STORAGE_ERROR,
      title: 'Storage Error',
      message: 'Unable to save or load analysis results.',
      suggestion: 'Try clearing your browser data or restarting Chrome.',
      icon: '💾',
      severity: 'medium',
    },
    [ErrorType.UNKNOWN_ERROR]: {
      type: ErrorType.UNKNOWN_ERROR,
      title: 'Something Went Wrong',
      message: 'We encountered an unexpected issue while analyzing this website. This might be due to a temporary problem.',
      suggestion: 'Try refreshing the page and analyzing again. If the problem continues, try a different website.',
      icon: '🔧',
      severity: 'medium',
    },
  };

  return errors[type] || errors[ErrorType.UNKNOWN_ERROR];
}

export function createErrorFromMessage(error: any): AppError {
  // Handle string errors
  const errorMessage = typeof error === 'string' ? error : error?.message || error?.toString() || 'Unknown error';

  // Handle known error patterns with more specific matching
  if (errorMessage.includes('Extension context invalidated') || errorMessage.includes('context invalidated')) {
    return new AppError(ErrorType.PERMISSION_DENIED, error);
  }

  if (errorMessage.includes('timeout') || errorMessage.includes('TimeoutError') || errorMessage.includes('timed out')) {
    return new AppError(ErrorType.ANALYSIS_TIMEOUT, error);
  }

  if (errorMessage.includes('network') || errorMessage.includes('fetch') || errorMessage.includes('connection') || errorMessage.includes('Failed to fetch')) {
    return new AppError(ErrorType.NETWORK_ERROR, error);
  }

  if (errorMessage.includes('AI') || errorMessage.includes('LanguageModel') || errorMessage.includes('model not available')) {
    return new AppError(ErrorType.AI_UNAVAILABLE, error);
  }

  if (errorMessage.includes('analysis') && (errorMessage.includes('progress') || errorMessage.includes('already running'))) {
    return new AppError(ErrorType.ANALYSIS_IN_PROGRESS, error);
  }

  if (errorMessage.includes('storage') || errorMessage.includes('chrome.storage') || errorMessage.includes('localStorage')) {
    return new AppError(ErrorType.STORAGE_ERROR, error);
  }

  if (errorMessage.includes('content script') || errorMessage.includes('script injection') || errorMessage.includes('cannot access')) {
    return new AppError(ErrorType.CONTENT_SCRIPT_ERROR, error);
  }

  if (errorMessage.includes('invalid') && errorMessage.includes('url')) {
    return new AppError(ErrorType.INVALID_URL, error);
  }

  // Default to unknown error with improved message
  return new AppError(ErrorType.UNKNOWN_ERROR, error);
}