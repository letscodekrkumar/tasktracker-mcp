# Quick Start - TaskTracker MCP Server

Get up and running in 5 minutes.

## 1. Install & Build

```bash
cd mcp-server
npm install
npm run build
```

## 2. Start the Server

```bash
npm start
```

You should see:
```
TaskTracker MCP Server running on stdio
```

## 3. Connect in Your MCP Client

### Claude Desktop
Edit `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "tasktracker": {
      "command": "tasktracker"
    }
  }
}
```

### Cursor or other MCP clients
Similar configuration with the `tasktracker` command.

## 4. Example: Simple Bug Investigation

In Claude, after connecting:

**You:** "Start a bug investigation. Use TaskTracker to track these tasks:
1. FETCH bug details from ticket (high priority)
2. EXTRACT machine ID from description (high priority, depends on task 1)
3. FETCH run.log - search for errors (high priority, depends on task 2)
4. IDENTIFY root cause from evidence (high priority, depends on tasks 1-3)"

**Claude will:**
1. Call `add_tasks_bulk` with all 4 tasks
2. Get back: Task IDs (T1-T4) and execution plan
3. Call `get_ready_tasks()` → Gets T1 (no dependencies)
4. You do the work, Claude calls `update_task("T1", status="completed", finding="...")`
5. Now T2 becomes ready (dep on T1 resolved)
6. Continue through T3, T4
7. Call `conclude_analysis()` when all resolved
8. Get category-grouped summary with all findings

## 5. Key Commands

```python
# Add task(s)
add_task(title="...", category="log_check", priority="high", depends_on=[...])
add_tasks_bulk(tasks=[...])

# Update progress
update_task(task_id="T1", status="in_progress")
update_task(task_id="T1", status="completed", finding="Evidence found: ...")

# Get status
get_ready_tasks()  # What can we do now?
get_all_tasks()    # Full picture
conclude_analysis() # Are we done?

# Recovery
reopen_task("T3", reason="Blocker resolved")
reset()  # Start over
```

## 6. Understanding Task Status

```
pending → in_progress → completed (with finding)
       │              └─ skipped (with reason)
       └──────────────── blocked (with explanation)

Rules:
- in_progress doesn't unblock dependents
- completed/skipped/blocked DO unblock dependents
- Can only move backward with reopen_task() for blocked tasks
```

## 7. Finding Requirements

When resolving a task, you MUST provide a finding:

```python
# ✅ Valid - all have findings
update_task("T1", status="completed", finding="3 ERROR entries at 14:22, 14:45, 15:01")
update_task("T2", status="skipped", finding="Machine has no IMC subsystem - not applicable")
update_task("T3", status="blocked", finding="Archive server returning 403 - access denied")

# ❌ Invalid - no finding
update_task("T1", status="completed")  # ERROR: Finding required!
```

## 8. Categories for Organization

Use these categories to organize your investigation:

- **log_check** - Analyzing log files
- **config_verify** - Checking configuration/settings
- **root_cause** - Synthesizing findings into conclusion
- **comparison** - Comparing two things
- **reproduce** - Trying to reproduce the bug
- **general** - Everything else

Example:
```python
add_task(title="FETCH run.log", category="log_check", priority="high")
add_task(title="Identify root cause", category="root_cause", priority="high", depends_on=["T1"])
```

## 9. Dependency Chains

Declare dependencies to ensure work happens in the right order:

```python
add_tasks_bulk([
    {"title": "Get machine ID", ...},           # T1 (no deps, ready now)
    {"title": "Get access credentials", ...},   # T2 (no deps, ready now)
    {"title": "Fetch logs from machine", ...,
     "depends_on": ["T1", "T2"]},              # T3 (waits for T1 & T2)
    {"title": "Analyze logs", ...,
     "depends_on": ["T3"]}                      # T4 (waits for T3)
])
```

## 10. Common Patterns

### The Investigation Loop
```python
while get_ready_tasks():
    task = get_ready_tasks()[0]  # highest priority
    update_task(task.id, status="in_progress")
    # ... do the work ...
    update_task(task.id, status="completed", finding="...")

conclude_analysis()  # Final summary
```

### Mid-Discovery Task Addition
```python
# Realize during investigation that you need another task first
add_task("Check credentials", category="config_verify", priority="high")

# Update existing task to depend on the new one
update_task("T3", depends_on=["T1", "T4"])  # T4 is the new task
```

### Handling Blockers
```python
# Hit a blocker
update_task("T5", status="blocked", 
           finding="Server returning 403 - awaiting access grant")

# Later, when blocker resolved...
reopen_task("T5", reason="Access permissions updated")

# It's back to pending and ready if deps are met
update_task("T5", status="completed", finding="Successfully fetched and analyzed...")
```

## 11. Troubleshooting

### "Task 'T99' does not exist"
→ You referenced a task ID that hasn't been created. Check the ID.

### "Circular dependency detected"
→ You're trying to create a situation where T1 depends on T2 and T2 depends on T1. Not allowed.

### "Finding required for status 'completed'"
→ You must provide a finding (evidence) when completing a task.

### "Task T3 is already completed — cannot transition to in_progress"
→ Completed tasks are final. Use `reopen_task()` only for blocked tasks.

## 12. Run Examples

See real examples in action:

```bash
npm run build
node dist/examples.js
```

Shows:
1. Full bug investigation (5 tasks)
2. Mid-investigation discovery
3. Blocked and reopened task
4. Circular dependency detection
5. Invalid status transition

---

## Next Steps

1. **Read the full spec**: [TaskTracker_Design_v4.md](../TaskTracker_Design_v4.md)
2. **Explore the implementation**: [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)
3. **See the marketplace info**: [MARKETPLACE.md](./MARKETPLACE.md)
4. **Review the README**: [README.md](./README.md)

---

## Support

For issues or questions:
1. Check the error message — they're designed to be actionable
2. Review the examples in `src/examples.ts`
3. Check the full spec: `TaskTracker_Design_v4.md`
4. Create an issue on GitHub with:
   - What you tried
   - What you expected
   - What happened instead
   - The exact error message
