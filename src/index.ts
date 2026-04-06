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
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
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
        description: 'Register a single new analysis task in the DAG with optional dependencies',
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
          'Register the full investigation DAG in a single atomic call. Returns execution plan.',
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
        description: 'Resolve a task with evidence, update its status, or rewire its dependencies',
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
          'Get all tasks ready to execute right now, sorted by priority (high → medium → low)',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_all_tasks',
        description: 'Get complete DAG snapshot with all tasks, statuses, findings, and progress',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'conclude_analysis',
        description:
          "Gate that blocks until all tasks are resolved. Returns grouped summary or tells what's still needed.",
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'reopen_task',
        description: 'Reopen a blocked task when its blocker has been resolved externally',
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
        description: 'Clear all tasks and start fresh (irreversible)',
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
