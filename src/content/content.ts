// Content script for Apex Radar
console.log('Apex Radar content script loaded');

// Example: Listen for messages from the popup or background script
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  console.log('Message received in content script:', request);
  
  if (request.action === 'getPageInfo') {
    sendResponse({
      title: document.title,
      url: window.location.href,
    });
  }
  
  return true;
});

// Example: Add functionality to interact with the page
function initializeContentScript() {
  console.log('Initializing Apex Radar content script on:', window.location.href);
  
  // Add your content script logic here
  // For example: DOM manipulation, event listeners, etc.
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeContentScript);
} else {
  initializeContentScript();
}
