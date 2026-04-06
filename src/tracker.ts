/**
 * TaskTracker - DAG-based task tracking implementation
 * Core engine with dependency validation, circular detection, and state management
 */

import {
  Task,
  TaskStatus,
  TaskCategory,
  TaskPriority,
  AddTaskInput,
  BulkTaskInput,
  UpdateTaskInput,
  DAGSnapshot,
  ReadyTask,
  isValidCategory,
  isValidPriority,
  isResolvedStatus,
  isValidStatus,
} from './types.js';

export class TaskTracker {
  private tasks: Map<string, Task> = new Map();
  private taskCounter: number = 0;
  private sessionStartTime: Date = new Date();

  /**
   * Add a single task with validation
   */
  addTask(input: AddTaskInput): string {
    const category = input.category || 'general';
    const priority = input.priority || 'medium';
    const depends_on = input.depends_on || [];

    // Validate inputs
    if (!input.title || input.title.trim().length === 0) {
      throw new Error('Title cannot be empty');
    }
    if (input.title.length > 200) {
      throw new Error('Title exceeds 200 characters');
    }
    if (!isValidCategory(category)) {
      throw new Error(
        `Invalid category '${category}' — must be one of: log_check, config_verify, root_cause, comparison, reproduce, general`
      );
    }
    if (!isValidPriority(priority)) {
      throw new Error(`Invalid priority '${priority}' — must be one of: high, medium, low`);
    }

    // Validate dependencies exist
    const missingIds = depends_on.filter(id => !this.tasks.has(id));
    if (missingIds.length > 0) {
      throw new Error(
        `Unknown task IDs in depends_on: [${missingIds.map(id => `'${id}'`).join(', ')}] — task does not exist`
      );
    }

    // Check for circular dependencies
    if (this.wouldCreateCycle(depends_on, null)) {
      throw new Error(`Circular dependency detected`);
    }

    // Create new task
    this.taskCounter++;
    const taskId = `T${this.taskCounter}`;
    const now = new Date().toISOString();

    const task: Task = {
      id: taskId,
      title: input.title,
      category,
      priority,
      status: 'pending',
      finding: null,
      finding_history: [],
      depends_on,
      unmet_deps: this.calculateUnmetDeps(depends_on),
      created: now,
      resolved_at: null,
      reopen_count: 0,
    };

    this.tasks.set(taskId, task);

    // Return response with ready queue
    const readyTasks = this.getReadyTasks();
    const readyIds = readyTasks.map(t => t.id);

    return (
      `Task ${taskId} added. Dependencies: [${depends_on.join(', ')}]. Status: pending.\n` +
      `Ready now: [${readyIds.map(id => `'${id}'`).join(', ')}]`
    );
  }

