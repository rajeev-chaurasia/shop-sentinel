// Messaging service for communication between extension components
export const MessagingService = {
  /**
   * Send a message to the content script
   */
  async sendToContentScript<T>(tabId: number, message: any): Promise<T | null> {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message);
      return response;
    } catch (error) {
      console.error('Error sending message to content script:', error);
      return null;
    }
  },

  /**
   * Send a message to the background script
   */
  async sendToBackground<T>(message: any): Promise<T | null> {
    try {
      const response = await chrome.runtime.sendMessage(message);
      return response;
    } catch (error) {
      console.error('Error sending message to background:', error);
      return null;
    }
  },

  /**
   * Get the current active tab
   */
  async getActiveTab(): Promise<chrome.tabs.Tab | null> {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab || null;
    } catch (error) {
      console.error('Error getting active tab:', error);
      return null;
    }
  },
};
