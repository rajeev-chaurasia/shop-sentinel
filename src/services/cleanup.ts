import { StorageService } from './storage';

export async function cleanupStorageOnStartup() {
  try {
    console.log('🧹 Running storage cleanup on startup...');
    
    // Clear any stale locks
    await StorageService.clearAllLocks();
    
    // Clear any stale analysis progress markers
    const all = await chrome.storage.local.get(null);
    const progressKeys = Object.keys(all).filter(key => key.startsWith('progress_'));
    
    if (progressKeys.length > 0) {
      await chrome.storage.local.remove(progressKeys);
      console.log(`✅ Cleared ${progressKeys.length} stale progress markers`);
    }
    
    console.log('✨ Storage cleanup complete');
  } catch (error) {
    console.error('❌ Storage cleanup failed:', error);
  }
}