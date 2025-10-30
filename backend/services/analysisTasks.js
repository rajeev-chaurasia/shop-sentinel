/**
 * Simplified Task Scheduler
 * 
 * Single-server parallelization for 50+ concurrent users
 * No database task tracking - simpler in-memory execution
 */

class TaskScheduler {
  constructor() {
    // Task definitions with dependencies
    this.tasks = {
      FETCH_METADATA: {
        name: 'FETCH_METADATA',
        timeout: 5000,
        dependencies: [],
        retryable: true
      },
      SECURITY_CHECK: {
        name: 'SECURITY_CHECK',
        timeout: 3000,
        dependencies: ['FETCH_METADATA'],
        retryable: true
      },
      DOMAIN_ANALYSIS: {
        name: 'DOMAIN_ANALYSIS',
        timeout: 10000,
        dependencies: ['SECURITY_CHECK'],
        retryable: true
      },
      EXTRACT_CONTENT: {
        name: 'EXTRACT_CONTENT',
        timeout: 8000,
        dependencies: ['SECURITY_CHECK'],
        retryable: true
      },
      SOCIAL_MEDIA_CHECK: {
        name: 'SOCIAL_MEDIA_CHECK',
        timeout: 5000,
        dependencies: ['EXTRACT_CONTENT'],
        retryable: true
      },
      LINK_ANALYSIS: {
        name: 'LINK_ANALYSIS',
        timeout: 8000,
        dependencies: ['DOMAIN_ANALYSIS', 'SOCIAL_MEDIA_CHECK', 'EXTRACT_CONTENT'],
        retryable: true
      },
      POLICY_CHECK: {
        name: 'POLICY_CHECK',
        timeout: 5000,
        dependencies: ['LINK_ANALYSIS'],
        retryable: true
      },
      FINGERPRINT_ANALYSIS: {
        name: 'FINGERPRINT_ANALYSIS',
        timeout: 3000,
        dependencies: ['LINK_ANALYSIS'],
        retryable: false
      },
      AI_ANALYSIS: {
        name: 'AI_ANALYSIS',
        timeout: 30000,
        dependencies: ['POLICY_CHECK', 'FINGERPRINT_ANALYSIS'],
        retryable: true,
        optional: true
      },
      RESULT_AGGREGATION: {
        name: 'RESULT_AGGREGATION',
        timeout: 2000,
        dependencies: ['POLICY_CHECK', 'FINGERPRINT_ANALYSIS', 'AI_ANALYSIS'],
        retryable: false
      }
    };
  }

  /**
   * Build execution plan (batches of parallelizable tasks)
   */
  buildExecutionPlan(includeAI = true) {
    const plan = [];
    const completed = new Set();
    const taskNames = includeAI 
      ? Object.keys(this.tasks) 
      : Object.keys(this.tasks).filter(t => t !== 'AI_ANALYSIS');

    while (completed.size < taskNames.length) {
      // Find tasks with all dependencies satisfied
      const batch = taskNames.filter(taskName => {
        if (completed.has(taskName)) return false;
        const task = this.tasks[taskName];
        return task.dependencies.every(dep => completed.has(dep));
      });

      if (batch.length === 0) {
        const remaining = taskNames.filter(t => !completed.has(t));
        throw new Error(`Circular dependency detected: ${remaining.join(', ')}`);
      }

      plan.push(batch);
      batch.forEach(t => completed.add(t));
    }

    return plan;
  }

  /**
   * Get task definition
   */
  getTask(taskName) {
    return this.tasks[taskName];
  }

  /**
   * Check if task is optional
   */
  isOptional(taskName) {
    const task = this.tasks[taskName];
    return task && task.optional === true;
  }

  /**
   * Check if task is retryable
   */
  isRetryable(taskName) {
    const task = this.tasks[taskName];
    return task && task.retryable === true;
  }

  /**
   * Get task timeout
   */
  getTaskTimeout(taskName) {
    const task = this.tasks[taskName];
    return task ? task.timeout : 30000;
  }

  /**
   * Validate execution plan
   */
  validatePlan(plan) {
    if (!Array.isArray(plan)) return false;
    
    for (const batch of plan) {
      if (!Array.isArray(batch) || batch.length === 0) return false;
      for (const taskName of batch) {
        if (!this.tasks[taskName]) return false;
      }
    }
    
    return true;
  }
}

module.exports = TaskScheduler;
