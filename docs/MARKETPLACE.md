# TaskTracker MCP Server - Marketplace Publishing Guide

This document outlines the structure and preparation of the TaskTracker MCP Server for publication in the MCP Marketplace.

## Project Structure

```
tasktracker-mcp/
├── src/
│   ├── index.ts           # MCP Server entry point (stdio transport)
│   ├── tracker.ts         # Core DAG engine and task management
│   ├── types.ts           # TypeScript interfaces and validators
│   └── examples.ts        # Usage examples and test scenarios
├── dist/                  # Compiled JavaScript (generated on build)
├── package.json           # NPM configuration with marketplace metadata
├── tsconfig.json          # TypeScript compilation settings
├── README.md              # Main documentation and quick start
├── LICENSE                # MIT License
├── .gitignore             # Git ignore rules
├── .npmignore             # NPM publish ignore rules
└── MARKETPLACE.md         # This file - marketplace publishing info
```

## Key Features for Marketplace

### 1. **DAG-Based Task Management**
   - Declare task dependencies upfront
   - Automatic circular dependency detection
   - Parallel execution support for independent tasks
   - Priority-based task ordering (high/medium/low)

### 2. **Rich Task Lifecycle**
   - Status transitions: pending → in_progress → completed/skipped/blocked
   - Structured findings/evidence for resolved tasks
   - Finding history for reopened tasks
   - Task reopening when external blockers resolve

### 3. **Atomic Operations**
   - `add_tasks_bulk()` validates entire investigation plan before insertion
   - Atomic validation: all-or-nothing approach prevents partial updates
   - Forward references within bulk operations

### 4. **Analysis Gate**
   - `conclude_analysis()` enforces completion
   - Cannot conclude with unresolved tasks
   - Category-grouped summary with timing information
   - Detailed dependency chain reporting for blocked tasks

### 5. **8-Tool Core API**
   - Minimal surface area (just 8 tools)
   - Every tool is essential and well-defined
   - Consistent error messages with actionable guidance

## Installation Methods

### Global NPM (Recommended for marketplace)
```bash
npm install -g tasktracker-mcp
tasktracker-mcp
```

### Direct from source
```bash
git clone https://github.com/your-org/tasktracker-mcp.git
cd tasktracker-mcp
npm install
npm run build
npm start
```

## MCP Configuration

