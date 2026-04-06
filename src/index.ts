#!/usr/bin/env node

/**
 * TaskTracker MCP Server
 * DAG-based task tracking for bug analysis investigations
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TaskTracker } from './tracker.js';
import { AddTaskInput, BulkTaskInput, UpdateTaskInput, ReadyTask, Task } from './types.js';

const tracker = new TaskTracker();
const server = new Server(
  {
    name: 'tasktracker',
    version: '1.0.1',
  },
  {
    capabilities: {
      tools: {},
    },
    instructions: `
TaskTracker helps you plan and execute structured investigations using a Directed Acyclic Graph (DAG) of tasks.

## Workflow

1. PLAN — call add_tasks_bulk() with your full investigation plan. Define all tasks upfront, declaring dependencies between them. Each task gets an auto-assigned ID (T1, T2, T3...).

2. EXECUTE — call get_ready_tasks() to see which tasks are unblocked right now (all dependencies resolved), sorted by priority. Work on those tasks in parallel or in order.

3. RESOLVE — after completing a task, call update_task() with status="completed" and a finding that records what you discovered. This automatically unblocks any tasks that were waiting on it.

4. REPEAT — call get_ready_tasks() again to get the next batch. Continue until all tasks are resolved.

5. CONCLUDE — call conclude_analysis() when you believe all tasks are done. It will block if anything is still pending, or return a full grouped summary if everything is resolved.

## Key Rules

- Every resolved task (completed/skipped/blocked) REQUIRES a finding — empty findings are rejected.
- A task can only be marked completed if all its dependencies are already resolved.
- completed and skipped tasks are permanent — they cannot be changed.
- blocked tasks can be reopened with reopen_task() when the blocker is resolved.
- in_progress status does NOT unblock dependents — only resolved statuses do.

## Status Meanings

- pending: not started, waiting to be picked up
- in_progress: currently being worked on
- completed: done, finding contains the evidence
- skipped: not needed, finding explains why
- blocked: cannot proceed, finding describes what is missing — use reopen_task() to retry

## Categories (use consistently)

- log_check: fetching, searching, or parsing log files
- config_verify: checking configuration files or settings
- root_cause: synthesizing findings into a conclusion
- comparison: comparing two artifacts, versions, or states
- reproduce: attempting to reproduce the issue
- general: anything else

## Tips

- Use add_tasks_bulk() for the entire plan — it validates everything atomically and rejects the whole batch if any task has an error.
- Use add_task() only when adding a single follow-up task discovered mid-investigation.
- Use get_all_tasks() to get a full snapshot of the DAG at any point.
- Use reset() only when starting a completely new investigation.
`.trim(),
  }
);

/**
 * List available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'add_task',
        description: 'Register a single follow-up task discovered mid-investigation. Use add_tasks_bulk() instead if defining the full plan upfront.',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Task description (max 200 chars)',
            },
            category: {
              type: 'string',
              enum: [
                'log_check',
                'config_verify',
                'root_cause',
                'comparison',
                'reproduce',
                'general',
              ],
              description: 'Task grouping for expertise routing',
            },
            priority: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: 'Execution priority',
            },
            depends_on: {
              type: 'array',
              items: { type: 'string' },
              description: 'Task IDs that must resolve before this task is ready',
            },
          },
          required: ['title'],
        },
      },
      {
        name: 'add_tasks_bulk',
        description:
          'FIRST CALL: Register your entire investigation plan as a DAG in one atomic call. All tasks are validated before any are inserted. Returns a prioritised execution plan showing which tasks to start with.',
        inputSchema: {
          type: 'object',
          properties: {
            tasks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  category: {
                    type: 'string',
                    enum: [
                      'log_check',
                      'config_verify',
                      'root_cause',
                      'comparison',
                      'reproduce',
                      'general',
                    ],
                  },
                  priority: {
                    type: 'string',
                    enum: ['high', 'medium', 'low'],
                  },
                  depends_on: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                },
                required: ['title'],
              },
              description: 'List of task definitions',
            },
          },
          required: ['tasks'],
        },
      },
      {
        name: 'update_task',
        description: 'Resolve a task after completing work on it. Always provide a finding for completed/skipped/blocked. Completing a task automatically unblocks any dependents. Can also rewire dependencies (pending tasks only) or update a finding without changing status.',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'string',
              description: 'ID of the task to update',
            },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed', 'skipped', 'blocked'],
              description: 'New status for the task',
            },
            finding: {
              type: 'string',
              description: 'Evidence, reason, or intent (required for completed/skipped/blocked)',
            },
            depends_on: {
              type: 'array',
              items: { type: 'string' },
              description: 'Replace dependency list (pending tasks only)',
            },
          },
          required: ['task_id'],
        },
      },
      {
        name: 'get_ready_tasks',
        description:
          'CALL AFTER EVERY update_task: Returns all tasks whose dependencies are fully resolved, sorted by priority (high → medium → low). These are the tasks you should work on next. Empty list means either all done or everything is blocked.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_all_tasks',
        description: 'Get a full snapshot of the entire DAG — all tasks, their current status, findings, dependencies, and overall progress. Use when you need to review the full picture or check what is blocked.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'conclude_analysis',
        description:
          'FINAL CALL: Close out the investigation. Blocks and returns actionable instructions if any tasks are still pending or in_progress. Returns a full grouped summary (by status and category) once everything is resolved. Call this when you believe all tasks are done.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'reopen_task',
        description: 'Reopen a blocked task after its blocker has been resolved. Resets the task to pending, preserves the original finding in history, and recalculates its dependency state. Provide a reason explaining what changed.',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: {
              type: 'string',
              description: 'ID of the blocked task to reopen',
            },
            reason: {
              type: 'string',
              description: 'Explanation of what changed',
            },
          },
          required: ['task_id', 'reason'],
        },
      },
      {
        name: 'reset',
        description: 'Clear all tasks and start a new investigation session. Irreversible — all tasks and findings are permanently deleted. Only use when starting a completely new investigation.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  };
});

/**
 * Handle tool calls
 */
