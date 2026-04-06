/**
 * Monitoring and Analytics for TaskTracker MCP Server
 * Tracks usage metrics, performance, and system health
 */

import { EventEmitter } from 'events';

export interface TaskMetrics {
  totalTasks: number;
  completedTasks: number;
  pendingTasks: number;
  inProgressTasks: number;
  blockedTasks: number;
  skippedTasks: number;
  averageCompletionTime: number;
  taskCreationRate: number;
  dependencyComplexity: number;
}

export interface PerformanceMetrics {
  operationLatencies: Map<string, number[]>;
  memoryUsage: NodeJS.MemoryUsage;
  uptime: number;
  errorRate: number;
  throughput: number;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  issues: string[];
  lastChecked: Date;
}

export class TaskTrackerMonitor extends EventEmitter {
  private metrics: TaskMetrics;
  private performance: PerformanceMetrics;
  private health: SystemHealth;
  private startTime: Date;
  private operationCount: number = 0;
  private errorCount: number = 0;

  constructor() {
    super();
    this.startTime = new Date();
    this.metrics = this.initializeMetrics();
    this.performance = this.initializePerformance();
    this.health = this.initializeHealth();

    // Periodic health checks
    setInterval(() => this.performHealthCheck(), 30000); // Every 30 seconds
  }

  private initializeMetrics(): TaskMetrics {
    return {
      totalTasks: 0,
      completedTasks: 0,
      pendingTasks: 0,
      inProgressTasks: 0,
      blockedTasks: 0,
      skippedTasks: 0,
      averageCompletionTime: 0,
      taskCreationRate: 0,
      dependencyComplexity: 0,
    };
  }

  private initializePerformance(): PerformanceMetrics {
    return {
      operationLatencies: new Map(),
      memoryUsage: process.memoryUsage(),
      uptime: 0,
      errorRate: 0,
      throughput: 0,
    };
  }

  private initializeHealth(): SystemHealth {
    return {
      status: 'healthy',
      issues: [],
      lastChecked: new Date(),
    };
  }

  /**
   * Record task creation
   */
  recordTaskCreation(taskId: string, dependencies: string[]): void {
    this.metrics.totalTasks++;
    this.metrics.dependencyComplexity += dependencies.length;
    this.operationCount++;

    this.emit('taskCreated', { taskId, dependencies, timestamp: new Date() });
  }

  /**
   * Record task status change
   */
  recordTaskUpdate(
    taskId: string,
    oldStatus: string,
    newStatus: string,
    completionTime?: number
  ): void {
    // Update counters
    if (oldStatus === 'completed') this.metrics.completedTasks--;
    if (oldStatus === 'pending') this.metrics.pendingTasks--;
    if (oldStatus === 'in_progress') this.metrics.inProgressTasks--;
    if (oldStatus === 'blocked') this.metrics.blockedTasks--;
    if (oldStatus === 'skipped') this.metrics.skippedTasks--;

    if (newStatus === 'completed') {
      this.metrics.completedTasks++;
      if (completionTime) {
        this.updateAverageCompletionTime(completionTime);
      }
    }
    if (newStatus === 'pending') this.metrics.pendingTasks++;
    if (newStatus === 'in_progress') this.metrics.inProgressTasks++;
    if (newStatus === 'blocked') this.metrics.blockedTasks++;
    if (newStatus === 'skipped') this.metrics.skippedTasks++;

    this.operationCount++;
    this.emit('taskUpdated', { taskId, oldStatus, newStatus, timestamp: new Date() });
  }

  /**
   * Record operation latency
   */
  recordOperationLatency(operation: string, latencyMs: number): void {
    if (!this.performance.operationLatencies.has(operation)) {
      this.performance.operationLatencies.set(operation, []);
    }

    const latencies = this.performance.operationLatencies.get(operation)!;
    latencies.push(latencyMs);

    // Keep only last 100 measurements
    if (latencies.length > 100) {
      latencies.shift();
    }

    this.emit('operationLatency', { operation, latencyMs, timestamp: new Date() });
  }

  /**
   * Record error
   */
  recordError(operation: string, error: Error): void {
    this.errorCount++;
    this.emit('error', { operation, error: error.message, timestamp: new Date() });
  }

  /**
   * Update average completion time
   */
  private updateAverageCompletionTime(completionTime: number): void {
    const currentAvg = this.metrics.averageCompletionTime;
    const totalCompleted = this.metrics.completedTasks;
    this.metrics.averageCompletionTime =
      (currentAvg * (totalCompleted - 1) + completionTime) / totalCompleted;
  }

