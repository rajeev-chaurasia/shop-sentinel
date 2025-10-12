/**
 * Background Service Worker for Shop Sentinel (TG-08)
 * Handles extension lifecycle, icon/badge updates, and tab monitoring
 */

console.log('🛡️ Shop Sentinel background service worker initialized');

// Types for tab state management
interface TabState {
  riskLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical';
  badgeText: string;
  url: string;
  timestamp: number;
}

// In-memory storage for tab states (persists during session)
const tabStates = new Map<number, TabState>();

// Extension lifecycle events
chrome.runtime.onInstalled.addListener((details) => {
  console.log('📦 Extension installed/updated:', details.reason);
  
  if (details.reason === 'install') {
    console.log('🎉 First install - initializing default settings');
  } else if (details.reason === 'update') {
    console.log('🔄 Extension updated to version:', chrome.runtime.getManifest().version);
  }
});

chrome.runtime.onStartup.addListener(() => {
  console.log('🚀 Browser started - Shop Sentinel ready');
});

/**
 * Update extension icon badge for a specific tab
 */
async function updateIconForTab(tabId: number, riskLevel: string, badgeText: string, url: string) {
  try {
    // Determine badge color based on risk level
    let badgeColor: [number, number, number, number];
    
    switch (riskLevel) {
      case 'safe':
        badgeColor = [16, 185, 129, 255]; // green-500
        break;
      case 'low':
        badgeColor = [132, 204, 22, 255]; // lime-500
        break;
      case 'medium':
        badgeColor = [245, 158, 11, 255]; // amber-500
        break;
      case 'high':
        badgeColor = [249, 115, 22, 255]; // orange-500
        break;
      case 'critical':
        badgeColor = [239, 68, 68, 255]; // red-500
        break;
      default:
        badgeColor = [156, 163, 175, 255]; // gray-400
    }
    
    // Set badge text and color for this specific tab
    await chrome.action.setBadgeText({ text: badgeText, tabId });
    await chrome.action.setBadgeBackgroundColor({ color: badgeColor, tabId });
    
    // Store tab state
    tabStates.set(tabId, {
      riskLevel: riskLevel as any,
      badgeText,
      url,
      timestamp: Date.now(),
    });
    
    console.log(`✅ Icon updated for tab ${tabId}: ${riskLevel} (${badgeText})`);
  } catch (error) {
    console.error(`❌ Failed to update icon for tab ${tabId}:`, error);
  }
}

/**
 * Clear badge for a specific tab
 */
async function clearIconForTab(tabId: number) {
  try {
    await chrome.action.setBadgeText({ text: '', tabId });
    tabStates.delete(tabId);
    console.log(`🧹 Badge cleared for tab ${tabId}`);
  } catch (error) {
    console.error(`❌ Failed to clear badge for tab ${tabId}:`, error);
  }
}

/**
 * Get stored tab state
 */
function getTabState(tabId: number): TabState | null {
  return tabStates.get(tabId) || null;
}

/**
 * Handle messages from content scripts and popup
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action, payload } = message;
  
  // Get tab ID from sender (for content script messages)
  const tabId = sender.tab?.id;
  
  console.log(`📨 Message received: ${action}`, { tabId, payload });
  
  switch (action) {
    case 'PING':
      sendResponse({ success: true, data: { status: 'background worker ready' } });
      return false; // Synchronous response
      
    case 'UPDATE_ICON':
      if (tabId) {
        const { riskLevel, badgeText } = payload;
        const url = sender.tab?.url || '';
        updateIconForTab(tabId, riskLevel, badgeText, url)
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep channel open for async response
      } else {
        sendResponse({ success: false, error: 'No tab ID available' });
      }
      break;
      
    case 'CLEAR_ICON':
      if (tabId) {
        clearIconForTab(tabId)
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
      } else {
        sendResponse({ success: false, error: 'No tab ID available' });
      }
      break;
      
    case 'GET_TAB_STATE':
      if (tabId) {
        const state = getTabState(tabId);
        sendResponse({ success: true, data: state });
      } else {
        sendResponse({ success: false, error: 'No tab ID available' });
      }
      return false; // Synchronous response
      
    case 'GET_ALL_TAB_STATES':
      const allStates = Object.fromEntries(tabStates);
      sendResponse({ success: true, data: allStates });
      return false; // Synchronous response
      
    case 'SET_TAB_STATE':
      if (tabId && payload) {
        const { riskLevel, badgeText, url } = payload;
        updateIconForTab(tabId, riskLevel, badgeText, url)
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
      } else {
        sendResponse({ success: false, error: 'Invalid payload or tab ID' });
      }
      break;
      
    case 'CLEAR_TAB_STATE':
      if (tabId) {
        clearIconForTab(tabId)
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
      } else {
        sendResponse({ success: false, error: 'No tab ID available' });
      }
      break;
      
    default:
      console.warn(`⚠️ Unknown action: ${action}`);
      sendResponse({ success: false, error: `Unknown action: ${action}` });
      return false; // Synchronous response
  }
});

/**
 * Tab listeners - Monitor tab changes and navigation
 */

// When tab is activated (switched to), restore its badge
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tabId = activeInfo.tabId;
  const state = getTabState(tabId);
  
  if (state) {
    console.log(`🔄 Tab ${tabId} activated - restoring badge:`, state.riskLevel);
    await updateIconForTab(tabId, state.riskLevel, state.badgeText, state.url);
  }
});

// When tab URL changes (navigation), clear the badge
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, _tab) => {
  // Only act on navigation (URL changed and page started loading)
  if (changeInfo.status === 'loading' && changeInfo.url) {
    const storedState = getTabState(tabId);
    
    // If URL changed, clear the old badge
    if (storedState && storedState.url !== changeInfo.url) {
      console.log(`🔄 Tab ${tabId} navigated to new URL - clearing badge`);
      await clearIconForTab(tabId);
    }
  }
});

// When tab is closed, clean up its state
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabStates.has(tabId)) {
    console.log(`🗑️ Tab ${tabId} closed - removing state`);
    tabStates.delete(tabId);
  }
});

console.log('✅ Background service worker fully initialized');