  /**
   * Add multiple tasks atomically
   */
  addTasksBulk(tasks: BulkTaskInput[]): string {
    if (!tasks || tasks.length === 0) {
      throw new Error('Tasks array cannot be empty');
    }

    // Validate all tasks before inserting any
    const errors: string[] = [];
    const tempTaskMap = new Map(this.tasks);
    const newTaskIds: string[] = [];
    let tempCounter = this.taskCounter;

    for (let i = 0; i < tasks.length; i++) {
      const input = tasks[i];
      const category = input.category || 'general';
      const priority = input.priority || 'medium';
      const depends_on = input.depends_on || [];

      // Title validation
      if (!input.title || input.title.trim().length === 0) {
        errors.push(`Task ${i + 1}: Title cannot be empty`);
        continue;
      }
      if (input.title.length > 200) {
        errors.push(`Task ${i + 1}: Title exceeds 200 characters`);
        continue;
      }

      // Category validation
      if (!isValidCategory(category)) {
        errors.push(`Task ${i + 1} '${input.title}': Invalid category '${category}'`);
        continue;
      }

      // Priority validation
      if (!isValidPriority(priority)) {
        errors.push(`Task ${i + 1} '${input.title}': Invalid priority '${priority}'`);
        continue;
      }

      // Dependency validation
      const missingIds = depends_on.filter(id => !tempTaskMap.has(id) && !newTaskIds.includes(id));
      if (missingIds.length > 0) {
        errors.push(
          `Task ${i + 1} '${input.title}': Unknown depends_on ID(s) '${missingIds.join(', ')}'`
        );
        continue;
      }

      // Circular dependency check
      if (this.wouldCreateCycleWithNewTasks(depends_on, null, tempTaskMap)) {
        errors.push(`Task ${i + 1} '${input.title}': Circular dependency detected`);
        continue;
      }

      // Add to temp map to allow forward references
      tempCounter++;
      const taskId = `T${tempCounter}`;
      newTaskIds.push(taskId);
      tempTaskMap.set(taskId, {
        id: taskId,
        title: input.title,
        category,
        priority,
        status: 'pending',
        finding: null,
        finding_history: [],
        depends_on,
        unmet_deps: [],
        created: new Date().toISOString(),
        resolved_at: null,
        reopen_count: 0,
      });
    }

    if (errors.length > 0) {
      throw new Error(
        `Batch rejected — ${errors.length} error(s) found. No tasks inserted.\n${errors.join('\n')}`
      );
    }

    // All valid, commit the changes
    const now = new Date().toISOString();
    const addedTasks: string[] = [];

    for (let i = 0; i < tasks.length; i++) {
      const input = tasks[i];
      const category = input.category || 'general';
      const priority = input.priority || 'medium';
      const depends_on = input.depends_on || [];

      this.taskCounter++;
      const taskId = `T${this.taskCounter}`;
      addedTasks.push(taskId);

      const task: Task = {
        id: taskId,
        title: input.title,
        category,
        priority,
        status: 'pending',
        finding: null,
        finding_history: [],
        depends_on,
        unmet_deps: this.calculateUnmetDeps(depends_on),
        created: now,
        resolved_at: null,
        reopen_count: 0,
      };

      this.tasks.set(taskId, task);
    }

    // Generate execution plan
    const readyTasks = this.getReadyTasks();
    const plan = this.generateExecutionPlan(readyTasks);

    return `${addedTasks.length} tasks added.\n\n${plan}\n\nStart with: [${readyTasks.map(t => `'${t.id}'`).join(', ')}]`;
  }

  /**
   * Update a task's status, finding, or dependencies
   */
  updateTask(input: UpdateTaskInput): string {
    const task = this.tasks.get(input.task_id);
    if (!task) {
      throw new Error(`Task '${input.task_id}' does not exist`);
    }

    // Handle dependency rewiring
    if (input.depends_on !== undefined) {
      if (task.status !== 'pending') {
        throw new Error(
          `Cannot update depends_on on task ${input.task_id} — status is ${task.status}, not pending`
        );
      }

      // Validate new dependencies exist
      const missingIds = input.depends_on.filter(id => !this.tasks.has(id));
      if (missingIds.length > 0) {
        throw new Error(
          `Unknown task IDs in depends_on: [${missingIds.map(id => `'${id}'`).join(', ')}]`
        );
      }

      // Check for circular dependencies
      if (this.wouldCreateCycle(input.depends_on, input.task_id)) {
        throw new Error(`Circular dependency detected`);
      }

      const oldReady = this.isTaskReady(task);
      task.depends_on = input.depends_on;
      task.unmet_deps = this.calculateUnmetDeps(input.depends_on);
      const newReady = this.isTaskReady(task);

      const status = newReady ? 'ready' : 'waiting on ' + task.unmet_deps.join(', ');
      return (
        `${input.task_id} deps updated → [${input.depends_on.map(id => `'${id}'`).join(', ')}]. ` +
        `Now ${status}. Was: ${oldReady ? 'ready' : 'waiting'}. Status changed to: ${newReady ? 'ready' : 'waiting'}.`
      );
    }

    // Handle status transitions
    if (input.status !== undefined) {
      if (!isValidStatus(input.status)) {
        throw new Error(`Invalid status '${input.status}'`);
      }

      // Validate status transitions
      if (isResolvedStatus(task.status)) {
        throw new Error(
          `Task ${input.task_id} is already ${task.status} — cannot transition to ${input.status}`
        );
      }

      // Validate finding for resolved statuses
      if (['completed', 'skipped', 'blocked'].includes(input.status)) {
        if (!input.finding || input.finding.trim().length === 0) {
          throw new Error(`Finding required for status '${input.status}' — empty finding rejected`);
        }
      }

      // Validate completed tasks have resolved dependencies
      if (input.status === 'completed') {
        const unmet = task.depends_on.filter(id => {
          const dep = this.tasks.get(id);
          return !dep || !isResolvedStatus(dep.status);
        });
        if (unmet.length > 0) {
          const chain = this.buildDependencyChain(unmet[0]);
          throw new Error(
            `BLOCKED: Task ${input.task_id} depends on unresolved tasks: [${unmet.map(id => `'${id}'`).join(', ')}].\n` +
              `Chain: ${chain}. Resolve those first.`
          );
        }
      }

      const oldStatus = task.status;
      task.status = input.status;

      if (input.finding !== undefined) {
        task.finding = input.finding;
      }

      if (isResolvedStatus(input.status)) {
        task.resolved_at = new Date().toISOString();
      }

      // Calculate unblocked tasks
      const unblocked = this.findUnblockedTasks(input.task_id);
      const readyTasks = this.getReadyTasks();
      const progress = this.getProgress();

      let response = `Task ${input.task_id} → ${input.status}. Progress: ${progress}.`;

      if (unblocked.length > 0) {
        response += `\nUnlocked: [${unblocked.map(id => `'${id}'`).join(', ')}].`;
      }

      response += `\nReady now: [${readyTasks.map(t => `'${t.id}'`).join(', ')}]`;

      // Add summary stats
      const stats = this.getStats();
      response += `\nRemaining: ${stats.total - stats.resolved} tasks | Ready: ${stats.ready} | Waiting: ${stats.waiting}`;

      return response;
    }

    // If only finding is updated without status
    if (input.finding !== undefined) {
      task.finding = input.finding;
      return `Task ${input.task_id}: finding updated.`;
    }

    throw new Error('No status, finding, or depends_on provided');
  }

