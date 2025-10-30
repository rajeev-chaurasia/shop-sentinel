/**
 * Simplified Job Queue - Single-server parallelization
 * 
 * Manages task execution for multiple jobs with:
 * - Simple worker pool (4 workers for 50+ concurrent users)
 * - In-memory task batching based on dependencies
 * - Minimal overhead, no database task tracking
 * - Graceful shutdown
 */

const { EventEmitter } = require('events');

class JobQueue extends EventEmitter {
  constructor(taskScheduler, concurrencyControl, options = {}) {
    super();
    this.taskScheduler = taskScheduler;
    this.concurrencyControl = concurrencyControl;

    // Configuration
    this.maxWorkers = options.maxWorkers || 4;
    this.taskTimeout = options.taskTimeout || 30000;

    // State - in-memory only, no database
    this.workers = new Map();
    this.jobExecutions = new Map(); // Track active job executions
    this.isShuttingDown = false;

    // Initialize workers
    this.initializeWorkers();
  }

  /**
   * Initialize worker pool
   */
  initializeWorkers() {
    for (let i = 0; i < this.maxWorkers; i++) {
      this.workers.set(i, {
        id: i,
        busy: false,
        currentJobId: null,
        tasksCompleted: 0,
        tasksFailed: 0
      });
    }
    console.log(`👷 Initialized ${this.maxWorkers} workers`);
  }

  /**
   * Execute analysis for a job
   * Runs all tasks in dependency order with parallelization
   */
  async executeJob(jobId, url, jobData, includeAI = true) {
    if (this.jobExecutions.has(jobId)) {
      throw new Error(`Job ${jobId} is already running`);
    }

    // Mark job as executing in concurrency control
    this.concurrencyControl.startAnalysis(url);
    this.jobExecutions.set(jobId, { url, startTime: Date.now(), completed: false });

    try {
      // Build execution plan (batches of parallelizable tasks)
      const executionPlan = this.taskScheduler.buildExecutionPlan(includeAI);

      // Execute each batch sequentially, but tasks within batch in parallel
      for (let batchIndex = 0; batchIndex < executionPlan.length; batchIndex++) {
        const batch = executionPlan[batchIndex];

        console.log(`📦 Job ${jobId} - Executing batch ${batchIndex + 1}: [${batch.join(', ')}]`);

        // Execute all tasks in this batch in parallel using Promise.all
        const batchResults = await this.executeBatch(jobId, url, batch, jobData);

        // Check for critical failures
        const criticalFailure = batchResults.some(r => !r.success && !this.taskScheduler.isOptional(r.taskName));
        if (criticalFailure) {
          const failedTask = batchResults.find(r => !r.success);
          throw new Error(`Critical task failed: ${failedTask.taskName} - ${failedTask.error}`);
        }

        // Emit progress
        this.emit('batch_completed', { jobId, batch, batchIndex, totalBatches: executionPlan.length });
      }

      // Mark job as complete
      const execution = this.jobExecutions.get(jobId);
      execution.completed = true;
      execution.duration = Date.now() - execution.startTime;

      console.log(`✅ Job ${jobId} completed in ${execution.duration}ms`);
      this.emit('job_completed', { jobId, duration: execution.duration });

      return { success: true, jobId, duration: execution.duration };
    } catch (error) {
      console.error(`❌ Job ${jobId} failed: ${error.message}`);
      this.emit('job_failed', { jobId, error: error.message });
      throw error;
    } finally {
      // Cleanup
      this.jobExecutions.delete(jobId);
      this.concurrencyControl.completeAnalysis(url);
    }
  }

  /**
   * Execute a batch of tasks in parallel
   */
  async executeBatch(jobId, url, taskNames, jobData) {
    // Create promises for all tasks in the batch
    const promises = taskNames.map(taskName => 
      this.executeTask(jobId, taskName, url, jobData).catch(error => ({
        taskName,
        success: false,
        error: error.message
      }))
    );

    // Execute all tasks in parallel
    const results = await Promise.all(promises);
    return results;
  }

