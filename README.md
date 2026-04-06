# TaskTracker MCP Server

A DAG-based task tracking server for bug analysis and investigation workflows, built as a [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server.

## Features

- **DAG-based task dependencies** — declare dependencies for structured investigation workflows
- **Circular dependency detection** — automatic validation prevents invalid chains
- **Priority-based execution** — tasks sorted by high/medium/low priority
- **Atomic bulk operations** — add entire investigation plans in one call
- **Rich status tracking** — `pending` → `in_progress` → `completed` / `skipped` / `blocked`
- **Evidence-based resolution** — every resolved task requires a finding
- **Analysis gate** — `conclude_analysis()` blocks until all tasks are resolved

## Installation

```bash
npm install
npm run build
npm start
```

## MCP Configuration

Add to your MCP client (e.g., Claude Desktop):

```json
{
  "mcpServers": {
    "tasktracker": {
      "command": "node",
      "args": ["dist/index.js"]
    }
  }
}
```

## Tools

| Tool | Purpose |
|------|---------|
| `add_task` | Register a single task with optional dependencies |
| `add_tasks_bulk` | Register an entire investigation DAG atomically |
| `update_task` | Resolve task with evidence, update status, or rewire deps |
| `get_ready_tasks` | Get all executable tasks (deps resolved), priority-sorted |
| `get_all_tasks` | Full DAG snapshot with statuses, findings, and dependency state |
| `conclude_analysis` | Gate that blocks until all tasks resolved; returns summary |
| `reopen_task` | Reopen a blocked task when its blocker is resolved |
| `reset` | Clear all tasks and start fresh |

## Quick Start

```python
# 1. Define your investigation DAG
add_tasks_bulk([
    {"title": "Fetch bug fields", "category": "log_check", "priority": "high"},
    {"title": "Extract machine ID", "category": "log_check", "priority": "high"},
    {"title": "Fetch run.log — search for TIMEOUT errors", "category": "log_check", "priority": "high", "depends_on": ["T2"]},
    {"title": "Identify root cause", "category": "root_cause", "priority": "high", "depends_on": ["T1", "T2", "T3"]}
])

# 2. Execute ready tasks
tasks = get_ready_tasks()  # returns T1, T2

# 3. Resolve tasks as you go
update_task("T1", status="completed", finding="Bug filed 2026-03-28. Build: 4.2.1-rc3.")
update_task("T2", status="completed", finding="Machine ID: X200-lot-7.")

# 4. T3 is now unblocked
update_task("T3", status="completed", finding="3 TIMEOUT errors at 14:22:01")

# 5. Conclude when all done
conclude_analysis()
```

## Task Status Transitions

| Transition | Allowed | Notes |
|------------|---------|-------|
| pending → in_progress | Yes | No dependency check |
| pending/in_progress → completed | Yes | All deps must be resolved; finding required |
| pending/in_progress → skipped | Yes | Finding required |
| pending/in_progress → blocked | Yes | Finding required |
| completed / skipped → any | No | Permanently resolved |
| blocked → any | No | Use `reopen_task()` to reopen |

## Development

```bash
npm test              # run tests
npm run test:coverage # with coverage report
npm run build         # compile TypeScript
npm run dev           # build + run
```

## Project Structure

```
src/
  index.ts      # MCP server entry point
  tracker.ts    # DAG engine (task state, dependency resolution)
  types.ts      # TypeScript interfaces and validators
  monitor.ts    # Progress monitoring
  examples.ts   # Usage examples
  benchmark.ts  # Performance benchmarks
  __tests__/    # Test suite
docs/           # Design docs, deployment guide, specs
```

## License

MIT — see [LICENSE](LICENSE)
