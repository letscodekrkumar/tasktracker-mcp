/**
 * Example scenarios demonstrating TaskTracker MCP Server usage
 * This file shows typical investigation workflows
 */

import { TaskTracker } from './tracker.js';

/**
 * Example 1: Bug Investigation Workflow
 * A simple bug investigation with task dependencies
 */
function exampleBugInvestigation() {
  console.log('\n=== Example 1: Bug Investigation ===\n');

  const tracker = new TaskTracker();

  // Start with complete task plan
  const result1 = tracker.addTasksBulk([
    {
      title: 'FETCH bug details from ticket system',
      category: 'log_check',
      priority: 'high',
    },
    {
      title: 'EXTRACT machine ID and build version from bug description',
      category: 'log_check',
      priority: 'high',
    },
    {
      title: 'FETCH run.log for extracted machine — search for ERROR or TIMEOUT',
      category: 'log_check',
      priority: 'high',
      depends_on: ['T2'],
    },
    {
      title: 'FETCH system.log and correlate with run.log findings',
      category: 'log_check',
      priority: 'medium',
      depends_on: ['T2', 'T3'],
    },
    {
      title: 'IDENTIFY root cause from all evidence',
      category: 'root_cause',
      priority: 'high',
      depends_on: ['T3', 'T4'],
    },
  ]);

  console.log(result1);

  // Execute tasks
  let ready = tracker.getReadyTasks();
  console.log(`\nReady to execute: ${ready.map(t => t.id).join(', ')}`);

  // Resolve T1
  const t1_result = tracker.updateTask({
    task_id: 'T1',
    status: 'completed',
    finding:
      'Bug filed 2026-03-28. Build: 4.2.1-rc3. Machine: X200-lot-7. Reported by: alice@company.com.',
  });
  console.log('\nT1 resolved:\n' + t1_result);

  // Resolve T2
  const t2_result = tracker.updateTask({
    task_id: 'T2',
    status: 'completed',
    finding: 'Machine ID: X200-lot-7. Build version: 4.2.1-rc3 (from build timestamp).',
  });
  console.log('\nT2 resolved:\n' + t2_result);

  // Now T3 and T4 become ready
  ready = tracker.getReadyTasks();
  console.log(`\nNow ready: ${ready.map(t => t.id).join(', ')}`);

  // Resolve T3
  const t3_result = tracker.updateTask({
    task_id: 'T3',
    status: 'completed',
    finding: JSON.stringify({
      evidence_type: 'log',
      summary: '3 TIMEOUT errors found in 90-second window post job start',
      confidence: 'high',
      raw_refs: ['run.log:842', 'run.log:891', 'run.log:934'],
      note: 'All errors occur after the retry loop initiates',
    }),
  });
  console.log('\nT3 resolved:\n' + t3_result);

  // Resolve T4
  const t4_result = tracker.updateTask({
    task_id: 'T4',
    status: 'completed',
    finding:
      'system.log shows ERROR_TIMEOUT at same timestamps as run.log. Confirms correlation between job retry logic and system-level timeouts.',
  });
  console.log('\nT4 resolved:\n' + t4_result);

  // Now T5 becomes ready
  ready = tracker.getReadyTasks();
  console.log(`\nNow ready: ${ready.map(t => t.id).join(', ')}`);

  // Resolve T5 - final conclusion
  const t5_result = tracker.updateTask({
    task_id: 'T5',
    status: 'completed',
    finding:
      'Root cause: Retry loop in RequestHandler.cs:89 triggers on first TIMEOUT, causing cascading failures. Cascades across system triggering ERROR_TIMEOUT in system.log.',
  });
  console.log('\nT5 resolved:\n' + t5_result);

  // Conclude
  const conclusion = tracker.concludeAnalysis();
  console.log('\nAnalysis concluded:\n' + conclusion);
}

/**
 * Example 2: Mid-investigation discovery
 * Shows adding tasks and rewiring dependencies mid-investigation
 */
