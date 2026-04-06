# TaskTracker MCP Server

A powerful DAG-based task tracking server for bug analysis and investigation workflows. Built as a Model Context Protocol (MCP) server for seamless integration with Claude and other AI agents.

## Features

✅ **Directed Acyclic Graph (DAG) Support** - Declare task dependencies for structured investigation workflows
✅ **Circular Dependency Detection** - Automatic validation prevents invalid dependency chains
✅ **Priority-Based Execution** - Tasks sorted by high/medium/low priority for optimal workflow
✅ **Atomic Bulk Operations** - Add entire investigation plans in one call with validation
✅ **Rich Status Tracking** - pending → in_progress → completed/skipped/blocked
✅ **Evidence-Based Resolution** - Every resolved task requires a finding (evidence or reason)
✅ **Dependency Rewiring** - Update task dependencies mid-investigation as new requirements emerge
✅ **Task Reopening** - Reopen blocked tasks when their blockers are resolved
✅ **Category Grouping** - Organize tasks by type (log_check, config_verify, root_cause, etc.)
✅ **Analysis Gate** - `conclude_analysis()` refuses to complete until all tasks are resolved
✅ **Complete DAG Snapshots** - Get full progress view with all findings and dependency state
✅ **Session Management** - Reset and start fresh investigations

## Installation

### Via npm (when published)

```bash
npm install -g tasktracker
```

### From source

```bash
git clone https://github.com/your-org/tasktracker-mcp.git
cd tasktracker-mcp
npm install
npm run build
npm start
```

## Usage

### As an MCP Server

Configure in your MCP client (e.g., Claude Desktop):

```json
{
  "mcpServers": {
    "tasktracker": {
      "command": "tasktracker"
    }
  }
}
```

### API Overview

All interactions are through 8 core tools:

| Tool | Purpose |
|------|---------|
| `add_task` | Register a single task with optional dependencies |
| `add_tasks_bulk` | Register entire investigation DAG atomically |
| `update_task` | Resolve task with evidence, update status, or rewire deps |
| `get_ready_tasks` | Get all executable tasks (pending + deps resolved), priority-sorted |
| `get_all_tasks` | Full DAG snapshot with all statuses, findings, and dependency state |
| `conclude_analysis` | Gate that blocks until all tasks resolved; returns grouped summary |
| `reopen_task` | Reopen a blocked task when its blocker is resolved |
| `reset` | Clear all tasks and start fresh |

## Quick Start Example

```python
# 1. Start with bulk task definition
add_tasks_bulk([
    {
        "title": "FETCH bug fields from ticket system",
        "category": "log_check",
        "priority": "high"
    },
    {
        "title": "EXTRACT machine ID from bug description",
        "category": "log_check",
        "priority": "high"
    },
    {
        "title": "FETCH run.log — search for TIMEOUT errors",
        "category": "log_check",
        "priority": "high",
        "depends_on": ["T2"]
    },
    {
        "title": "IDENTIFY root cause",
        "category": "root_cause",
        "priority": "high",
        "depends_on": ["T1", "T2", "T3"]
    }
])

# 2. Execute ready tasks in priority order
tasks = get_ready_tasks()  # [T1, T2]
# Work on T1, T2 in parallel

# 3. Resolve T1
update_task("T1", 
    status="completed",
    finding="Bug filed 2026-03-28. Build: 4.2.1-rc3. Machine: X200-lot-7.")

# 4. Resolve T2
update_task("T2",
    status="completed", 
    finding="Machine ID: X200-lot-7. Found in bug description line 3.")

# 5. Now T3 is ready (deps resolved)
tasks = get_ready_tasks()  # [T3]

# 6. Work on T3, then resolve
update_task("T3",
    status="completed",
    finding="3 TIMEOUT errors at 14:22:01, 14:22:45, 14:23:12")

# 7. Now T4 is ready (all deps resolved)
tasks = get_ready_tasks()  # [T4]

# 8. Resolve final task
update_task("T4",
    status="completed",
    finding="Retry loop in RequestHandler.cs:89 triggers on TIMEOUT")

# 9. Conclude (all resolved)
conclude_analysis()
# → "Analysis complete. 4 task(s) resolved. Duration: 2m 34s. ..."
```