  /**
   * Execute a single task
   */
  async executeTask(jobId, taskName, url, jobData) {
    const startTime = Date.now();
    const taskDef = this.taskScheduler.getTask(taskName);
    const timeoutMs = taskDef.timeout;

    try {
      // Get task executor function
      const executor = this.getTaskExecutor(taskName);

      // Execute with timeout
      const result = await Promise.race([
        executor({ jobId, url, data: jobData }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`Task timeout after ${timeoutMs}ms`)),
            timeoutMs
          )
        )
      ]);

      const duration = Date.now() - startTime;
      console.log(`  ✓ ${taskName} completed (${duration}ms)`);

      return { taskName, success: true, duration, result };
    } catch (error) {
      const duration = Date.now() - startTime;
      const isRetryable = this.taskScheduler.isRetryable(taskName);
      const isOptional = this.taskScheduler.isOptional(taskName);

      console.log(`  ✗ ${taskName} failed (${isRetryable ? 'retryable' : 'final'}, ${isOptional ? 'optional' : 'critical'}): ${error.message}`);

      // If retryable, retry once
      if (isRetryable) {
        try {
          const executor = this.getTaskExecutor(taskName);
          const result = await Promise.race([
            executor({ jobId, url, data: jobData }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Retry timeout')), timeoutMs)
            )
          ]);

          console.log(`  ✓ ${taskName} succeeded on retry`);
          return { taskName, success: true, duration: Date.now() - startTime, retried: true, result };
        } catch (retryError) {
          console.log(`  ✗ ${taskName} failed on retry too`);
          throw retryError;
        }
      }

      // Not retryable - throw immediately (unless optional)
      throw error;
    }
  }

  /**
   * Get task executor function
   * These are simplified placeholders - replace with actual analysis functions
   */
  getTaskExecutor(taskName) {
    const executors = {
      FETCH_METADATA: (ctx) => this.fetchMetadata(ctx),
      SECURITY_CHECK: (ctx) => this.securityCheck(ctx),
      DOMAIN_ANALYSIS: (ctx) => this.domainAnalysis(ctx),
      EXTRACT_CONTENT: (ctx) => this.extractContent(ctx),
      SOCIAL_MEDIA_CHECK: (ctx) => this.socialMediaCheck(ctx),
      LINK_ANALYSIS: (ctx) => this.linkAnalysis(ctx),
      POLICY_CHECK: (ctx) => this.policyCheck(ctx),
      FINGERPRINT_ANALYSIS: (ctx) => this.fingerprintAnalysis(ctx),
      AI_ANALYSIS: (ctx) => this.aiAnalysis(ctx),
      RESULT_AGGREGATION: (ctx) => this.resultAggregation(ctx)
    };

    const executor = executors[taskName];
    if (!executor) {
      throw new Error(`Unknown task: ${taskName}`);
    }

    return executor;
  }

  // Task executor implementations (replace with actual logic)
  async fetchMetadata(ctx) {
    await new Promise(r => setTimeout(r, 500));
    return { metadata: 'fetched' };
  }

  async securityCheck(ctx) {
    await new Promise(r => setTimeout(r, 300));
    return { secure: true };
  }

  async domainAnalysis(ctx) {
    await new Promise(r => setTimeout(r, 1000));
    return { domain: 'analyzed' };
  }

  async extractContent(ctx) {
    await new Promise(r => setTimeout(r, 1000));
    return { content: 'extracted' };
  }

  async socialMediaCheck(ctx) {
    await new Promise(r => setTimeout(r, 500));
    return { social: 'checked' };
  }

  async linkAnalysis(ctx) {
    await new Promise(r => setTimeout(r, 1000));
    return { links: 'analyzed' };
  }

  async policyCheck(ctx) {
    await new Promise(r => setTimeout(r, 500));
    return { policy: 'checked' };
  }

  async fingerprintAnalysis(ctx) {
    await new Promise(r => setTimeout(r, 300));
    return { fingerprint: 'analyzed' };
  }

  async aiAnalysis(ctx) {
    await new Promise(r => setTimeout(r, 2000));
    return { ai: 'analyzed' };
  }

  async resultAggregation(ctx) {
    await new Promise(r => setTimeout(r, 300));
    return { results: 'aggregated' };
  }

  /**
   * Get queue statistics
   */
  getQueueStats() {
    const busyWorkers = Array.from(this.workers.values()).filter(w => w.busy);
    const totalTasksCompleted = Array.from(this.workers.values())
      .reduce((sum, w) => sum + w.tasksCompleted, 0);
    const totalTasksFailed = Array.from(this.workers.values())
      .reduce((sum, w) => sum + w.tasksFailed, 0);

    return {
      workers: {
        total: this.maxWorkers,
        busy: busyWorkers.length,
        idle: this.maxWorkers - busyWorkers.length
      },
      stats: {
        tasksCompleted: totalTasksCompleted,
        tasksFailed: totalTasksFailed
      },
      activeJobs: this.jobExecutions.size
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    console.log('🛑 Initiating queue shutdown...');
    this.isShuttingDown = true;

    // Wait for active jobs to complete (with timeout)
    const maxWaitTime = 30000;
    const startTime = Date.now();

    while (this.jobExecutions.size > 0) {
      if (Date.now() - startTime > maxWaitTime) {
        console.warn(`⚠️ Shutdown timeout, ${this.jobExecutions.size} jobs still running`);
        break;
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    console.log('✅ Queue shutdown complete');
  }
}

module.exports = JobQueue;