function exampleMidInvestigeryDiscovery() {
  console.log('\n\n=== Example 2: Mid-Investigation Discovery ===\n');

  const tracker = new TaskTracker();

  // Initial plan
  tracker.addTasksBulk([
    {
      title: 'FETCH logs from production',
      category: 'log_check',
      priority: 'high',
    },
    {
      title: 'ANALYZE error patterns',
      category: 'log_check',
      priority: 'high',
      depends_on: ['T1'],
    },
  ]);

  const ready1 = tracker.getReadyTasks();
  console.log(`Initial ready: ${ready1.map(t => t.id).join(', ')}`);

  // Start T1
  tracker.updateTask({
    task_id: 'T1',
    status: 'in_progress',
    finding: 'Intent: Fetching last 24h of logs from production cluster',
  });

  // While working on T1, discover we need to verify log access first
  const addResult = tracker.addTask({
    title: 'VERIFY archive server credentials before fetching logs',
    category: 'config_verify',
    priority: 'high',
  });
  console.log('\nNew task discovered:\n' + addResult);

  // Update T1 to depend on the new credential check
  // First mark T1 as pending to allow dependency updates
  tracker.updateTask({
    task_id: 'T1',
    status: 'pending',
  });
  const updateResult = tracker.updateTask({
    task_id: 'T1',
    depends_on: ['T3'],
  });
  console.log('\nT1 deps updated:\n' + updateResult);

  // Mark T1 as pending again (was in_progress)
  // Note: in real usage, agent would handle the status appropriately
  console.log('\nT1 is now waiting on T3 credentials check');

  // Resolve T3
  tracker.updateTask({
    task_id: 'T3',
    status: 'completed',
    finding: 'Credentials verified. Access provisioned for X200 machine.',
  });

  console.log('\nT3 resolved. T1 should now be ready to execute from pending state.');
}

/**
 * Example 3: Blocked and reopened tasks
 * Shows how blocked tasks can be reopened
 */
function exampleBlockedAndReopened() {
  console.log('\n\n=== Example 3: Blocked and Reopened Tasks ===\n');

  const tracker = new TaskTracker();

  tracker.addTask({
    title: 'FETCH source code at specific commit',
    category: 'log_check',
    priority: 'high',
  });

  console.log('Initial state:');
  let all = tracker.getAllTasks();
  console.log(`  Task T1: status=${all.tasks[0].status}`);

  // Work and hit a blocker
  tracker.updateTask({
    task_id: 'T1',
    status: 'in_progress',
    finding: 'Attempting to fetch commit a3f9c12...',
  });

  tracker.updateTask({
    task_id: 'T1',
    status: 'blocked',
    finding: 'Commit SHA a3f9c12 not found in repo. Mirror sync pending.',
  });

  console.log('\nTask blocked:');
  all = tracker.getAllTasks();
  console.log(`  Task T1: status=${all.tasks[0].status}, finding="${all.tasks[0].finding}"`);

  // Later, blocker is resolved externally
  const reopenResult = tracker.reopenTask(
    'T1',
    'Mirror repo synced — commit SHA a3f9c12 is now available'
  );
  console.log('\nTask reopened:\n' + reopenResult);

  all = tracker.getAllTasks();
  console.log(`  Task T1: status=${all.tasks[0].status}, finding=${all.tasks[0].finding === null}`);
  console.log(`  Finding history preserved: ${all.tasks[0].finding_history.length} entry`);

  // Resolve now that blocker is gone
  tracker.updateTask({
    task_id: 'T1',
    status: 'completed',
    finding:
      'Source fetched at commit a3f9c12. RequestHandler.cs:89 confirmed as retry loop origin.',
  });

  const conclusion = tracker.concludeAnalysis();
  console.log('\nFinal conclusion:\n' + conclusion);
}

/**
 * Example 4: Error handling - Circular dependencies
 */
function exampleCircularDependencyDetection() {
  console.log('\n\n=== Example 4: Circular Dependency Detection ===\n');

  const tracker = new TaskTracker();

  try {
    tracker.addTasksBulk([
      {
        title: 'Task A',
        depends_on: ['T2'],
      },
      {
        title: 'Task B',
        depends_on: ['T1'],
      },
    ]);
    console.log('ERROR: Circular dependency not detected!');
  } catch (error) {
    console.log('✓ Circular dependency correctly caught:\n  ' + (error as Error).message);
  }
}

/**
 * Example 5: Error handling - Invalid status transitions
 */
function exampleInvalidStatusTransitions() {
  console.log('\n\n=== Example 5: Invalid Status Transitions ===\n');

  const tracker = new TaskTracker();

  tracker.addTask({
    title: 'Test task',
  });

  // Complete the task
  tracker.updateTask({
    task_id: 'T1',
    status: 'completed',
    finding: 'Done',
  });

  // Try to transition completed → pending (should fail)
  try {
    tracker.updateTask({
      task_id: 'T1',
      status: 'in_progress',
    });
    console.log('ERROR: Invalid transition not caught!');
  } catch (error) {
    console.log('✓ Invalid transition correctly rejected:\n  ' + (error as Error).message);
  }
}

/**
 * Run all examples
 */
function main() {
  console.log('TaskTracker MCP Server - Usage Examples');
  console.log('======================================');

  exampleBugInvestigation();
  exampleMidInvestigeryDiscovery();
  exampleBlockedAndReopened();
  exampleCircularDependencyDetection();
  exampleInvalidStatusTransitions();

  console.log('\n\n✓ All examples completed successfully!');
}

main();