  /**
   * Perform health check
   */
  private performHealthCheck(): void {
    const issues: string[] = [];
    const memoryUsage = process.memoryUsage();

    // Memory health check
    const memoryUsagePercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
    if (memoryUsagePercent > 90) {
      issues.push(`High memory usage: ${memoryUsagePercent.toFixed(1)}%`);
    }

    // Error rate check
    const errorRate = this.errorCount / Math.max(this.operationCount, 1);
    if (errorRate > 0.1) {
      // More than 10% error rate
      issues.push(`High error rate: ${(errorRate * 100).toFixed(1)}%`);
    }

    // Performance check
    const avgLatency = this.getAverageLatency();
    if (avgLatency > 1000) {
      // Operations taking more than 1 second
      issues.push(`Slow operations: ${avgLatency.toFixed(0)}ms average latency`);
    }

    // Update health status
    let status: SystemHealth['status'] = 'healthy';
    if (issues.length > 0) {
      status = issues.length > 2 ? 'unhealthy' : 'degraded';
    }

    this.health = {
      status,
      issues,
      lastChecked: new Date(),
    };

    this.emit('healthCheck', this.health);
  }

  /**
   * Get current metrics
   */
  getMetrics(): TaskMetrics {
    this.updatePerformanceMetrics();
    return { ...this.metrics };
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): PerformanceMetrics {
    this.updatePerformanceMetrics();
    return { ...this.performance };
  }

  /**
   * Get system health
   */
  getHealth(): SystemHealth {
    return { ...this.health };
  }

  /**
   * Get average latency across all operations
   */
  private getAverageLatency(): number {
    const allLatencies: number[] = [];
    this.performance.operationLatencies.forEach(latencies => {
      allLatencies.push(...latencies);
    });

    if (allLatencies.length === 0) return 0;
    return allLatencies.reduce((sum, lat) => sum + lat, 0) / allLatencies.length;
  }

  /**
   * Update performance metrics
   */
  private updatePerformanceMetrics(): void {
    this.performance.memoryUsage = process.memoryUsage();
    this.performance.uptime = Date.now() - this.startTime.getTime();
    this.performance.errorRate = this.errorCount / Math.max(this.operationCount, 1);
    this.performance.throughput = this.operationCount / (this.performance.uptime / 1000); // ops per second
  }

  /**
   * Generate health report
   */
  generateHealthReport(): string {
    const metrics = this.getMetrics();
    const performance = this.getPerformanceMetrics();
    const health = this.getHealth();

    const report = [
      '📊 TaskTracker Health Report',
      `Status: ${health.status.toUpperCase()}`,
      `Last Checked: ${health.lastChecked.toISOString()}`,
      '',
      '📈 Task Metrics:',
      `  Total Tasks: ${metrics.totalTasks}`,
      `  Completed: ${metrics.completedTasks}`,
      `  Pending: ${metrics.pendingTasks}`,
      `  In Progress: ${metrics.inProgressTasks}`,
      `  Blocked: ${metrics.blockedTasks}`,
      `  Average Completion Time: ${metrics.averageCompletionTime.toFixed(2)}ms`,
      `  Dependency Complexity: ${metrics.dependencyComplexity}`,
      '',
      '⚡ Performance Metrics:',
      `  Uptime: ${(performance.uptime / 1000 / 60).toFixed(2)} minutes`,
      `  Memory Usage: ${(performance.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      `  Error Rate: ${(performance.errorRate * 100).toFixed(2)}%`,
      `  Throughput: ${performance.throughput.toFixed(2)} ops/sec`,
      `  Average Latency: ${this.getAverageLatency().toFixed(2)}ms`,
      '',
      health.issues.length > 0
        ? `⚠️  Issues:\n${health.issues.map(issue => `  - ${issue}`).join('\n')}`
        : '✅ No issues detected',
    ];

    return report.join('\n');
  }

  /**
   * Export metrics for external monitoring
   */
  exportMetrics(): any {
    return {
      taskMetrics: this.getMetrics(),
      performanceMetrics: this.getPerformanceMetrics(),
      health: this.getHealth(),
      timestamp: new Date().toISOString(),
    };
  }
}

// Global monitor instance
export const monitor = new TaskTrackerMonitor();
