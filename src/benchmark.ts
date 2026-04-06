#!/usr/bin/env node

/**
 * Performance Benchmark Suite for TaskTracker MCP Server
 */

import Benchmark from 'benchmark';
import { TaskTracker } from './tracker.js';

const suite = new Benchmark.Suite();

// Pre-built trackers for read-only benchmarks (state does not change during the bench)
const tracker100 = (() => {
  const t = new TaskTracker();
  t.addTasksBulk(
    Array.from({ length: 100 }, (_, i) => ({
      title: `Task ${i + 1}`,
      depends_on:
        i > 0 && i % 3 !== 0 ? [`T${Math.floor(Math.random() * i) + 1}`] : [],
    }))
  );
  return t;
})();

const tracker1000 = (() => {
  const t = new TaskTracker();
  t.addTasksBulk(
    Array.from({ length: 1000 }, (_, i) => ({
      title: `Task ${i + 1}`,
      depends_on:
        i > 0 && Math.random() > 0.8 ? [`T${Math.floor(Math.random() * i) + 1}`] : [],
    }))
  );
  return t;
})();

console.log('TaskTracker Performance Benchmarks\n');

// ── Add operations ──────────────────────────────────────────────────────────

suite.add('addTask — single', () => {
  const t = new TaskTracker();
  t.addTask({ title: 'Benchmark Task' });
});

suite.add('addTasksBulk — 10 tasks (no deps)', () => {
  const t = new TaskTracker();
  t.addTasksBulk(Array.from({ length: 10 }, (_, i) => ({ title: `Task ${i + 1}` })));
});

suite.add('addTasksBulk — 50 tasks (linear chain)', () => {
  const t = new TaskTracker();
  t.addTasksBulk(
    Array.from({ length: 50 }, (_, i) => ({
      title: `Task ${i + 1}`,
      depends_on: i > 0 ? [`T${i}`] : [],
    }))
  );
});

suite.add('addTasksBulk — 100 tasks (random deps)', () => {
  const t = new TaskTracker();
  t.addTasksBulk(
    Array.from({ length: 100 }, (_, i) => ({
      title: `Task ${i + 1}`,
      depends_on: i > 0 && i % 3 !== 0 ? [`T${Math.floor(Math.random() * i) + 1}`] : [],
    }))
  );
});

suite.add('addTasksBulk — 500 tasks (random deps)', () => {
  const t = new TaskTracker();
  t.addTasksBulk(
    Array.from({ length: 500 }, (_, i) => ({
      title: `Task ${i + 1}`,
      depends_on: i > 0 && Math.random() > 0.7 ? [`T${Math.floor(Math.random() * i) + 1}`] : [],
    }))
  );
});

// ── Read operations (pre-built tracker, no mutation) ────────────────────────

suite.add('getReadyTasks — 100 tasks', () => {
  tracker100.getReadyTasks();
});

suite.add('getAllTasks — 100 tasks', () => {
  tracker100.getAllTasks();
});

suite.add('getReadyTasks — 1000 tasks', () => {
  tracker1000.getReadyTasks();
});

suite.add('getAllTasks — 1000 tasks', () => {
  tracker1000.getAllTasks();
});

// ── Update operations ───────────────────────────────────────────────────────

suite.add('updateTask — status transition (pending → completed)', () => {
  const t = new TaskTracker();
  t.addTask({ title: 'Task' });
  t.updateTask({ task_id: 'T1', status: 'completed', finding: 'done' });
});

suite.add('updateTask — unblock chain (T1→T2→T3)', () => {
  const t = new TaskTracker();
  t.addTask({ title: 'T1' });
  t.addTask({ title: 'T2', depends_on: ['T1'] });
  t.addTask({ title: 'T3', depends_on: ['T2'] });
  t.updateTask({ task_id: 'T1', status: 'completed', finding: 'done' });
  t.updateTask({ task_id: 'T2', status: 'completed', finding: 'done' });
  t.updateTask({ task_id: 'T3', status: 'completed', finding: 'done' });
});

suite.add('updateTask — dep rewiring (cycle check)', () => {
  const t = new TaskTracker();
  t.addTask({ title: 'T1' });
  t.addTask({ title: 'T2' });
  t.addTask({ title: 'T3' });
  t.updateTask({ task_id: 'T1', depends_on: ['T2'] });
  t.updateTask({ task_id: 'T1', depends_on: ['T3'] });
  t.updateTask({ task_id: 'T1', depends_on: [] });
});

// ── Full workflow ───────────────────────────────────────────────────────────

suite.add('full workflow — 10-task DAG (add → complete all → conclude)', () => {
  const t = new TaskTracker();
  t.addTasksBulk(
    Array.from({ length: 10 }, (_, i) => ({
      title: `Task ${i + 1}`,
      depends_on: i > 0 ? [`T${i}`] : [],
    }))
  );
  for (let i = 1; i <= 10; i++) {
    t.updateTask({ task_id: `T${i}`, status: 'completed', finding: 'done' });
  }
  t.concludeAnalysis();
});

suite.add('concludeAnalysis — 100 completed tasks', () => {
  const t = new TaskTracker();
  t.addTasksBulk(Array.from({ length: 100 }, (_, i) => ({ title: `Task ${i + 1}` })));
  for (let i = 1; i <= 100; i++) {
    t.updateTask({ task_id: `T${i}`, status: 'completed', finding: 'done' });
  }
  t.concludeAnalysis();
});

// ── Memory spot-check (runs once, not part of the suite timing) ─────────────

const memBefore = process.memoryUsage().heapUsed;
const memTracker = new TaskTracker();
memTracker.addTasksBulk(
  Array.from({ length: 1000 }, (_, i) => ({
    title: `Memory Task ${i + 1}`,
    depends_on: i > 0 && Math.random() > 0.8 ? [`T${Math.floor(Math.random() * i) + 1}`] : [],
  }))
);
const memAfter = process.memoryUsage().heapUsed;
console.log(`Memory for 1000-task DAG: ${((memAfter - memBefore) / 1024 / 1024).toFixed(2)} MB\n`);

// ── Run ─────────────────────────────────────────────────────────────────────

suite
  .on('cycle', (event: any) => {
    console.log(String(event.target));
  })
  .on('complete', function (this: any) {
    console.log('\nFastest: ' + this.filter('fastest').map('name'));
    console.log('Slowest: ' + this.filter('slowest').map('name'));

    console.log('\nPerformance analysis:');
    (this as any).forEach((b: any) => {
      const ops = b.hz;
      const label =
        ops >= 10_000 ? 'excellent' :
        ops >= 1_000  ? 'good' :
        ops >= 100    ? 'acceptable' : 'slow — consider optimising';
      console.log(`  ${b.name}: ${ops.toFixed(0).padStart(10)} ops/sec  [${label}]`);
    });
  })
  .run({ async: false });
