// Storage service for managing Chrome storage API
export const StorageService = {
  /**
   * Get a value from Chrome storage
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const result = await chrome.storage.local.get(key);
      return result[key] ?? null;
    } catch (error) {
      console.error('Error getting from storage:', error);
      return null;
    }
  },

  /**
   * Set a value in Chrome storage
   */
  async set<T>(key: string, value: T): Promise<boolean> {
    try {
      await chrome.storage.local.set({ [key]: value });
      return true;
    } catch (error) {
      console.error('Error setting in storage:', error);
      return false;
    }
  },

  /**
   * Remove a value from Chrome storage
   */
  async remove(key: string): Promise<boolean> {
    try {
      await chrome.storage.local.remove(key);
      return true;
    } catch (error) {
      console.error('Error removing from storage:', error);
      return false;
    }
  },

  /**
   * Clear all values from Chrome storage
   */
  async clear(): Promise<boolean> {
    try {
      await chrome.storage.local.clear();
      return true;
    } catch (error) {
      console.error('Error clearing storage:', error);
      return false;
    }
  },
};