  /**
   * Get all tasks ready to execute (pending + all deps resolved)
   */
  getReadyTasks(): ReadyTask[] {
    const ready: ReadyTask[] = [];

    for (const task of this.tasks.values()) {
      if (this.isTaskReady(task)) {
        ready.push({
          id: task.id,
          title: task.title,
          category: task.category,
          priority: task.priority,
          depends_on: task.depends_on,
        });
      }
    }

    // Sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    ready.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return ready;
  }

  /**
   * Get complete DAG snapshot
   */
  getAllTasks(): DAGSnapshot {
    const tasks = Array.from(this.tasks.values());
    const resolved = tasks.filter(t => isResolvedStatus(t.status)).length;
    const ready = tasks.filter(t => this.isTaskReady(t)).length;
    const waiting = tasks.filter(t => t.status === 'pending' && t.unmet_deps.length > 0).length;
    const in_progress = tasks.filter(t => t.status === 'in_progress').length;

    return {
      progress: `Progress: ${resolved}/${tasks.length} (${tasks.length === 0 ? 0 : Math.round((resolved / tasks.length) * 100)}%)`,
      ready,
      waiting,
      in_progress,
      tasks: tasks.sort((a, b) => {
        const aNum = parseInt(a.id.substring(1));
        const bNum = parseInt(b.id.substring(1));
        return aNum - bNum;
      }),
    };
  }

  /**
   * Gate: conclude analysis - requires all tasks resolved
   */
  concludeAnalysis(): string {
    // Check for unresolved tasks
    const unresolvedTasks: Task[] = [];
    const in_progressTasks: Task[] = [];

    for (const task of this.tasks.values()) {
      if (task.status === 'pending' || task.status === 'in_progress') {
        if (task.status === 'pending') {
          unresolvedTasks.push(task);
        } else {
          in_progressTasks.push(task);
        }
      }
    }

    if (unresolvedTasks.length > 0 || in_progressTasks.length > 0) {
      let response = `CANNOT CONCLUDE: ${unresolvedTasks.length + in_progressTasks.length} task(s) still unresolved.\n\n  Unresolved:\n`;

      for (const task of unresolvedTasks) {
        const ready = this.isTaskReady(task);
        response += `    - ${task.id} [pending, ${ready ? 'READY' : 'WAITING'}]     ${task.title}\n`;
      }

      for (const task of in_progressTasks) {
        response += `    - ${task.id} [in_progress]        ${task.title}\n`;
      }

      response += `\n  DO THIS NEXT:\n`;
      if (unresolvedTasks.length > 0 && this.isTaskReady(unresolvedTasks[0])) {
        response += `    → ${unresolvedTasks[0].id} is ready — complete it first\n`;
      }
      if (in_progressTasks.length > 0) {
        response += `    → ${in_progressTasks[0].id} is in_progress — resolve it with a finding\n`;
      }

      response += `\nAfter resolving, call conclude_analysis() again.`;
      return response;
    }

    // All resolved - generate summary
    return this.generateSummary();
  }

