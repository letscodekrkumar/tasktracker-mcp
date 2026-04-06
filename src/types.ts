/**
 * Core data models and types for TaskTracker MCP Server
 */

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'skipped' | 'blocked';
export type TaskCategory =
  | 'log_check'
  | 'config_verify'
  | 'root_cause'
  | 'comparison'
  | 'reproduce'
  | 'general';
export type TaskPriority = 'high' | 'medium' | 'low';

export interface Task {
  id: string;
  title: string;
  category: TaskCategory;
  priority: TaskPriority;
  status: TaskStatus;
  finding: string | null;
  finding_history: string[];
  depends_on: string[];
  unmet_deps: string[];
  created: string;
  resolved_at: string | null;
  reopen_count: number;
}

export interface AddTaskInput {
  title: string;
  category?: TaskCategory;
  priority?: TaskPriority;
  depends_on?: string[];
}

export interface BulkTaskInput {
  title: string;
  category?: TaskCategory;
  priority?: TaskPriority;
  depends_on?: string[];
}

export interface UpdateTaskInput {
  task_id: string;
  status?: TaskStatus;
  finding?: string;
  depends_on?: string[];
}

export interface DAGSnapshot {
  progress: string;
  ready: number;
  waiting: number;
  in_progress: number;
  tasks: Task[];
}

export interface ReadyTask {
  id: string;
  title: string;
  category: TaskCategory;
  priority: TaskPriority;
  depends_on: string[];
}

const VALID_CATEGORIES: TaskCategory[] = [
  'log_check',
  'config_verify',
  'root_cause',
  'comparison',
  'reproduce',
  'general',
];
const VALID_PRIORITIES: TaskPriority[] = ['high', 'medium', 'low'];
const VALID_STATUSES: TaskStatus[] = ['pending', 'in_progress', 'completed', 'skipped', 'blocked'];

export function isValidCategory(category: any): category is TaskCategory {
  return VALID_CATEGORIES.includes(category);
}

export function isValidPriority(priority: any): priority is TaskPriority {
  return VALID_PRIORITIES.includes(priority);
}

export function isValidStatus(status: any): status is TaskStatus {
  return VALID_STATUSES.includes(status);
}

export function isResolvedStatus(status: TaskStatus): boolean {
  return ['completed', 'skipped', 'blocked'].includes(status);
}
