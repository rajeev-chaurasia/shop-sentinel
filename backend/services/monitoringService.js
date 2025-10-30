/**
 * Simplified Monitoring Service
 * 
 * Essential metrics only for single-server deployments:
 * - Task execution times
 * - Job completion metrics
 * - Basic performance stats
 */

const { EventEmitter } = require('events');

class MonitoringService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.historySize = options.historySize || 500;
    this.metrics = {
      taskExecutions: [],
      jobMetrics: []
    };
    this.startTime = Date.now();
  }

  /**
   * Record task execution metrics
   */
  recordTaskExecution(jobId, taskName, duration, status) {
    const metric = {
      timestamp: Date.now(),
      jobId,
      taskName,
      duration,
      status
    };

    this.metrics.taskExecutions.push(metric);

    // Keep history bounded
    if (this.metrics.taskExecutions.length > this.historySize) {
      this.metrics.taskExecutions.shift();
    }

    this.emit('task_execution', metric);
  }

  /**
   * Record job completion
   */
  recordJobCompletion(jobId, duration) {
    const metric = {
      timestamp: Date.now(),
      jobId,
      duration
    };

    this.metrics.jobMetrics.push(metric);

    if (this.metrics.jobMetrics.length > this.historySize) {
      this.metrics.jobMetrics.shift();
    }

    this.emit('job_completion', metric);
  }

  /**
   * Get basic statistics
   */
  getStats() {
    const recentTasks = this.metrics.taskExecutions.slice(-100);
    const recentJobs = this.metrics.jobMetrics.slice(-50);

    if (recentTasks.length === 0) {
      return {
        uptime: Date.now() - this.startTime,
        totalTasksRecorded: 0,
        totalJobsRecorded: 0,
        stats: {}
      };
    }

    // Task stats
    const avgTaskDuration = recentTasks.reduce((sum, t) => sum + t.duration, 0) / recentTasks.length;
    const failedTasks = recentTasks.filter(t => t.status === 'failed').length;
    const taskSuccessRate = ((recentTasks.length - failedTasks) / recentTasks.length) * 100;

    // Job stats
    const avgJobDuration = recentJobs.length > 0
      ? recentJobs.reduce((sum, j) => sum + j.duration, 0) / recentJobs.length
      : 0;

    // Task breakdown by type
    const taskStats = new Map();
    for (const task of recentTasks) {
      if (!taskStats.has(task.taskName)) {
        taskStats.set(task.taskName, { count: 0, totalDuration: 0 });
      }
      const stat = taskStats.get(task.taskName);
      stat.count++;
      stat.totalDuration += task.duration;
    }

    const taskBreakdown = {};
    for (const [name, stat] of taskStats) {
      taskBreakdown[name] = {
        count: stat.count,
        avgDuration: Math.round(stat.totalDuration / stat.count)
      };
    }

    return {
      uptime: Date.now() - this.startTime,
      totalTasksRecorded: this.metrics.taskExecutions.length,
      totalJobsRecorded: this.metrics.jobMetrics.length,
      stats: {
        avgTaskDuration: Math.round(avgTaskDuration),
        taskSuccessRate: Math.round(taskSuccessRate * 100) / 100,
        avgJobDuration: Math.round(avgJobDuration),
        taskBreakdown
      }
    };
  }

  /**
   * Get summary for display
   */
  getSummary() {
    const stats = this.getStats();
    const recentTasks = this.metrics.taskExecutions.slice(-50);

    return {
      timestamp: new Date().toISOString(),
      totalJobs: this.metrics.jobMetrics.length,
      totalTasks: this.metrics.taskExecutions.length,
      recentAvgJobTime: stats.stats.avgJobDuration,
      successRate: stats.stats.taskSuccessRate,
      recentTasks: recentTasks.map(t => ({
        task: t.taskName,
        duration: t.duration,
        status: t.status
      }))
    };
  }

  /**
   * Export metrics for monitoring
   */
  exportMetrics() {
    return {
      timestamp: new Date().toISOString(),
      taskExecutions: this.metrics.taskExecutions.slice(-100),
      jobMetrics: this.metrics.jobMetrics.slice(-50),
      summary: this.getSummary()
    };
  }

  /**
   * Reset metrics
   */
  reset() {
    this.metrics = {
      taskExecutions: [],
      jobMetrics: []
    };
    this.startTime = Date.now();
  }
}

module.exports = MonitoringService;
