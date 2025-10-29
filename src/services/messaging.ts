import {
  MessageAction,
  MessageRequest,
  MessageResponse,
  createMessage,
  createSuccessResponse,
  createErrorResponse,
  isMessageResponse,
} from '../types/messages';
import { TIMINGS, RETRY_CONFIG } from '../config/constants';

export class MessagingError extends Error {
  constructor(
    message: string,
    public code: 'TIMEOUT' | 'NO_RECEIVER' | 'INVALID_RESPONSE' | 'TAB_ERROR' | 'UNKNOWN'
  ) {
    super(message);
    this.name = 'MessagingError';
  }
}

async function sendMessageWithTimeout<T>(
  sender: () => Promise<any>,
  timeout: number = TIMINGS.MESSAGE_TIMEOUT
): Promise<MessageResponse<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new MessagingError('Message timeout', 'TIMEOUT'));
    }, timeout);

    sender()
      .then((response) => {
        clearTimeout(timer);
        
        if (!response) {
          reject(new MessagingError('No response received', 'NO_RECEIVER'));
          return;
        }
        
        if (!isMessageResponse(response)) {
          reject(new MessagingError('Invalid response format', 'INVALID_RESPONSE'));
          return;
        }
        
        resolve(response);
      })
      .catch((error) => {
        clearTimeout(timer);
        
        if (error.message?.includes('Could not establish connection')) {
          reject(new MessagingError('No receiver found', 'NO_RECEIVER'));
        } else if (error.message?.includes('tab')) {
          reject(new MessagingError('Tab error', 'TAB_ERROR'));
        } else {
          reject(new MessagingError(error.message || 'Unknown error', 'UNKNOWN'));
        }
      });
  });
}

export const MessagingService = {
  async sendToActiveTab<TPayload = any, TResponse = any>(
    action: MessageAction,
    payload?: TPayload,
    options: { timeout?: number; retries?: number } = {}
  ): Promise<MessageResponse<TResponse>> {
    const { timeout = TIMINGS.MESSAGE_TIMEOUT, retries = RETRY_CONFIG.MAX_RETRIES } = options;
    
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const tab = await this.getActiveTab();
        if (!tab?.id) {
          throw new MessagingError('No active tab found', 'TAB_ERROR');
        }
        
        const message = createMessage(action, payload);
        const response = await sendMessageWithTimeout<TResponse>(
          () => chrome.tabs.sendMessage(tab.id!, message),
          timeout
        );
        
        return response;
      } catch (error) {
        lastError = error as Error;
        
        if (error instanceof MessagingError && error.code === 'TAB_ERROR') {
          throw error;
        }
        
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_CONFIG.getBackoffDelay(attempt)));
        }
      }
    }
    
    throw lastError || new MessagingError('All retries failed', 'UNKNOWN');
  },

  async sendToTab<TPayload = any, TResponse = any>(
    tabId: number,
    action: MessageAction,
    payload?: TPayload,
    options: { timeout?: number } = {}
  ): Promise<MessageResponse<TResponse>> {
    const { timeout = TIMINGS.MESSAGE_TIMEOUT } = options;
    
    try {
      const message = createMessage(action, payload);
      const response = await sendMessageWithTimeout<TResponse>(
        () => chrome.tabs.sendMessage(tabId, message),
        timeout
      );
      
      return response;
    } catch (error) {
      if (error instanceof MessagingError) {
        throw error;
      }
      throw new MessagingError(
        error instanceof Error ? error.message : 'Unknown error',
        'UNKNOWN'
      );
    }
  },

  async sendToBackground<TPayload = any, TResponse = any>(
    action: MessageAction,
    payload?: TPayload,
    options: { timeout?: number } = {}
  ): Promise<MessageResponse<TResponse>> {
    const { timeout = TIMINGS.MESSAGE_TIMEOUT } = options;
    
    try {
      const message = createMessage(action, payload);
      const response = await sendMessageWithTimeout<TResponse>(
        () => chrome.runtime.sendMessage(message),
        timeout
      );
      
      return response;
    } catch (error) {
      if (error instanceof MessagingError) {
        throw error;
      }
      throw new MessagingError(
        error instanceof Error ? error.message : 'Unknown error',
        'UNKNOWN'
      );
    }
  },

  async getActiveTab(): Promise<chrome.tabs.Tab | null> {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab || null;
    } catch (error) {
      console.error('Error getting active tab:', error);
      return null;
    }
  },

  async isTabReady(tabId: number): Promise<boolean> {
    try {
      const response = await this.sendToTab(tabId, 'PING', undefined, { timeout: TIMINGS.PING_TIMEOUT });
      return response.success;
    } catch {
      return false;
    }
  },
};

export function createMessageHandler(
  handlers: Partial<Record<MessageAction, (payload: any, sender: chrome.runtime.MessageSender) => Promise<any> | any>>
) {
  return (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void
  ): boolean => {
    if (!message || typeof message !== 'object' || !('action' in message)) {
      sendResponse(createErrorResponse('Invalid message format'));
      return false;
    }

    const typedMessage = message as MessageRequest;
    const handler = handlers[typedMessage.action];

    if (!handler) {
      sendResponse(createErrorResponse(`No handler for action: ${typedMessage.action}`));
      return false;
    }

    try {
      const result = handler(typedMessage.payload, sender);

      if (result instanceof Promise) {
        result
          .then((data) => {
            try {
              sendResponse(createSuccessResponse(data));
            } catch (responseError) {
              console.error('❌ Error sending success response:', responseError);
            }
          })
          .catch((error) => {
            try {
              console.error('❌ Handler error:', error);
              sendResponse(createErrorResponse(error.message || 'Handler error'));
            } catch (responseError) {
              console.error('❌ Error sending error response:', responseError);
            }
          });
        return true; // Keep channel open for async response
      }

      sendResponse(createSuccessResponse(result));
      return false;
    } catch (error: any) {
      console.error('❌ Synchronous handler error:', error);
      sendResponse(createErrorResponse(error.message || 'Handler execution error'));
      return false;
    }
  };
}