## Task Status Rules

| From → To | Allowed | Notes |
|-----------|---------|-------|
| pending → in_progress | ✅ | No dependency check |
| pending → completed | ✅ | All deps must be resolved; finding required |
| pending → skipped | ✅ | No dependency check; finding required |
| pending → blocked | ✅ | No dependency check; finding required |
| in_progress → completed | ✅ | All deps must be resolved; finding required |
| in_progress → skipped | ✅ | No dependency check; finding required |
| in_progress → blocked | ✅ | No dependency check; finding required |
| completed → any | ❌ | Permanently resolved |
| skipped → any | ❌ | Permanently resolved |
| blocked → any | ❌ | Use `reopen_task()` to reopen |

**Key:** `in_progress` upstream does NOT unblock dependents — only resolved statuses do.

## Categories

Use categories consistently to organize your investigation:

- **log_check** - Fetching, parsing, or searching log files
- **config_verify** - Checking configuration files or settings
- **root_cause** - Synthesizing findings into a conclusion
- **comparison** - Comparing two artifacts, versions, or states
- **reproduce** - Attempting to reproduce the bug
- **general** - Anything that doesn't fit above

## Finding Contract

When resolving a task (completed/skipped/blocked), a `finding` is required:

```
completed → Evidence of what was observed
skipped → Reason why task is not needed
blocked → What is missing or preventing progress
```

Finding can be plain text or structured JSON:

```python
# Plain text
finding="No ERROR or WARN entries found near failure timestamp"

# Structured JSON (recommended for complex findings)
finding={
  "evidence_type": "log",
  "summary": "Repeated timeout errors starting at job launch",
  "confidence": "high",
  "raw_refs": ["run.log:842-910"],
  "note": "Correlates with system.log ERROR_TIMEOUT entries"
}
```

The server stores findings as opaque strings — structure is your choice.

## Architecture

### Core Components

- **TaskTracker** (`src/tracker.ts`) - DAG engine with:
  - Task state management
  - Circular dependency detection
  - Dependency resolution
  - Progress tracking
  - Session management

- **Types** (`src/types.ts`) - TypeScript interfaces and validators

- **MCP Server** (`src/index.ts`) - Protocol implementation with:
  - Tool registration
  - Request handling
  - Error management
  - Stdio transport

### Validation

Every operation validates:
- ✅ Task IDs exist
- ✅ Circular dependencies are prevented
- ✅ Status transitions are legal
- ✅ Required findings are present
- ✅ Dependencies are resolved before completion

## Error Handling

Clear, actionable error messages:

```
"Unknown task IDs in depends_on: ['T9'] — task does not exist"
"Circular dependency detected: T4 → T1 → T4"
"Invalid category 'logs' — must be one of: log_check, config_verify, ..."
"Finding required for status 'completed' — empty finding rejected"
"BLOCKED: Task T6 depends on unresolved tasks: ['T4']. Chain: T4 (pending). Resolve those first."
```

## Design Philosophy

**v4.0 - Core tools only.** Every tool must earn its place. 8 tools total.

- **Single-agent scope** - Simple, focused design
- **Response enrichment over new tools** - Most questions answered through richer responses
- **Atomic operations** - `add_tasks_bulk` validates and inserts entire DAG at once
- **Opaque findings** - Server stores as text, agent owns content and structure

## Future Extensions

Current design enables future multi-agent scenarios without breaking changes:

- Expert routing by category
- Per-agent task queues
- Task claiming and locking
- Stale detection and crash recovery
- Critical path analysis

## Development

### Build

```bash
npm install
npm run build
```

### Development with auto-rebuild

```bash
npm run dev
```

### Run

```bash
npm start
```

## Contributing

Pull requests welcome! Please ensure:
- TypeScript strict mode passes
- All error cases are tested
- Documentation is updated

## License

MIT - See LICENSE file

## Specification

Full design specification available in [TaskTracker_Design_v4.md](../TaskTracker_Design_v4.md)
