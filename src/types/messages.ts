export type MessageAction =
  | 'PING'
  | 'ANALYZE_PAGE'
  | 'GET_PAGE_INFO'
  | 'GET_POLICIES'
  | 'HIGHLIGHT_ELEMENTS'
  | 'CLEAR_HIGHLIGHTS'
  | 'UPDATE_ICON'
  | 'VALIDATE_SOCIAL_URLS'
  | 'GET_VALIDATION_STATS'
  | 'CLEAR_VALIDATION_CACHE';

export interface BaseMessage {
  action: MessageAction;
  timestamp?: number;
}

export interface MessageRequest<T = any> extends BaseMessage {
  payload?: T;
}

export interface MessageResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

export interface AnalyzePagePayload {
  url: string;
  includeAI?: boolean;
  deepScan?: boolean;
}

export interface GetPoliciesPayload {
  policyType: 'returns' | 'shipping' | 'refund' | 'terms' | 'all';
  translate?: boolean;
  summarize?: boolean;
}

export interface HighlightElementsPayload {
  elements: Array<{
    selector: string;
    reason: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }>;
}

export interface UpdateIconPayload {
  riskLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical';
  badgeText?: string;
}

export interface ValidateSocialUrlsPayload {
  urls: Array<{
    platform: string;
    url: string;
    location: 'footer' | 'header' | 'body' | 'unknown';
  }>;
}

export function createMessage<T = any>(
  action: MessageAction,
  payload?: T
): MessageRequest<T> {
  return {
    action,
    payload,
    timestamp: Date.now(),
  };
}

export function createSuccessResponse<T = any>(data?: T): MessageResponse<T> {
  return {
    success: true,
    data,
    timestamp: Date.now(),
  };
}

export function createErrorResponse(error: string): MessageResponse<never> {
  return {
    success: false,
    error,
    timestamp: Date.now(),
  };
}

export function isMessageRequest(obj: any): obj is MessageRequest {
  return (
    obj &&
    typeof obj === 'object' &&
    'action' in obj &&
    typeof obj.action === 'string'
  );
}

export function isMessageResponse(obj: any): obj is MessageResponse {
  return (
    obj &&
    typeof obj === 'object' &&
    'success' in obj &&
    typeof obj.success === 'boolean'
  );
}