  /**
   * Reopen a blocked task
   */
  reopenTask(task_id: string, reason: string): string {
    const task = this.tasks.get(task_id);
    if (!task) {
      throw new Error(`Task '${task_id}' does not exist`);
    }

    if (task.status !== 'blocked') {
      throw new Error(
        `Task ${task_id} cannot be reopened — status is '${task.status}', not 'blocked'`
      );
    }

    if (!reason || reason.trim().length === 0) {
      throw new Error('reason cannot be empty');
    }

    // Preserve finding in history
    if (task.finding) {
      task.finding_history.push(task.finding);
    }

    task.finding = null;
    task.status = 'pending';
    task.reopen_count++;
    task.unmet_deps = this.calculateUnmetDeps(task.depends_on);

    const ready = this.isTaskReady(task);
    const status = ready ? 'ready' : `waiting on [${task.unmet_deps.join(', ')}]`;

    const stats = this.getStats();
    const progress = this.getProgress();

    return (
      `Task ${task_id} reopened → pending. Original finding preserved in history.\n` +
      `Reason: ${reason}\n` +
      `Status: ${status} (all dependencies resolved).\n` +
      `Progress: ${progress} — ${stats.total - stats.resolved} tasks still unresolved.`
    );
  }

  /**
   * Reset all tasks
   */
  reset(): string {
    const count = this.tasks.size;
    this.tasks.clear();
    this.taskCounter = 0;
    this.sessionStartTime = new Date();
    return `Session reset. All ${count} tasks cleared. Ready for new analysis.`;
  }

  /**
   * Private helper methods
   */

  private isTaskReady(task: Task): boolean {
    if (task.status !== 'pending') {
      return false;
    }
    return task.unmet_deps.length === 0;
  }

  private calculateUnmetDeps(depends_on: string[]): string[] {
    return depends_on.filter(id => {
      const dep = this.tasks.get(id);
      return !dep || !isResolvedStatus(dep.status);
    });
  }

  private findUnblockedTasks(task_id: string): string[] {
    const unblocked: string[] = [];

    for (const task of this.tasks.values()) {
      if (task.status === 'pending' && task.depends_on.includes(task_id)) {
        const newUnmet = this.calculateUnmetDeps(task.depends_on);
        task.unmet_deps = newUnmet;
        if (newUnmet.length === 0) {
          unblocked.push(task.id);
        }
      }
    }

    return unblocked;
  }

  private wouldCreateCycle(newDeps: string[], excludeTaskId: string | null): boolean {
    for (const depId of newDeps) {
      if (this.hasPathToTask(excludeTaskId || '', depId, new Set())) {
        return true;
      }
    }
    return false;
  }

  private wouldCreateCycleWithNewTasks(
    newDeps: string[],
    excludeTaskId: string | null,
    tempMap: Map<string, Task>
  ): boolean {
    for (const depId of newDeps) {
      if (this.hasPathToTaskInMap(excludeTaskId || '', depId, new Set(), tempMap)) {
        return true;
      }
    }
    return false;
  }

  private hasPathToTask(target: string, from: string, visited: Set<string>): boolean {
    if (visited.has(from)) return false;
    if (from === target) return true;

    visited.add(from);

    const fromTask = this.tasks.get(from);
    if (!fromTask) return false;

    for (const dep of fromTask.depends_on) {
      if (this.hasPathToTask(target, dep, visited)) {
        return true;
      }
    }

    return false;
  }

  private hasPathToTaskInMap(
    target: string,
    from: string,
    visited: Set<string>,
    taskMap: Map<string, Task>
  ): boolean {
    if (visited.has(from)) return false;
    if (from === target) return true;

    visited.add(from);

    const fromTask = taskMap.get(from);
    if (!fromTask) return false;

    for (const dep of fromTask.depends_on) {
      if (this.hasPathToTaskInMap(target, dep, visited, taskMap)) {
        return true;
      }
    }

    return false;
  }

  private buildDependencyChain(taskId: string): string {
    const task = this.tasks.get(taskId);
    if (!task) return taskId;

    const unmet = task.depends_on.filter(id => {
      const dep = this.tasks.get(id);
      return !dep || !isResolvedStatus(dep.status);
    });

    if (unmet.length === 0) {
      return `${taskId} (resolved)`;
    }

    return `${taskId} (pending) <- ${unmet.map(id => this.buildDependencyChain(id)).join(', ')}`;
  }