### Claude Desktop Configuration
Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "tasktracker": {
      "command": "tasktracker-mcp"
    }
  }
}
```

### Other MCP Clients
The server uses stdio transport (stdin/stdout) for all communication. Any MCP-compatible client can connect by:
1. Spawning the process: `tasktracker-mcp`
2. Communicating via JSON-RPC over stdio

## Tool Surface

| Tool | Type | Purpose |
|------|------|---------|
| `add_task` | Write | Add single task with optional dependencies |
| `add_tasks_bulk` | Write | Add entire DAG atomically with validation |
| `update_task` | Write | Resolve task, update status, rewire dependencies |
| `get_ready_tasks` | Read | Get next executable tasks (priority-sorted) |
| `get_all_tasks` | Read | Full DAG snapshot with all details |
| `conclude_analysis` | Gate | Block until complete; return grouped summary |
| `reopen_task` | Write | Reopen blocked tasks when blockers resolve |
| `reset` | Write | Clear all tasks and start fresh |

## Data Model

### Task Structure
```json
{
  "id": "T4",
  "title": "FETCH run.log — search for TIMEOUT errors",
  "category": "log_check",
  "priority": "high",
  "status": "pending",
  "finding": null,
  "finding_history": [],
  "depends_on": ["T2"],
  "unmet_deps": ["T2"],
  "created": "2026-04-01T10:30:00",
  "resolved_at": null,
  "reopen_count": 0
}
```

### Categories
- `log_check` - Log file analysis
- `config_verify` - Configuration verification
- `root_cause` - Root cause synthesis
- `comparison` - Comparative analysis
- `reproduce` - Bug reproduction
- `general` - Uncategorized work

### Statuses
- `pending` - Not started
- `in_progress` - Being worked on
- `completed` - Done with evidence
- `skipped` - Not needed (with reason)
- `blocked` - Cannot proceed (with blocker reason)

## Validation & Error Handling

### Automatic Validation
- ✅ Circular dependency detection
- ✅ Status transition validation
- ✅ Finding requirement enforcement
- ✅ Dependency resolution verification
- ✅ Category and priority validation

### Error Messages
All errors provide clear, actionable feedback:
```
"Unknown task IDs in depends_on: ['T9'] — task does not exist"
"Circular dependency detected: T4 → T1 → T4"
"Finding required for status 'completed' — empty finding rejected"
```

## Performance Characteristics

- **Task operations**: O(1) task lookup, O(n) DAG validation
- **Dependency validation**: O(n²) worst case (full DAG traversal)
- **Get ready tasks**: O(n log n) (filtering + sorting)
- **Conclude analysis**: O(n) (full traversal with grouping)

For typical investigations (5-30 tasks): sub-millisecond response times

## Use Cases

### 1. **Bug Root Cause Analysis**
   - Structured investigation with dependencies
   - Evidence collection across multiple sources
   - Final synthesis into root cause

### 2. **System Performance Diagnosis**
   - Parallel log analysis tasks
   - Configuration verification
   - Cross-correlation of findings

### 3. **Security Incident Investigation**
   - Timeline reconstruction
   - Evidence gathering with priority
   - Blocked task handling for access delays

### 4. **Feature Request Investigation**
   - Requirements gathering
   - Feasibility assessment
   - Dependency mapping across subsystems

## Development & Testing

### Build
```bash
npm install
npm run build
```

### Development (auto-rebuild)
```bash
npm run dev
```

### Run
```bash
npm start
```

### Type Safety
- Full TypeScript strict mode
- Comprehensive type definitions
- No implicit any types

## Dependencies

### Runtime
- `@modelcontextprotocol/sdk` - MCP protocol implementation

### Development
- `typescript` - TypeScript compiler
- `@types/node` - Node.js type definitions

Total dependency footprint: minimal, production-ready

## Publishing Checklist

- [x] Source code in TypeScript with strict types
- [x] Comprehensive documentation (README.md)
- [x] MIT License
- [x] Clear package.json with keywords and metadata
- [x] Build scripts (build, start, dev)
- [x] .gitignore and .npmignore configured
- [x] All 8 tools fully implemented with error handling
- [x] Circular dependency detection
- [x] Atomic batch operations
- [x] Analysis gate enforcement
- [x] Task reopening support
- [x] Rich error messages
- [x] Status transition validation
- [x] Finding requirement enforcement

## Marketplace Listing Keywords

- DAG task tracking
- Bug analysis
- Investigation workflow
- Dependency management
- Task orchestration
- Evidence collection
- MCP server
- Claude integration

## Version History

- **v1.0.0** - Initial marketplace release
  - 8 core tools
  - Full DAG support
  - Circular dependency detection
  - Analysis gate
  - Task reopening

## Support & Issues

For issues, feature requests, or contributions:
1. Create an issue with clear reproduction steps
2. Include example task definitions
3. Provide error messages and logs

## Future Roadmap

### Not in v1.0 (kept for future compatibility)
- Multi-agent routing by category
- Per-agent task queues
- Task claiming/locking
- Stale task detection
- Critical path analysis
- Crash recovery with stale detection

All future extensions will be backward compatible with v1.0.

## Design Philosophy

**"Core tools only. Every tool must earn its place."**

- Single-agent scope for simplicity
- Rich responses instead of new tools
- Opaque findings (server doesn't parse)
- Atomic operations for consistency
- Strong validation at all boundaries
- Clear error messages for debugging

## Conclusion

TaskTracker MCP Server is a production-ready tool for structured investigation workflows. The focused 8-tool API, comprehensive validation, and atomic operations make it ideal for AI-assisted bug analysis and investigation tasks.

Marketplace link: [tasktracker-mcp on MCP Marketplace](https://modelcontextprotocol.io/marketplace)
