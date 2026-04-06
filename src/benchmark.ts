#!/usr/bin/env node

/**
 * Performance Benchmark Suite for TaskTracker MCP Server
 * Measures performance characteristics and identifies bottlenecks
 */

import Benchmark from 'benchmark';
import { TaskTracker } from './tracker.js';

const suite = new Benchmark.Suite();

// Setup function for benchmarks that need a tracker
function createTrackerWithTasks(count: number): TaskTracker {
  const tracker = new TaskTracker();
  const tasks = Array.from({ length: count }, (_, i) => ({
    title: `Task ${i + 1}`,
    category: ['log_check', 'config_verify', 'root_cause', 'comparison', 'reproduce', 'general'][
      i % 6
    ] as any,
    priority: ['high', 'medium', 'low'][i % 3] as any,
    depends_on: i > 0 && Math.random() > 0.7 ? [`T${Math.floor(Math.random() * i) + 1}`] : [],
  }));
  tracker.addTasksBulk(tasks);
  return tracker;
}

console.log('🚀 TaskTracker Performance Benchmarks\n');

// Benchmark: Adding single tasks
suite.add('Add Single Task', {
  defer: true,
  fn: function (deferred: any) {
    const tracker = new TaskTracker();
    tracker.addTask({ title: 'Benchmark Task' });
    deferred.resolve();
  },
});

// Benchmark: Adding bulk tasks (small)
suite.add('Add 10 Tasks (Bulk)', {
  defer: true,
  fn: function (deferred: any) {
    const tracker = new TaskTracker();
    const tasks = Array.from({ length: 10 }, (_, i) => ({
      title: `Task ${i + 1}`,
    }));
    tracker.addTasksBulk(tasks);
    deferred.resolve();
  },
});

// Benchmark: Adding bulk tasks (medium)
suite.add('Add 100 Tasks (Bulk)', {
  defer: true,
  fn: function (deferred: any) {
    const tracker = new TaskTracker();
    const tasks = Array.from({ length: 100 }, (_, i) => ({
      title: `Task ${i + 1}`,
      depends_on: i > 0 ? [`T${Math.floor(Math.random() * i) + 1}`] : [],
    }));
    tracker.addTasksBulk(tasks);
    deferred.resolve();
  },
});

// Benchmark: Getting ready tasks
suite.add('Get Ready Tasks (100 tasks)', {
  defer: true,
  setup: function () {
    (this as any).tracker = new TaskTracker();
    const tasks = Array.from({ length: 100 }, (_, i) => ({
      title: `Task ${i + 1}`,
      depends_on: i > 0 && Math.random() > 0.5 ? [`T${Math.floor(Math.random() * i) + 1}`] : [],
    }));
    (this as any).tracker.addTasksBulk(tasks);
  },
  fn: function (deferred: any) {
    (this as any).tracker.getReadyTasks();
    deferred.resolve();
  },
});

// Benchmark: Updating tasks
suite.add('Update Task Status', {
  defer: true,
  setup: function () {
    (this as any).tracker = new TaskTracker();
    (this as any).tracker.addTask({ title: 'Task to Update' });
  },
  fn: function (deferred: any) {
    (this as any).tracker.updateTask({
      task_id: 'T1',
      status: 'completed',
      finding: 'Completed benchmark task',
    });
    deferred.resolve();
  },
});

// Benchmark: Complex DAG operations
suite.add('Complex DAG Operations (50 tasks)', {
  defer: true,
  setup: function () {
    (this as any).tracker = new TaskTracker();
    // Create a complex dependency graph
    for (let i = 1; i <= 50; i++) {
      const deps = [];
      if (i > 1) deps.push(`T${i - 1}`);
      if (i > 2 && i % 3 === 0) deps.push(`T${i - 2}`);
      (this as any).tracker.addTask({
        title: `Complex Task ${i}`,
        depends_on: deps,
      });
    }
  },
  fn: function (deferred: any) {
    // Complete some tasks and check ready queue
    (this as any).tracker.updateTask({ task_id: 'T1', status: 'completed', finding: 'Done' });
    (this as any).tracker.updateTask({ task_id: 'T2', status: 'completed', finding: 'Done' });
    const ready = (this as any).tracker.getReadyTasks();
    const snapshot = (this as any).tracker.getAllTasks();
    deferred.resolve();
  },
});

// Benchmark: Memory usage tracking
suite.add('Memory Usage (1000 tasks)', {
  defer: true,
  fn: function (deferred: any) {
    const tracker = new TaskTracker();
    const tasks = Array.from({ length: 1000 }, (_, i) => ({
      title: `Memory Test Task ${i + 1}`,
      depends_on: i > 0 && Math.random() > 0.8 ? [`T${Math.floor(Math.random() * i) + 1}`] : [],
    }));

    const startMem = process.memoryUsage().heapUsed;
    tracker.addTasksBulk(tasks);
    const endMem = process.memoryUsage().heapUsed;

    console.log(`Memory used: ${((endMem - startMem) / 1024 / 1024).toFixed(2)} MB`);
    deferred.resolve();
  },
});

// Run benchmarks
suite
  .on('cycle', function (event: any) {
    console.log(String(event.target));
  })
  .on('complete', function (this: any) {
    console.log('\n🏁 Benchmark complete!');
    console.log('Fastest:', this.filter('fastest').map('name').join(', '));
    console.log('Slowest:', this.filter('slowest').map('name').join(', '));

    // Performance recommendations
    console.log('\n📊 Performance Analysis:');
    const results = this as any as Benchmark[];
    results.forEach((result: any) => {
      const ops = result.hz;
      if (ops < 100) {
        console.log(`⚠️  ${result.name}: ${ops.toFixed(2)} ops/sec - Consider optimization`);
      } else if (ops < 1000) {
        console.log(`✅ ${result.name}: ${ops.toFixed(2)} ops/sec - Good performance`);
      } else {
        console.log(`🚀 ${result.name}: ${ops.toFixed(2)} ops/sec - Excellent performance`);
      }
    });
  })
  .run({ async: true });