  private getProgress(): string {
    const tasks = Array.from(this.tasks.values());
    const resolved = tasks.filter(t => isResolvedStatus(t.status)).length;
    const total = tasks.length;
    return `${resolved}/${total} (${total === 0 ? 0 : Math.round((resolved / total) * 100)}%)`;
  }

  private getStats(): { total: number; resolved: number; ready: number; waiting: number } {
    const tasks = Array.from(this.tasks.values());
    const resolved = tasks.filter(t => isResolvedStatus(t.status)).length;
    const ready = tasks.filter(t => this.isTaskReady(t)).length;
    const waiting = tasks.filter(t => t.status === 'pending' && t.unmet_deps.length > 0).length;
    return { total: tasks.length, resolved, ready, waiting };
  }

  private generateExecutionPlan(readyTasks: ReadyTask[]): string {
    let plan = 'Execution plan:';

    if (readyTasks.length === 0) {
      return plan + '\n  No tasks ready.';
    }

    const now = readyTasks.filter(t => t.priority === 'high');
    const then = readyTasks.filter(t => t.priority === 'medium');
    const later = readyTasks.filter(t => t.priority === 'low');

    if (now.length > 0) {
      plan += `\n\n  NOW (parallel):   ${now.map(t => `${t.id} [${t.priority}]`).join(', ')}`;
    }
    if (then.length > 0) {
      plan += `\n  THEN:             ${then.map(t => `${t.id} [${t.priority}]`).join(', ')}`;
    }
    if (later.length > 0) {
      plan += `\n  LATER:            ${later.map(t => `${t.id} [${t.priority}]`).join(', ')}`;
    }

    return plan;
  }

  private generateSummary(): string {
    const tasks = Array.from(this.tasks.values());
    const completed = tasks.filter(t => t.status === 'completed');
    const skipped = tasks.filter(t => t.status === 'skipped');
    const blocked = tasks.filter(t => t.status === 'blocked');

    const duration = this.formatDuration(new Date().getTime() - this.sessionStartTime.getTime());
    const started = this.sessionStartTime.toLocaleTimeString();
    const concluded = new Date().toLocaleTimeString();

    let summary = `Analysis complete. ${tasks.length} task(s) resolved (${completed.length} completed, ${skipped.length} skipped, ${blocked.length} blocked).\n`;
    summary += `Duration: ${duration}. Started: ${started}. Concluded: ${concluded}.\n`;

    // Group by status then category
    const groupByCategory = (tasksToGroup: Task[]) => {
      const byCategory: { [key: string]: Task[] } = {};
      for (const task of tasksToGroup) {
        if (!byCategory[task.category]) {
          byCategory[task.category] = [];
        }
        byCategory[task.category].push(task);
      }
      return byCategory;
    };

    if (completed.length > 0) {
      summary += `\n## Completed (${completed.length})\n`;
      const byCategory = groupByCategory(completed);
      for (const [category, catTasks] of Object.entries(byCategory)) {
        summary += `\n### ${category} (${catTasks.length})\n`;
        for (const task of catTasks) {
          summary += `  - ${task.title} (${task.id}): ${task.finding}\n`;
        }
      }
    }

    if (skipped.length > 0) {
      summary += `\n## Skipped (${skipped.length})\n`;
      const byCategory = groupByCategory(skipped);
      for (const [category, catTasks] of Object.entries(byCategory)) {
        summary += `\n### ${category} (${catTasks.length})\n`;
        for (const task of catTasks) {
          summary += `  - ${task.title} (${task.id}): ${task.finding}\n`;
        }
      }
    }

    if (blocked.length > 0) {
      summary += `\n## Blocked (${blocked.length})\n`;
      const byCategory = groupByCategory(blocked);
      for (const [category, catTasks] of Object.entries(byCategory)) {
        summary += `\n### ${category} (${catTasks.length})\n`;
        for (const task of catTasks) {
          summary += `  - ${task.title} (${task.id}): ${task.finding}\n`;
        }
      }
    }

    return summary;
  }

  private formatDuration(milliseconds: number): string {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes === 0) {
      return `${seconds}s`;
    }
    return `${minutes}m ${seconds}s`;
  }
}