server.setRequestHandler(CallToolRequestSchema, async request => {
  try {
    const { name, arguments: args } = request.params;

    let result: string | object;

    switch (name) {
      case 'add_task': {
        if (!args) {
          throw new McpError(ErrorCode.InvalidParams, 'Arguments are required for add_task');
        }
        const input: AddTaskInput = {
          title: args.title as string,
          category: args.category as any,
          priority: args.priority as any,
          depends_on: args.depends_on as string[] | undefined,
        };
        result = tracker.addTask(input);
        break;
      }

      case 'add_tasks_bulk': {
        if (!args) {
          throw new McpError(ErrorCode.InvalidParams, 'Arguments are required for add_tasks_bulk');
        }
        const tasks: BulkTaskInput[] = (args.tasks as any[]).map(t => ({
          title: t.title,
          category: t.category,
          priority: t.priority,
          depends_on: t.depends_on,
        }));
        result = tracker.addTasksBulk(tasks);
        break;
      }

      case 'update_task': {
        if (!args) {
          throw new McpError(ErrorCode.InvalidParams, 'Arguments are required for update_task');
        }
        const input: UpdateTaskInput = {
          task_id: args.task_id as string,
          status: args.status as any,
          finding: args.finding as string | undefined,
          depends_on: args.depends_on as string[] | undefined,
        };
        result = tracker.updateTask(input);
        break;
      }

      case 'get_ready_tasks': {
        const readyTasks = tracker.getReadyTasks();
        result = readyTasks.length === 0 ? [] : readyTasks;
        break;
      }

      case 'get_all_tasks': {
        const snapshot = tracker.getAllTasks();
        result = {
          progress: snapshot.progress,
          ready: snapshot.ready,
          waiting: snapshot.waiting,
          in_progress: snapshot.in_progress,
          tasks: snapshot.tasks,
        };
        break;
      }

      case 'conclude_analysis': {
        result = tracker.concludeAnalysis();
        break;
      }

      case 'reopen_task': {
        if (!args) {
          throw new McpError(ErrorCode.InvalidParams, 'Arguments are required for reopen_task');
        }
        result = tracker.reopenTask(args.task_id as string, args.reason as string);
        break;
      }

      case 'reset': {
        result = tracker.reset();
        break;
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${message}`,
        },
      ],
      isError: true,
    };
  }
});

/**
 * Start the server
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('TaskTracker MCP Server running on stdio');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
