/**
 * Concurrency Manager - Distributed Lock System
 * 
 * Handles race conditions through database-backed distributed locks
 * with automatic expiration and deadlock prevention.
 * 
 * Features:
 * - Distributed mutex locks across multiple processes
 * - Automatic lock expiration to prevent deadlocks
 * - Lock validation and stale lock cleanup
 * - Exponential backoff for lock contention
 */

const { v4: uuidv4 } = require('uuid');

class ConcurrencyManager {
  constructor(dbClient, options = {}) {
    this.dbClient = dbClient;
    this.holderId = uuidv4();
    this.lockTimeout = options.lockTimeout || 30000; // 30 seconds default
    this.maxRetries = options.maxRetries || 5;
    this.baseBackoff = options.baseBackoff || 100; // milliseconds
    this.activeLocksMap = new Map(); // Track locks held by this process
  }

  /**
   * Acquire a distributed lock
   * @param {string} resourceType - Type of resource (e.g., 'page_analysis', 'whois_fetch')
   * @param {string} resourceId - Unique identifier of resource
   * @param {number} timeout - Lock timeout in milliseconds
   * @returns {Promise<{lockId: string, acquired: boolean}>}
   */
  async acquireLock(resourceType, resourceId, timeout = this.lockTimeout) {
    const lockId = `${resourceType}:${resourceId}:${this.holderId}`;
    const expiresAt = new Date(Date.now() + timeout);

    try {
      // First, clean up any expired locks
      await this.cleanupExpiredLocks();

      // Try to acquire lock with exponential backoff
      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        try {
          const query = `
            INSERT INTO distributed_locks (id, resource_type, resource_id, holder_id, acquired_at, expires_at)
            VALUES ($1, $2, $3, $4, NOW(), $5)
            ON CONFLICT (resource_type, resource_id) DO NOTHING
            RETURNING id, holder_id
          `;

          const result = await this.dbClient.query(query, [
            lockId,
            resourceType,
            resourceId,
            this.holderId,
            expiresAt
          ]);

          if (result.rows.length > 0) {
            // Lock acquired
            this.activeLocksMap.set(lockId, {
              resourceType,
              resourceId,
              expiresAt,
              acquiredAt: new Date()
            });

            console.log(`🔒 Lock acquired: ${resourceType}/${resourceId} (${lockId})`);
            return { lockId, acquired: true };
          }

          // Lock already held by another process, wait and retry
          if (attempt < this.maxRetries - 1) {
            const backoff = this.baseBackoff * Math.pow(2, attempt);
            console.log(`⏳ Lock contention for ${resourceType}/${resourceId}, retry ${attempt + 1}/${this.maxRetries} after ${backoff}ms`);
            await this.sleep(backoff);
          }
        } catch (error) {
          if (error.code === '23505') {
            // UNIQUE constraint violation - lock already exists
            if (attempt < this.maxRetries - 1) {
              const backoff = this.baseBackoff * Math.pow(2, attempt);
              await this.sleep(backoff);
              continue;
            }
          } else {
            throw error;
          }
        }
      }

      console.warn(`❌ Failed to acquire lock after ${this.maxRetries} attempts: ${resourceType}/${resourceId}`);
      return { lockId, acquired: false };
    } catch (error) {
      console.error(`❌ Error acquiring lock: ${error.message}`);
      throw error;
    }
  }

  /**
   * Release a distributed lock
   * @param {string} lockId - Lock ID to release
   * @returns {Promise<boolean>}
   */
  async releaseLock(lockId) {
    try {
      const query = `
        DELETE FROM distributed_locks
        WHERE id = $1 AND holder_id = $2
        RETURNING id
      `;

      const result = await this.dbClient.query(query, [lockId, this.holderId]);

      if (result.rows.length > 0) {
        this.activeLocksMap.delete(lockId);
        console.log(`🔓 Lock released: ${lockId}`);
        return true;
      }

      console.warn(`⚠️ Lock not found or not held by this holder: ${lockId}`);
      return false;
    } catch (error) {
      console.error(`❌ Error releasing lock: ${error.message}`);
      throw error;
    }
  }

  /**
   * Renew a lock (extend its expiration time)
   * @param {string} lockId - Lock ID to renew
   * @param {number} timeout - New timeout duration
   * @returns {Promise<boolean>}
   */
  async renewLock(lockId, timeout = this.lockTimeout) {
    try {
      const expiresAt = new Date(Date.now() + timeout);

      const query = `
        UPDATE distributed_locks
        SET expires_at = $1
        WHERE id = $2 AND holder_id = $3
        RETURNING id
      `;

      const result = await this.dbClient.query(query, [expiresAt, lockId, this.holderId]);

      if (result.rows.length > 0) {
        const lockInfo = this.activeLocksMap.get(lockId);
        if (lockInfo) {
          lockInfo.expiresAt = expiresAt;
        }
        console.log(`🔄 Lock renewed: ${lockId} (expires at ${expiresAt.toISOString()})`);
        return true;
      }

      return false;
    } catch (error) {
      console.error(`❌ Error renewing lock: ${error.message}`);
      throw error;
    }
  }

  /**
   * Acquire multiple locks atomically (all or nothing)
   * @param {Array<{resourceType: string, resourceId: string}>} resources
   * @param {number} timeout - Lock timeout
   * @returns {Promise<{locks: Array<{lockId: string}>, acquired: boolean}>}
   */
  async acquireMultipleLocks(resources, timeout = this.lockTimeout) {
    const acquiredLocks = [];

    try {
      // Try to acquire locks in order
      for (const resource of resources) {
        const { lockId, acquired } = await this.acquireLock(
          resource.resourceType,
          resource.resourceId,
          timeout
        );

        if (!acquired) {
          // If any lock fails, release all acquired locks
          for (const acquiredLock of acquiredLocks) {
            await this.releaseLock(acquiredLock.lockId);
          }
          return { locks: [], acquired: false };
        }

        acquiredLocks.push({ lockId, resourceType: resource.resourceType, resourceId: resource.resourceId });
      }

      return { locks: acquiredLocks, acquired: true };
    } catch (error) {
      // Release any acquired locks on error
      for (const acquiredLock of acquiredLocks) {
        try {
          await this.releaseLock(acquiredLock.lockId);
        } catch (e) {
          console.error(`Error releasing lock during cleanup: ${e.message}`);
        }
      }
      throw error;
    }
  }

  /**
   * Check if a lock exists and is held
   * @param {string} resourceType - Resource type
   * @param {string} resourceId - Resource ID
   * @returns {Promise<{locked: boolean, holderId?: string, expiresAt?: Date}>}
   */
  async checkLock(resourceType, resourceId) {
    try {
      const query = `
        SELECT holder_id, expires_at
        FROM distributed_locks
        WHERE resource_type = $1 AND resource_id = $2 AND expires_at > NOW()
        LIMIT 1
      `;

      const result = await this.dbClient.query(query, [resourceType, resourceId]);

      if (result.rows.length > 0) {
        const lock = result.rows[0];
        return {
          locked: true,
          holderId: lock.holder_id,
          expiresAt: lock.expires_at,
          isOwnedByMe: lock.holder_id === this.holderId
        };
      }

      return { locked: false };
    } catch (error) {
      console.error(`❌ Error checking lock: ${error.message}`);
      throw error;
    }
  }

  /**
   * Clean up expired locks to prevent table bloat
   * @returns {Promise<number>} Number of cleaned locks
   */
  async cleanupExpiredLocks() {
    try {
      const query = `
        DELETE FROM distributed_locks
        WHERE expires_at < NOW()
        RETURNING id
      `;

      const result = await this.dbClient.query(query);
      const count = result.rows.length;

      if (count > 0) {
        console.log(`🧹 Cleaned up ${count} expired locks`);
      }

      return count;
    } catch (error) {
      console.error(`❌ Error cleaning up locks: ${error.message}`);
      // Don't throw, just log - cleanup failures shouldn't break the system
      return 0;
    }
  }

  /**
   * Release all locks held by this process
   * @returns {Promise<number>} Number of locks released
   */
  async releaseAllLocks() {
    let releasedCount = 0;

    for (const [lockId] of this.activeLocksMap) {
      try {
        if (await this.releaseLock(lockId)) {
          releasedCount++;
        }
      } catch (error) {
        console.error(`Error releasing lock ${lockId}: ${error.message}`);
      }
    }

    console.log(`🔓 Released ${releasedCount} locks on shutdown`);
    return releasedCount;
  }

  /**
   * Helper: Sleep for milliseconds
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get statistics about locks
   * @returns {Promise<{activeLocks: number, myLocks: number}>}
   */
  async getLockStats() {
    try {
      const query = `
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN holder_id = $1 THEN 1 ELSE 0 END) as owned
        FROM distributed_locks
        WHERE expires_at > NOW()
      `;

      const result = await this.dbClient.query(query, [this.holderId]);
      const stats = result.rows[0];

      return {
        activeLocks: parseInt(stats.total) || 0,
        myLocks: parseInt(stats.owned) || 0
      };
    } catch (error) {
      console.error(`❌ Error getting lock stats: ${error.message}`);
      return { activeLocks: 0, myLocks: 0 };
    }
  }
}

module.exports = ConcurrencyManager;
