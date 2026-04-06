import { TaskTracker } from '../tracker.js';
import { TaskStatus, TaskCategory, TaskPriority } from '../types.js';

describe('TaskTracker', () => {
  let tracker: TaskTracker;

  beforeEach(() => {
    tracker = new TaskTracker();
  });

  // ---------------------------------------------------------------------------
  // addTask
  // ---------------------------------------------------------------------------
  describe('addTask', () => {
    describe('validation', () => {
      it('rejects empty title', () => {
        expect(() => tracker.addTask({ title: '' })).toThrow('Title cannot be empty');
      });

      it('rejects whitespace-only title', () => {
        expect(() => tracker.addTask({ title: '   ' })).toThrow('Title cannot be empty');
      });

      it('rejects title exceeding 200 characters', () => {
        expect(() => tracker.addTask({ title: 'a'.repeat(201) })).toThrow(
          'Title exceeds 200 characters'
        );
      });

      it('accepts title of exactly 200 characters', () => {
        expect(() => tracker.addTask({ title: 'a'.repeat(200) })).not.toThrow();
      });

      it('rejects invalid category', () => {
        expect(() =>
          tracker.addTask({ title: 'T', category: 'invalid' as TaskCategory })
        ).toThrow("Invalid category 'invalid'");
      });

      it('rejects invalid priority', () => {
        expect(() =>
          tracker.addTask({ title: 'T', priority: 'critical' as TaskPriority })
        ).toThrow("Invalid priority 'critical'");
      });

      it('rejects non-existent dependency', () => {
        expect(() => tracker.addTask({ title: 'T', depends_on: ['T999'] })).toThrow(
          "Unknown task IDs in depends_on: ['T999']"
        );
      });

      it('rejects multiple non-existent dependencies', () => {
        expect(() =>
          tracker.addTask({ title: 'T', depends_on: ['T1', 'T2'] })
        ).toThrow('Unknown task IDs in depends_on');
      });
    });

    describe('happy path', () => {
      it('adds task with default category and priority', () => {
        const result = tracker.addTask({ title: 'Test Task' });
        expect(result).toContain('Task T1 added');
        expect(result).toContain('Status: pending');
        expect(result).toContain("Ready now: ['T1']");
      });

      it('accepts all valid categories', () => {
        const categories: TaskCategory[] = [
          'log_check', 'config_verify', 'root_cause', 'comparison', 'reproduce', 'general',
        ];
        categories.forEach((category, i) => {
          const result = tracker.addTask({ title: `Task ${i}`, category });
          expect(result).toContain(`Task T${i + 1} added`);
        });
      });

      it('accepts all valid priorities', () => {
        const priorities: TaskPriority[] = ['high', 'medium', 'low'];
        priorities.forEach((priority, i) => {
          const result = tracker.addTask({ title: `Task ${i}`, priority });
          expect(result).toContain(`Task T${i + 1} added`);
        });
      });

      it('assigns IDs sequentially', () => {
        tracker.addTask({ title: 'A' });
        tracker.addTask({ title: 'B' });
        tracker.addTask({ title: 'C' });
        const snap = tracker.getAllTasks();
        expect(snap.tasks.map(t => t.id)).toEqual(['T1', 'T2', 'T3']);
      });

      it('adds task with a single dependency', () => {
        tracker.addTask({ title: 'T1' });
        const result = tracker.addTask({ title: 'T2', depends_on: ['T1'] });
        expect(result).toContain('Task T2 added');
        expect(result).toContain('Dependencies: [T1]');
      });

      it('adds task with multiple dependencies', () => {
        tracker.addTask({ title: 'T1' });
        tracker.addTask({ title: 'T2' });
        const result = tracker.addTask({ title: 'T3', depends_on: ['T1', 'T2'] });
        expect(result).toContain('Task T3 added');
        expect(result).toContain('Dependencies: [T1, T2]');
      });

      it('dependent task is not in ready list until deps resolve', () => {
        tracker.addTask({ title: 'T1' });
        const result = tracker.addTask({ title: 'T2', depends_on: ['T1'] });
        expect(result).toContain("Ready now: ['T1']");
        expect(result).not.toContain("'T2'");
      });
    });
  });

  // ---------------------------------------------------------------------------
  // addTasksBulk
  // ---------------------------------------------------------------------------
  describe('addTasksBulk', () => {
    describe('validation', () => {
      it('rejects empty array', () => {
        expect(() => tracker.addTasksBulk([])).toThrow('Tasks array cannot be empty');
      });

      it('rejects batch containing empty title', () => {
        expect(() =>
          tracker.addTasksBulk([{ title: 'Valid' }, { title: '' }, { title: 'Also Valid' }])
        ).toThrow('Batch rejected — 1 error(s) found. No tasks inserted.');
      });

      it('rejects batch containing title over 200 chars', () => {
        expect(() =>
          tracker.addTasksBulk([{ title: 'a'.repeat(201) }])
        ).toThrow('Batch rejected');
      });

      it('rejects batch containing invalid category', () => {
        expect(() =>
          tracker.addTasksBulk([{ title: 'T', category: 'bad' as TaskCategory }])
        ).toThrow('Batch rejected');
      });

      it('rejects batch containing invalid priority', () => {
        expect(() =>
          tracker.addTasksBulk([{ title: 'T', priority: 'urgent' as TaskPriority }])
        ).toThrow('Batch rejected');
      });

      it('collects all errors before rejecting', () => {
        expect(() =>
          tracker.addTasksBulk([
            { title: '' },
            { title: 'a'.repeat(201) },
            { title: 'T', category: 'bad' as TaskCategory },
          ])
        ).toThrow('3 error(s) found');
      });

      it('is atomic — no tasks committed on any error', () => {
        expect(() =>
          tracker.addTasksBulk([{ title: 'Good' }, { title: '' }])
        ).toThrow();
        expect(tracker.getAllTasks().tasks).toHaveLength(0);
      });

      it('rejects forward references (unknown task IDs)', () => {
        expect(() =>
          tracker.addTasksBulk([
            { title: 'Task 1', depends_on: ['T2'] },
            { title: 'Task 2', depends_on: ['T1'] },
          ])
        ).toThrow(/Batch rejected/);
      });
    });

    describe('happy path', () => {
      it('adds a single task', () => {
        const result = tracker.addTasksBulk([{ title: 'Solo' }]);
        expect(result).toContain('1 tasks added.');
      });

      it('adds multiple tasks with dependencies', () => {
        const result = tracker.addTasksBulk([
          { title: 'T1' },
          { title: 'T2', depends_on: ['T1'] },
          { title: 'T3', depends_on: ['T1'] },
        ]);
        expect(result).toContain('3 tasks added.');
      });

      it('can reference existing committed tasks as deps', () => {
        tracker.addTask({ title: 'Existing' });
        const result = tracker.addTasksBulk([
          { title: 'New Task', depends_on: ['T1'] },
        ]);
        expect(result).toContain('1 tasks added.');
      });

      it('includes execution plan in response', () => {
        const result = tracker.addTasksBulk([
          { title: 'High', priority: 'high' },
          { title: 'Low', priority: 'low' },
        ]);
        expect(result).toContain('Execution plan');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // updateTask
  // ---------------------------------------------------------------------------
  describe('updateTask', () => {
    beforeEach(() => {
      tracker.addTask({ title: 'Task 1' });
    });

    describe('validation', () => {
      it('throws for non-existent task', () => {
        expect(() => tracker.updateTask({ task_id: 'T999', status: 'in_progress' })).toThrow(
          "Task 'T999' does not exist"
        );
      });

      it('throws for invalid status', () => {
        expect(() =>
          tracker.updateTask({ task_id: 'T1', status: 'exploded' as TaskStatus })
        ).toThrow("Invalid status 'exploded'");
      });

      it('throws when no fields are provided', () => {
        expect(() => tracker.updateTask({ task_id: 'T1' })).toThrow(
          'No status, finding, or depends_on provided'
        );
      });

      it('requires finding for completed', () => {
        expect(() =>
          tracker.updateTask({ task_id: 'T1', status: 'completed' })
        ).toThrow("Finding required for status 'completed'");
      });

      it('requires finding for skipped', () => {
        expect(() =>
          tracker.updateTask({ task_id: 'T1', status: 'skipped' })
        ).toThrow("Finding required for status 'skipped'");
      });

      it('requires finding for blocked', () => {
        expect(() =>
          tracker.updateTask({ task_id: 'T1', status: 'blocked' })
        ).toThrow("Finding required for status 'blocked'");
      });

      it('rejects empty-string finding for completed', () => {
        expect(() =>
          tracker.updateTask({ task_id: 'T1', status: 'completed', finding: '   ' })
        ).toThrow("Finding required for status 'completed'");
      });

      it('blocks completion when dependency is unresolved', () => {
        tracker.addTask({ title: 'Task 2', depends_on: ['T1'] });
        expect(() =>
          tracker.updateTask({ task_id: 'T2', status: 'completed', finding: 'done' })
        ).toThrow('BLOCKED: Task T2 depends on unresolved tasks');
      });

      it('prevents transition out of completed', () => {
        tracker.updateTask({ task_id: 'T1', status: 'completed', finding: 'done' });
        expect(() =>
          tracker.updateTask({ task_id: 'T1', status: 'in_progress' })
        ).toThrow('already completed');
      });

      it('prevents transition out of skipped', () => {
        tracker.updateTask({ task_id: 'T1', status: 'skipped', finding: 'not needed' });
        expect(() =>
          tracker.updateTask({ task_id: 'T1', status: 'in_progress' })
        ).toThrow('already skipped');
      });

      it('prevents transition out of blocked (must use reopenTask)', () => {
        tracker.updateTask({ task_id: 'T1', status: 'blocked', finding: 'stuck' });
        expect(() =>
          tracker.updateTask({ task_id: 'T1', status: 'in_progress' })
        ).toThrow('already blocked');
      });
    });

    describe('status transitions', () => {
      it('pending → in_progress (no finding required)', () => {
        const result = tracker.updateTask({ task_id: 'T1', status: 'in_progress' });
        expect(result).toContain('Task T1 → in_progress');
      });

      it('pending → completed with finding', () => {
        const result = tracker.updateTask({
          task_id: 'T1',
          status: 'completed',
          finding: 'Root cause identified',
        });
        expect(result).toContain('Task T1 → completed');
      });

      it('in_progress → completed with finding', () => {
        tracker.updateTask({ task_id: 'T1', status: 'in_progress' });
        const result = tracker.updateTask({
          task_id: 'T1',
          status: 'completed',
          finding: 'Done',
        });
        expect(result).toContain('Task T1 → completed');
      });

      it('pending → skipped with finding', () => {
        const result = tracker.updateTask({
          task_id: 'T1',
          status: 'skipped',
          finding: 'Not needed',
        });
        expect(result).toContain('Task T1 → skipped');
      });

      it('pending → blocked with finding', () => {
        const result = tracker.updateTask({
          task_id: 'T1',
          status: 'blocked',
          finding: 'Waiting on external team',
        });
        expect(result).toContain('Task T1 → blocked');
      });

      it('response includes progress and remaining stats', () => {
        const result = tracker.updateTask({
          task_id: 'T1',
          status: 'completed',
          finding: 'done',
        });
        expect(result).toContain('Progress:');
        expect(result).toContain('Remaining:');
      });

      it('response lists newly unblocked tasks', () => {
        tracker.addTask({ title: 'Task 2', depends_on: ['T1'] });
        const result = tracker.updateTask({
          task_id: 'T1',
          status: 'completed',
          finding: 'done',
        });
        expect(result).toContain("Unlocked: ['T2']");
      });
    });

    describe('finding-only update', () => {
      it('updates finding without changing status', () => {
        const result = tracker.updateTask({ task_id: 'T1', finding: 'Partial finding' });
        expect(result).toContain('finding updated');
        const snap = tracker.getAllTasks();
        expect(snap.tasks[0].status).toBe('pending');
        expect(snap.tasks[0].finding).toBe('Partial finding');
      });
    });

    describe('dependency rewiring', () => {
      it('updates deps on a pending task', () => {
        tracker.addTask({ title: 'Task 2' });
        const result = tracker.updateTask({ task_id: 'T1', depends_on: ['T2'] });
        expect(result).toContain("T1 deps updated → ['T2']");
      });

      it('rejects dep update on non-pending task', () => {
        tracker.updateTask({ task_id: 'T1', status: 'in_progress' });
        expect(() =>
          tracker.updateTask({ task_id: 'T1', depends_on: [] })
        ).toThrow('Cannot update depends_on');
      });

      it('rejects unknown dep IDs', () => {
        expect(() =>
          tracker.updateTask({ task_id: 'T1', depends_on: ['T999'] })
        ).toThrow('Unknown task IDs in depends_on');
      });

      it('detects circular dependency via updateTask', () => {
        tracker.addTask({ title: 'Task 2', depends_on: ['T1'] });
        expect(() =>
          tracker.updateTask({ task_id: 'T1', depends_on: ['T2'] })
        ).toThrow('Circular dependency detected');
      });

      it('detects longer circular chain (T1→T2→T3→T1)', () => {
        tracker.addTask({ title: 'T2', depends_on: ['T1'] });
        tracker.addTask({ title: 'T3', depends_on: ['T2'] });
        expect(() =>
          tracker.updateTask({ task_id: 'T1', depends_on: ['T3'] })
        ).toThrow('Circular dependency detected');
      });

      it('allows valid dep rewiring (no cycle)', () => {
        tracker.addTask({ title: 'T2' });
        tracker.addTask({ title: 'T3', depends_on: ['T2'] });
        expect(() =>
          tracker.updateTask({ task_id: 'T1', depends_on: ['T2'] })
        ).not.toThrow();
      });
    });
  });

  // ---------------------------------------------------------------------------
  // getReadyTasks
  // ---------------------------------------------------------------------------
  describe('getReadyTasks', () => {
    it('returns empty list when tracker is empty', () => {
      expect(tracker.getReadyTasks()).toHaveLength(0);
    });

    it('returns task with no deps as ready', () => {
      tracker.addTask({ title: 'T1' });
      const ready = tracker.getReadyTasks();
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe('T1');
    });

    it('does not return task with unresolved dep', () => {
      tracker.addTask({ title: 'T1' });
      tracker.addTask({ title: 'T2', depends_on: ['T1'] });
      const ready = tracker.getReadyTasks();
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe('T1');
    });

    it('returns dependent task when dep is completed', () => {
      tracker.addTask({ title: 'T1' });
      tracker.addTask({ title: 'T2', depends_on: ['T1'] });
      tracker.updateTask({ task_id: 'T1', status: 'completed', finding: 'done' });
      const ready = tracker.getReadyTasks();
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe('T2');
    });

    it('returns dependent task when dep is skipped', () => {
      tracker.addTask({ title: 'T1' });
      tracker.addTask({ title: 'T2', depends_on: ['T1'] });
      tracker.updateTask({ task_id: 'T1', status: 'skipped', finding: 'not needed' });
      const ready = tracker.getReadyTasks();
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe('T2');
    });

    it('returns dependent task when dep is blocked (blocked counts as resolved)', () => {
      tracker.addTask({ title: 'T1' });
      tracker.addTask({ title: 'T2', depends_on: ['T1'] });
      tracker.updateTask({ task_id: 'T1', status: 'blocked', finding: 'stuck' });
      const ready = tracker.getReadyTasks();
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe('T2');
    });

    it('does NOT unblock dependent when dep is only in_progress', () => {
      tracker.addTask({ title: 'T1' });
      tracker.addTask({ title: 'T2', depends_on: ['T1'] });
      tracker.updateTask({ task_id: 'T1', status: 'in_progress' });
      const ready = tracker.getReadyTasks();
      expect(ready).toHaveLength(0);
    });

    it('only unblocks when ALL deps are resolved (multi-dep)', () => {
      tracker.addTask({ title: 'T1' });
      tracker.addTask({ title: 'T2' });
      tracker.addTask({ title: 'T3', depends_on: ['T1', 'T2'] });
      tracker.updateTask({ task_id: 'T1', status: 'completed', finding: 'done' });
      // T2 still pending → T3 still blocked
      expect(tracker.getReadyTasks().map(t => t.id)).toEqual(['T2']);
      tracker.updateTask({ task_id: 'T2', status: 'completed', finding: 'done' });
      // Both resolved → T3 now ready
      expect(tracker.getReadyTasks().map(t => t.id)).toEqual(['T3']);
    });

    it('sorts results by priority: high → medium → low', () => {
      tracker.addTask({ title: 'Low', priority: 'low' });
      tracker.addTask({ title: 'High', priority: 'high' });
      tracker.addTask({ title: 'Med', priority: 'medium' });
      const ready = tracker.getReadyTasks();
      expect(ready.map(t => t.priority)).toEqual(['high', 'medium', 'low']);
    });

    it('does not return in_progress tasks', () => {
      tracker.addTask({ title: 'T1' });
      tracker.updateTask({ task_id: 'T1', status: 'in_progress' });
      expect(tracker.getReadyTasks()).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // getAllTasks
  // ---------------------------------------------------------------------------
  describe('getAllTasks', () => {
    it('returns empty snapshot when tracker is empty', () => {
      const snap = tracker.getAllTasks();
      expect(snap.tasks).toHaveLength(0);
      expect(snap.ready).toBe(0);
      expect(snap.waiting).toBe(0);
      expect(snap.in_progress).toBe(0);
      expect(snap.progress).toContain('0/0');
      expect(snap.progress).not.toContain('NaN');
    });

    it('returns correct counts for mixed state', () => {
      tracker.addTask({ title: 'T1' });
      tracker.addTask({ title: 'T2', depends_on: ['T1'] });
      tracker.updateTask({ task_id: 'T1', status: 'in_progress' });

      const snap = tracker.getAllTasks();
      expect(snap.ready).toBe(0);
      expect(snap.waiting).toBe(1);
      expect(snap.in_progress).toBe(1);
      expect(snap.tasks).toHaveLength(2);
    });

    it('returns tasks sorted by numeric ID', () => {
      tracker.addTask({ title: 'A' });
      tracker.addTask({ title: 'B' });
      tracker.addTask({ title: 'C' });
      const snap = tracker.getAllTasks();
      expect(snap.tasks.map(t => t.id)).toEqual(['T1', 'T2', 'T3']);
    });

    it('shows progress percentage correctly', () => {
      tracker.addTask({ title: 'T1' });
      tracker.addTask({ title: 'T2' });
      tracker.updateTask({ task_id: 'T1', status: 'completed', finding: 'done' });
      const snap = tracker.getAllTasks();
      expect(snap.progress).toContain('1/2');
      expect(snap.progress).toContain('50%');
    });
  });

  // ---------------------------------------------------------------------------
  // concludeAnalysis
  // ---------------------------------------------------------------------------
  describe('concludeAnalysis', () => {
    it('concludes when all tasks are completed', () => {
      tracker.addTask({ title: 'T1' });
      tracker.addTask({ title: 'T2', depends_on: ['T1'] });
      tracker.updateTask({ task_id: 'T1', status: 'completed', finding: 'done' });
      tracker.updateTask({ task_id: 'T2', status: 'completed', finding: 'done' });
      const result = tracker.concludeAnalysis();
      expect(result).toContain('Analysis complete');
      expect(result).toContain('2 task(s) resolved');
    });

    it('concludes when all tasks are skipped', () => {
      tracker.addTask({ title: 'T1' });
      tracker.updateTask({ task_id: 'T1', status: 'skipped', finding: 'not needed' });
      expect(tracker.concludeAnalysis()).toContain('Analysis complete');
    });

    it('concludes when all tasks are blocked', () => {
      tracker.addTask({ title: 'T1' });
      tracker.updateTask({ task_id: 'T1', status: 'blocked', finding: 'stuck' });
      expect(tracker.concludeAnalysis()).toContain('Analysis complete');
    });

    it('concludes with mixed completed/skipped/blocked', () => {
      tracker.addTask({ title: 'T1' });
      tracker.addTask({ title: 'T2' });
      tracker.addTask({ title: 'T3' });
      tracker.updateTask({ task_id: 'T1', status: 'completed', finding: 'done' });
      tracker.updateTask({ task_id: 'T2', status: 'skipped', finding: 'N/A' });
      tracker.updateTask({ task_id: 'T3', status: 'blocked', finding: 'stuck' });
      const result = tracker.concludeAnalysis();
      expect(result).toContain('Analysis complete');
      expect(result).toContain('3 task(s) resolved');
      expect(result).toContain('1 completed');
      expect(result).toContain('1 skipped');
      expect(result).toContain('1 blocked');
    });

    it('blocks conclusion when a task is still pending', () => {
      tracker.addTask({ title: 'T1' });
      tracker.addTask({ title: 'T2' });
      tracker.updateTask({ task_id: 'T1', status: 'completed', finding: 'done' });
      const result = tracker.concludeAnalysis();
      expect(result).toContain('CANNOT CONCLUDE');
      expect(result).toContain('1 task(s) still unresolved');
    });

    it('blocks conclusion when a task is in_progress', () => {
      tracker.addTask({ title: 'T1' });
      tracker.updateTask({ task_id: 'T1', status: 'in_progress' });
      const result = tracker.concludeAnalysis();
      expect(result).toContain('CANNOT CONCLUDE');
    });

    it('blocks conclusion with both pending and in_progress tasks', () => {
      tracker.addTask({ title: 'T1' });
      tracker.addTask({ title: 'T2' });
      tracker.updateTask({ task_id: 'T1', status: 'in_progress' });
      const result = tracker.concludeAnalysis();
      expect(result).toContain('CANNOT CONCLUDE');
      expect(result).toContain('2 task(s) still unresolved');
    });

    it('concludes on empty tracker', () => {
      const result = tracker.concludeAnalysis();
      expect(result).toContain('Analysis complete');
    });

    it('instructs what to do next in cannot-conclude response', () => {
      tracker.addTask({ title: 'T1' });
      const result = tracker.concludeAnalysis();
      expect(result).toContain('DO THIS NEXT');
      expect(result).toContain('conclude_analysis()');
    });
  });

  // ---------------------------------------------------------------------------
  // reopenTask
  // ---------------------------------------------------------------------------
  describe('reopenTask', () => {
    beforeEach(() => {
      tracker.addTask({ title: 'Task 1' });
    });

    describe('validation', () => {
      it('throws for non-existent task', () => {
        expect(() => tracker.reopenTask('T999', 'reason')).toThrow(
          "Task 'T999' does not exist"
        );
      });

      it('throws when task is not blocked (pending)', () => {
        expect(() => tracker.reopenTask('T1', 'reason')).toThrow(
          "cannot be reopened — status is 'pending', not 'blocked'"
        );
      });

      it('throws when task is completed', () => {
        tracker.updateTask({ task_id: 'T1', status: 'completed', finding: 'done' });
        expect(() => tracker.reopenTask('T1', 'reason')).toThrow('cannot be reopened');
      });

      it('throws when task is in_progress', () => {
        tracker.updateTask({ task_id: 'T1', status: 'in_progress' });
        expect(() => tracker.reopenTask('T1', 'reason')).toThrow('cannot be reopened');
      });

      it('throws for empty reason', () => {
        tracker.updateTask({ task_id: 'T1', status: 'blocked', finding: 'stuck' });
        expect(() => tracker.reopenTask('T1', '')).toThrow('reason cannot be empty');
      });

      it('throws for whitespace-only reason', () => {
        tracker.updateTask({ task_id: 'T1', status: 'blocked', finding: 'stuck' });
        expect(() => tracker.reopenTask('T1', '   ')).toThrow('reason cannot be empty');
      });
    });

    describe('happy path', () => {
      beforeEach(() => {
        tracker.updateTask({ task_id: 'T1', status: 'blocked', finding: 'Blocked by X' });
      });

      it('reopens blocked task to pending', () => {
        tracker.reopenTask('T1', 'X is resolved');
        const snap = tracker.getAllTasks();
        expect(snap.tasks[0].status).toBe('pending');
      });

      it('response contains task ID and reason', () => {
        const result = tracker.reopenTask('T1', 'X is resolved');
        expect(result).toContain('Task T1 reopened');
        expect(result).toContain('Reason: X is resolved');
      });

      it('preserves original finding in finding_history', () => {
        tracker.reopenTask('T1', 'X is resolved');
        const snap = tracker.getAllTasks();
        expect(snap.tasks[0].finding_history).toContain('Blocked by X');
        expect(snap.tasks[0].finding).toBeNull();
      });

      it('increments reopen_count', () => {
        tracker.reopenTask('T1', 'first reopen');
        tracker.updateTask({ task_id: 'T1', status: 'blocked', finding: 'blocked again' });
        tracker.reopenTask('T1', 'second reopen');
        const snap = tracker.getAllTasks();
        expect(snap.tasks[0].reopen_count).toBe(2);
      });

      it('reopened task with no deps is ready', () => {
        tracker.reopenTask('T1', 'X is resolved');
        expect(tracker.getReadyTasks().map(t => t.id)).toContain('T1');
      });

      it('reopened task with unresolved dep is waiting', () => {
        tracker.addTask({ title: 'T2' });
        tracker.addTask({ title: 'T3', depends_on: ['T2'] });
        tracker.updateTask({ task_id: 'T3', status: 'blocked', finding: 'stuck' });
        tracker.reopenTask('T3', 'unblocked');
        const ready = tracker.getReadyTasks();
        expect(ready.map(t => t.id)).not.toContain('T3');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // reset
  // ---------------------------------------------------------------------------
  describe('reset', () => {
    it('clears all tasks and reports count', () => {
      tracker.addTask({ title: 'T1' });
      tracker.addTask({ title: 'T2' });
      const result = tracker.reset();
      expect(result).toContain('All 2 tasks cleared');
      expect(tracker.getAllTasks().tasks).toHaveLength(0);
    });

    it('resets the ID counter (new tasks start at T1)', () => {
      tracker.addTask({ title: 'Old T1' });
      tracker.reset();
      tracker.addTask({ title: 'New Task' });
      expect(tracker.getAllTasks().tasks[0].id).toBe('T1');
    });

    it('works on an empty tracker', () => {
      const result = tracker.reset();
      expect(result).toContain('All 0 tasks cleared');
    });
  });

  // ---------------------------------------------------------------------------
  // Integration
  // ---------------------------------------------------------------------------
  describe('Integration', () => {
    it('full linear workflow: add → execute in order → conclude', () => {
      tracker.addTasksBulk([
        { title: 'Fetch logs', category: 'log_check', priority: 'high' },
        { title: 'Parse logs', category: 'log_check', priority: 'high', depends_on: ['T1'] },
        { title: 'Identify root cause', category: 'root_cause', priority: 'high', depends_on: ['T2'] },
      ]);

      expect(tracker.getReadyTasks().map(t => t.id)).toEqual(['T1']);

      tracker.updateTask({ task_id: 'T1', status: 'completed', finding: 'Logs fetched' });
      expect(tracker.getReadyTasks().map(t => t.id)).toEqual(['T2']);

      tracker.updateTask({ task_id: 'T2', status: 'completed', finding: 'Parsed 1000 lines' });
      expect(tracker.getReadyTasks().map(t => t.id)).toEqual(['T3']);

      tracker.updateTask({ task_id: 'T3', status: 'completed', finding: 'Timeout in retry loop' });
      expect(tracker.concludeAnalysis()).toContain('Analysis complete');
    });

    it('diamond DAG: T3 and T4 both need T1 and T2', () => {
      tracker.addTask({ title: 'T1' });
      tracker.addTask({ title: 'T2' });
      tracker.addTask({ title: 'T3', depends_on: ['T1', 'T2'] });
      tracker.addTask({ title: 'T4', depends_on: ['T1', 'T2'] });

      tracker.updateTask({ task_id: 'T1', status: 'completed', finding: 'done' });
      expect(tracker.getReadyTasks().map(t => t.id)).toEqual(['T2']);

      tracker.updateTask({ task_id: 'T2', status: 'completed', finding: 'done' });
      const ready = tracker.getReadyTasks().map(t => t.id).sort();
      expect(ready).toEqual(['T3', 'T4']);
    });

    it('skipped dep unblocks downstream tasks', () => {
      tracker.addTask({ title: 'T1' });
      tracker.addTask({ title: 'T2', depends_on: ['T1'] });
      tracker.updateTask({ task_id: 'T1', status: 'skipped', finding: 'Not applicable' });
      expect(tracker.getReadyTasks().map(t => t.id)).toContain('T2');
    });

    it('conclude with pending tasks gives actionable instructions', () => {
      tracker.addTask({ title: 'T1' });
      tracker.addTask({ title: 'T2', depends_on: ['T1'] });
      const result = tracker.concludeAnalysis();
      expect(result).toContain('CANNOT CONCLUDE');
      expect(result).toContain('T1');
      expect(result).toContain('conclude_analysis()');
    });

    it('reopen → re-complete workflow', () => {
      tracker.addTask({ title: 'T1' });
      tracker.updateTask({ task_id: 'T1', status: 'blocked', finding: 'Need access' });
      tracker.reopenTask('T1', 'Access granted');

      const snap = tracker.getAllTasks();
      expect(snap.tasks[0].status).toBe('pending');

      tracker.updateTask({ task_id: 'T1', status: 'completed', finding: 'Completed after unblock' });
      expect(tracker.concludeAnalysis()).toContain('Analysis complete');
    });
  });
});
