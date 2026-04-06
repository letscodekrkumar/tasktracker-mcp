# TaskTracker — DAG-Based Task Tracking for Bug Analysis
# Design Document v4.0

TaskTracker manages analysis tasks as a directed acyclic graph (DAG). Tasks declare dependencies, enabling parallel execution. A single `update_task` tool resolves tasks with evidence. The `conclude_analysis` gate prevents premature wrap-up.

> **v4.0 Philosophy:** Core tools only. Every tool must earn its place. 8 tools total — no extras, no over-engineering.

---

## Version History

| Version | Change |
|---------|--------|
| v1.0 | Initial 6-tool surface |
| v2.0 | Added `add_tasks_bulk`, `conclude_category`, `get_critical_path`, `reopen_task` |
| v3.0 | Added `get_status_summary`, merged `update_task_deps` into `update_task`, agent optimization techniques |
| v4.0 | Trimmed to 8 core tools. Removed `get_status_summary`, `conclude_category`, `get_critical_path`. Full detail on every tool. |

---

## Design Decisions Log

| Decision | Rationale |
|----------|-----------|
| 8 tools only | Every tool is a token cost in the agent's context. Keep surface tight. |
| Single-agent scope | No agent registration, claiming, or filtered routing until multi-agent is actually needed |
| `get_status_summary()` removed | `get_ready_tasks()` + enriched `update_task()` response already covers it |
| `conclude_category()` removed | Over-engineering for single-agent linear flow |
| `get_critical_path()` removed | Single agent works priority-sorted queue; not needed |
| `stale_after_seconds` removed | Low value for single-agent; agent controls its own flow |
| `depends_on_finding` removed | Conditional deps add complexity without clear single-agent benefit |
| `update_task` covers dep rewiring | `depends_on` as optional param — no separate function needed |
| Category kept on tasks | Earns its keep for `conclude_analysis()` grouping even without expert routing |
| Response enrichment over new tools | Most agent drift fixed by richer responses, not more tools |
| `reopen_task` kept | Real need — blocked tasks do get unblocked externally |
| `add_tasks_bulk` kept | Genuinely reduces round trips; enriched response replaces follow-up call |

---

## Task Statuses

| Status | Meaning | Resolves task? | Unblocks dependents? |
|---------|---------|:---------------:|:--------------------:|
| `pending` | Not started | No | No |
| `in_progress` | Currently being worked on | No | No |
| `completed` | Done, finding = evidence | Yes | Yes |
| `skipped` | Not needed, finding = reason | Yes | Yes |
| `blocked` | Cannot proceed, finding = what's blocking | Yes | Yes |

**Resolved** = `completed`, `skipped`, or `blocked`. The `conclude_analysis` gate checks for unresolved tasks.

**Key rules:**
- `in_progress` does NOT unblock dependents — only resolved statuses do
- `skipped` and `blocked` are valid resolutions — they unblock dependents just like `completed`
- Once resolved, a task cannot revert to `pending` or `in_progress` (except via `reopen_task` for `blocked` only)

---

## MCP Tool Surface (8 tools)

| # | Tool | Type | One-line purpose |
|---|------|------|-----------------|
| 1 | `add_task(...)` | Write | Register one task with optional dependencies |
| 2 | `add_tasks_bulk(tasks)` | Write | Register full DAG in one atomic call |
| 3 | `update_task(task_id, ...)` | Write | Resolve task, update status, or rewire deps |
| 4 | `get_ready_tasks()` | Read | Priority-sorted list of tasks ready to execute |
| 5 | `get_all_tasks()` | Read | Full DAG snapshot with all task detail |
| 6 | `conclude_analysis()` | Gate | Block until all resolved; emit grouped summary |
| 7 | `reopen_task(task_id, reason)` | Write | Reopen a blocked task with history preserved |
| 8 | `reset()` | Write | Clear all tasks and start fresh |

---

## Detailed Tool Reference

---

### 1. `add_task(title, category, priority, depends_on=None)`

**Purpose:** Register a single new analysis task in the DAG.

**When to use:** When adding tasks one at a time, typically mid-investigation when a new task is discovered. For upfront planning, prefer `add_tasks_bulk()`.

```python
def add_task(
    title: str,
    category: str = "general",
    priority: str = "medium",
    depends_on: List[str] = None,
) -> str:
```

#### Parameters

| Param | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| `title` | str | — | Yes | Task description. Max 200 chars. |
| `category` | str | `"general"` | No | Task grouping. See categories below. |
| `priority` | str | `"medium"` | No | Execution priority. |
| `depends_on` | List[str] | `None` | No | Task IDs that must resolve before this task is ready. |

#### `category` values

| Value | Use for |
|-------|---------|
| `log_check` | Fetching, parsing, or searching log files |
| `config_verify` | Checking configuration files or settings |
| `root_cause` | Synthesizing findings into a root cause conclusion |
| `comparison` | Comparing two artifacts, versions, or states |
| `reproduce` | Attempting to reproduce the bug |
| `general` | Anything that doesn't fit the above |

> **Category matters:** `conclude_analysis()` groups output by category. Use it consistently so the final summary is readable. In future multi-agent setups, category will also drive expert agent routing.

#### `priority` values

| Value | Meaning |
|-------|---------|
| `high` | Should be done before medium/low tasks. Appears first in `get_ready_tasks()`. |
| `medium` | Default. Normal execution order. |
| `low` | Can wait. Done after high and medium tasks. |

#### Title best practices

Write titles as specific instructions, not vague descriptions. The title is what the agent reads when deciding what to do. Make it unambiguous.

```python
# Weak — agent has to infer what to do
"Fetch run logs"
"Check config"
"Analyze error"

# Strong — agent knows exactly what to do and what to find
"FETCH run.log between 14:00-15:00, search for TIMEOUT or ERROR entries"
"CHECK if config version in /etc/app.conf matches build timestamp from T2 finding"
"IDENTIFY the exact line and function where the retry loop originates"
```

#### Validation

- `depends_on` IDs must exist at insertion time
- Inserting this task must not create a circular dependency
- `category` must be one of the 6 allowed values
- `priority` must be one of `high`, `medium`, `low`

#### Returns

```
"Task T4 added. Dependencies: [T1, T3]. Status: pending.
 Ready now: ['T1', 'T2']"
```

Always includes the current ready queue so the agent knows what it can execute immediately.

#### Errors

```
ValueError: "Unknown task IDs in depends_on: ['T9'] — task does not exist"
ValueError: "Circular dependency detected: T4 → T1 → T4"
ValueError: "Invalid category 'logs' — must be one of: log_check, config_verify, ..."
```

#### Example

```python
# Mid-investigation: agent discovers it needs to check system state first
add_task(
    title="CHECK system health before fetching logs",
    category="config_verify",
    priority="high",
    depends_on=["T2"]
)
# → "Task T8 added. Dependencies: [T2]. Status: pending. Ready now: ['T1', 'T3']"
```

---

### 2. `add_tasks_bulk(tasks)`

**Purpose:** Register the full investigation DAG in a single atomic call. The agent gets a complete execution plan back — no follow-up `get_ready_tasks()` needed.

**When to use:** Always at the start of an investigation when the scope is known. Reduces round trips from N `add_task()` calls to 1.

```python
def add_tasks_bulk(
    tasks: List[Dict]
) -> str:
```

#### Parameters

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `tasks` | List[Dict] | Yes | List of task definition dicts |

Each dict in `tasks` supports:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `title` | str | required | Task description |
| `category` | str | `"general"` | Task category |
| `priority` | str | `"medium"` | Task priority |
| `depends_on` | List[str] | `None` | Dependency task IDs |

#### Atomicity

The entire batch is validated before any task is inserted. If any single task has an invalid dependency, bad category, or would create a cycle — the entire batch is rejected. Nothing is inserted on error.

#### Forward references

Tasks within the batch can reference each other's IDs in `depends_on`. Order in the list doesn't matter — the system resolves insertion order automatically.

#### Validation

- All `depends_on` IDs must exist (within the batch or in existing tasks)
- No circular dependencies within or across the batch
- All field values must be valid
- Entire batch rejected atomically on any error

#### Returns

Full execution plan so the agent can start immediately:

```
"6 tasks added.

 NOW (parallel):   T1 [high], T2 [high], T3 [medium]
 THEN (after T2):  T4 [high], T5 [medium]
 FINAL:            T6 [high] (after T1, T2, T3)

 Start with: ['T1', 'T2', 'T3']"
```

#### Errors

```
ValueError: "Unknown depends_on ID 'T99' in task 'Fetch system logs'"
ValueError: "Circular dependency: T4 → T2 → T4"
ValueError: "Batch rejected — 2 error(s) found. No tasks inserted."
```

#### Example

```python
add_tasks_bulk([
    {
        "title": "FETCH bug fields from ticket system",
        "category": "log_check",
        "priority": "high"
    },
    {
        "title": "EXTRACT machine ID and lot number from bug description",
        "category": "log_check",
        "priority": "high"
    },
    {
        "title": "MATCH build number to branch in version control",
        "category": "config_verify",
        "priority": "medium"
    },
    {
        "title": "FETCH run.log for extracted machine — search for TIMEOUT errors",
        "category": "log_check",
        "priority": "high",
        "depends_on": ["T2"]   # needs machine ID from T2
    },
    {
        "title": "FETCH system.log — correlate ERROR_TIMEOUT with run.log findings",
        "category": "log_check",
        "priority": "medium",
        "depends_on": ["T2"]   # needs machine ID from T2
    },
    {
        "title": "CROSS-REFERENCE all evidence and identify root cause",
        "category": "root_cause",
        "priority": "high",
        "depends_on": ["T1", "T2", "T3"]  # needs all upstream resolved
    },
])
# → "6 tasks added. NOW: ['T1','T2','T3']. THEN: ['T4','T5'] after T2. FINAL: ['T6']"
```

---

### 3. `update_task(task_id, status=None, finding=None, depends_on=None)`

**Purpose:** The workhorse. Resolves a task with evidence, updates its status, or rewires its dependencies. All params optional — pass only what needs to change.

**When to use:** After completing work on a task (status + finding), when marking in_progress, or when a new prerequisite is discovered mid-investigation (depends_on).

```python
def update_task(
    task_id: str,
    status: str = None,
    finding: str = None,
    depends_on: List[str] = None
) -> str:
```

#### Parameters

| Param | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| `task_id` | str | — | Yes | ID of the task to update |
| `status` | str | `None` | No | New status for the task |
| `finding` | str | `None` | No | Evidence, reason, or intent |
| `depends_on` | List[str] | `None` | No | Replace dependency list (pending tasks only) |

#### `status` transition rules

| From → To | Allowed? | Notes |
|-----------|----------|-------|
| `pending` → `in_progress` | ✅ | No dependency check. finding optional. |
| `pending` → `completed` | ✅ | All deps must be resolved. finding required. |
| `pending` → `skipped` | ✅ | No dependency check. finding required. |
| `pending` → `blocked` | ✅ | No dependency check. finding required. |
| `in_progress` → `completed` | ✅ | All deps must be resolved. finding required. |
| `in_progress` → `skipped` | ✅ | No dependency check. finding required. |
| `in_progress` → `blocked` | ✅ | No dependency check. finding required. |
| `completed` → anything | ❌ | Permanently resolved. |
| `skipped` → anything | ❌ | Permanently resolved. |
| `blocked` → anything | ❌ | Use `reopen_task()` to reopen. |

#### `finding` rules

| Status | Finding required? | Server enforces? |
|--------|------------------|-----------------|
| `completed` | Yes — evidence of what was observed | Rejects empty |
| `skipped` | Yes — reason why task is not needed | Rejects empty |
| `blocked` | Yes — what is missing or blocking | Rejects empty |
| `in_progress` | No — intent or plan (optional) | Not enforced |

**Finding formats:**

Plain text (always valid):
```
"No ERROR or WARN entries found near failure timestamp"
```

Structured JSON (recommended for log/correlation tasks):
```json
{
  "evidence_type": "log",
  "summary": "Repeated timeout errors starting at job launch",
  "confidence": "high",
  "raw_refs": ["run.log:842-910"],
  "note": "Correlates with system.log ERROR_TIMEOUT entries"
}
```

> The server stores `finding` as opaque text — never parses or validates it. The agent owns the content and quality. JSON is stored as a string.

#### Finding templates by category

Embed these in the agent system prompt for consistent, structured findings:

**`log_check`:**
```
What I searched:
Time window:
What I found (or did NOT find):
Confidence: high | medium | low
```

**`config_verify`:**
```
Config checked:
Expected value:
Actual value:
Match: yes | no | partial
Notes:
```

**`root_cause`:**
```
Hypothesis:
Evidence supporting:
Evidence against:
Confidence: high | medium | low
Conclusion:
```

**`comparison`:**
```
Compared: [A] vs [B]
Differences found:
Relevant to bug: yes | no
Notes:
```

**`reproduce`:**
```
Steps attempted:
Result:
Reproduced: yes | no | partial
```

#### `depends_on` rewiring

Use when a prerequisite is discovered mid-investigation that wasn't planned upfront:

```python
# Agent realizes T3 needs T8 to run first
add_task("T8", title="CHECK system state before log fetch")
update_task("T3", depends_on=["T1", "T8"])  # replaces T3's existing deps
```

Rules for `depends_on` update:
- Task must be `pending` — cannot rewire `in_progress` or resolved tasks
- Replaces the entire `depends_on` list — not additive
- Validates no cycles are introduced
- Returns new readiness state of the task

#### Validation

- Task must exist
- `finding` must be non-empty for `completed`/`skipped`/`blocked`
- `completed` requires all `depends_on` tasks to be resolved first
- Cannot revert a resolved task to `pending`/`in_progress`
- `depends_on` update only on `pending` tasks
- `depends_on` IDs must exist, no cycles

#### Returns

On resolve — enriched with progress and next steps:
```
"Task T3 → completed. Progress: 4/8 (50%).
 Unlocked: ['T5', 'T6']. Ready now: ['T5', 'T6']
 Still waiting: ['T7'] (deps: T5, T6)
 Remaining: 4 tasks | Ready: 2 | Waiting: 2"
```

On `in_progress`:
```
"Task T3 → in_progress. Progress: 3/8 (37%).
 Ready now: ['T1', 'T4']"
```

On dependency rewire:
```
"T3 deps updated → ['T1', 'T8']. Now waiting on T8 (unresolved).
 Was: ready. Status changed to: waiting."
```

When dependencies unmet for `completed`:
```
"BLOCKED: Task T6 depends on unresolved tasks: ['T4'].
 Chain: T4 (pending) <- T2 (pending). Resolve those first."
```

#### Errors

```
ValueError: "Task 'T99' does not exist"
ValueError: "Finding required for status 'completed' — empty finding rejected"
ValueError: "Task T3 is already completed — cannot transition to in_progress"
ValueError: "Cannot update depends_on on task T3 — status is in_progress, not pending"
ValueError: "Circular dependency: T3 → T8 → T3"
```

#### Usage patterns

```python
# 1. Mark in_progress with intent before starting work
update_task("T3", status="in_progress",
            finding="Fetching run.log from archive server")

# 2. Resolve with plain text finding
update_task("T3", status="completed",
            finding="Found 3 TIMEOUT errors at 14:22:01, 14:22:45, 14:23:12")

# 3. Resolve with structured JSON finding
update_task("T3", status="completed", finding=json.dumps({
    "evidence_type": "log",
    "summary": "3 TIMEOUT errors found in 90-second window post job start",
    "confidence": "high",
    "raw_refs": ["run.log:842", "run.log:891", "run.log:934"],
    "note": "All errors occur after the retry loop initiates"
}))

# 4. Skip with reason
update_task("T4", status="skipped",
            finding="Machine type X200 has no IMC subsystem — task not applicable")

# 5. Block with explanation
update_task("T5", status="blocked",
            finding="Log archive server returning 403 — access not provisioned for this machine ID")

# 6. Rewire deps mid-investigation
add_task("T8", title="VERIFY archive access credentials before log fetch")
update_task("T5", depends_on=["T2", "T8"])
```

---

### 4. `get_ready_tasks()`

**Purpose:** Return all tasks the agent can execute right now, sorted by priority.

**When to use:** At the start of each execution loop iteration to find the next task to work on. Also after `update_task()` if you want just the ready queue without full progress detail.

```python
def get_ready_tasks() -> List[Dict]:
```

#### Parameters

None.

#### What "ready" means

A task is ready when ALL of the following are true:
- `status == "pending"`
- All `depends_on` task IDs are in a resolved status (`completed`, `skipped`, or `blocked`)

Note: `in_progress` upstream tasks do NOT count as resolved — the dependent stays waiting.

#### Returns

List of task dicts, sorted high → medium → low priority:

```python
[
    {
        "id": "T4",
        "title": "FETCH run.log for extracted machine — search for TIMEOUT errors",
        "category": "log_check",
        "priority": "high",
        "depends_on": ["T2"]
    },
    {
        "id": "T5",
        "title": "FETCH system.log — correlate ERROR_TIMEOUT with run.log",
        "category": "log_check",
        "priority": "medium",
        "depends_on": ["T2"]
    }
]
```

Returns empty list `[]` when no tasks are ready (all either waiting on deps, in_progress, or resolved).

#### When to call

```
# Standard execution loop:
while True:
    ready = get_ready_tasks()
    if not ready:
        break  # nothing left to do — call conclude_analysis()
    task = ready[0]  # highest priority
    # do the work
    update_task(task["id"], status="completed", finding="...")
```

#### Example output

```
[
  {"id": "T1", "title": "FETCH bug fields from ticket",    "category": "log_check",    "priority": "high",   "depends_on": []},
  {"id": "T2", "title": "EXTRACT machine ID from bug",     "category": "log_check",    "priority": "high",   "depends_on": []},
  {"id": "T3", "title": "MATCH build number to branch",    "category": "config_verify","priority": "medium", "depends_on": []}
]
```

---

### 5. `get_all_tasks()`

**Purpose:** Full DAG snapshot — all tasks, all statuses, all findings, complete dependency state, and progress header.

**When to use:** When you need the complete picture. Useful for debugging the DAG, checking why a task is waiting, or reviewing all findings before concluding.

```python
def get_all_tasks() -> Dict:
```

#### Parameters

None.

#### Returns

```python
{
    "progress": "Progress: 3/7 (43%)",  # resolved / total
    "ready": 2,                          # pending + all deps resolved
    "waiting": 1,                        # pending + deps unresolved
    "in_progress": 1,                    # currently in_progress
    "tasks": [
        {
            "id": "T1",
            "title": "FETCH bug fields from ticket",
            "category": "log_check",
            "priority": "high",
            "status": "completed",
            "finding": "Bug filed 2026-03-28. Affected build: 4.2.1-rc3. Machine: X200-lot-7.",
            "depends_on": [],
            "unmet_deps": [],            # deps that are not yet resolved
            "created": "2026-04-01T10:30:00",
            "resolved_at": "2026-04-01T10:32:14"
        },
        {
            "id": "T4",
            "title": "FETCH run.log for extracted machine",
            "category": "log_check",
            "priority": "high",
            "status": "pending",
            "finding": None,
            "depends_on": ["T2"],
            "unmet_deps": [],            # T2 is resolved, so T4 is ready
            "created": "2026-04-01T10:30:00",
            "resolved_at": None
        },
        {
            "id": "T6",
            "title": "CROSS-REFERENCE all evidence",
            "category": "root_cause",
            "priority": "high",
            "status": "pending",
            "finding": None,
            "depends_on": ["T1", "T2", "T3"],
            "unmet_deps": ["T3"],        # T3 still pending — T6 is waiting
            "created": "2026-04-01T10:30:00",
            "resolved_at": None
        }
        # ... all other tasks
    ]
}
```

#### Key fields

| Field | Description |
|-------|-------------|
| `progress` | `"Progress: resolved/total (pct%)"` |
| `ready` | Count of tasks with all deps resolved, status pending |
| `waiting` | Count of tasks with unresolved deps |
| `in_progress` | Count of tasks currently in_progress |
| `unmet_deps` | Per-task list of deps not yet resolved — shows exactly what's blocking |

---

### 6. `conclude_analysis()`

**Purpose:** The gate. Refuses to close until every task is resolved. When blocked, tells the agent exactly what to do next. When all resolved, produces a category-grouped, timed summary.

**When to use:** When `get_ready_tasks()` returns an empty list and `get_all_tasks()` shows no in_progress tasks — all work appears done. Call this to either confirm completion or learn what's still missing.

```python
def conclude_analysis() -> str:
```

#### Parameters

None.

#### Behavior

1. Checks for any task with status `pending` or `in_progress`
2. If any exist → blocked response with explicit next actions
3. If none exist → full summary with timing

#### Returns (when blocked)

Lists unresolved tasks and tells the agent exactly what is immediately actionable:

```
CANNOT CONCLUDE: 2 task(s) still unresolved.

  Unresolved:
    - T5 [pending, READY]     FETCH system.log — correlate ERROR_TIMEOUT
    - T6 [in_progress]        CROSS-REFERENCE all evidence

  DO THIS NEXT:
    → T5 is ready — complete it first
    → T6 is in_progress — resolve it with a finding

After resolving both, call conclude_analysis() again.
```

#### Returns (when complete)

Full category-grouped summary with timing:

```
Analysis complete. 7 task(s) resolved (5 completed, 1 skipped, 1 blocked).
Duration: 2m 34s. Started: 10:30:00. Concluded: 10:32:34.

## Completed (5)

### log_check (3)
  - FETCH bug fields (T1): Bug filed 2026-03-28. Build: 4.2.1-rc3. Machine: X200-lot-7.
  - FETCH run.log (T4): 3 TIMEOUT errors at 14:22:01, 14:22:45, 14:23:12
  - FETCH system.log (T5): ERROR_TIMEOUT entries at matching timestamps — confirmed correlation

### config_verify (1)
  - MATCH build to branch (T3): Build 4.2.1-rc3 maps to branch release/4.2 at commit a3f9c12

### root_cause (1)
  - CROSS-REFERENCE evidence (T6): Retry loop in RequestHandler.cs:89 triggers on TIMEOUT,
    causing cascading failures. Consistent across run.log and system.log.

## Skipped (1)
  - FETCH IMC logs (T2): Machine X200 has no IMC subsystem — not applicable

## Blocked (1)
  - FETCH source at commit (T7): Commit SHA a3f9c12 not found in repo — mirror sync pending
```

#### Hard guarantee

`conclude_analysis()` will never return a success summary while any task is unresolved. The gate cannot be bypassed.

---

### 7. `reopen_task(task_id, reason)`

**Purpose:** Reopen a `blocked` task when its blocker has been resolved externally. Preserves the original finding in history.

**When to use:** When a task was marked `blocked` (e.g., missing file, access denied) and the blocker has since been resolved — file is now available, access has been granted, etc.

```python
def reopen_task(
    task_id: str,
    reason: str
) -> str:
```

#### Parameters

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `task_id` | str | Yes | ID of the blocked task to reopen |
| `reason` | str | Yes | Non-empty explanation of what changed |

#### Who can be reopened

| Status | Can reopen? | Notes |
|--------|-------------|-------|
| `blocked` | ✅ | Returns to `pending` |
| `completed` | ❌ | Permanently resolved |
| `skipped` | ❌ | Permanently resolved |
| `pending` | ❌ | Already open |
| `in_progress` | ❌ | Already open |

#### What happens on reopen

1. Original `finding` is moved to `finding_history` (not deleted)
2. `finding` is cleared
3. `status` set back to `pending`
4. `reopen_count` incremented
5. Task re-enters ready queue if all deps are resolved

#### Returns

When task becomes ready after reopen:
```
"Task T7 reopened → pending. Original finding preserved in history.
 Reason: Commit SHA a3f9c12 found in mirror repo after sync completed.
 Status: ready (all dependencies resolved).
 Progress: 5/7 (71%) — 2 tasks still unresolved."
```

When task is still waiting on deps after reopen:
```
"Task T7 reopened → pending. Original finding preserved in history.
 Reason: Archive access credentials updated.
 Status: waiting on ['T5'] (unresolved).
 Resolve T5 first, then T7 will become ready."
```

#### Errors

```
ValueError: "Task 'T99' does not exist"
ValueError: "Task T3 cannot be reopened — status is 'completed', not 'blocked'"
ValueError: "reason cannot be empty"
```

#### Example

```python
# T7 was blocked: "Commit SHA not found in repo"
# Repo mirror has since synced

reopen_task(
    "T7",
    reason="Mirror repo synced — commit SHA a3f9c12 is now available"
)
# → "Task T7 reopened → pending. Ready (all deps resolved). Progress: 5/7 (71%)"

# Now resolve it
update_task("T7", status="completed",
            finding="Source fetched at commit a3f9c12. RequestHandler.cs confirmed.")
```

---

### 8. `reset()`

**Purpose:** Clear all tasks, findings, and history. Start a completely fresh session.

**When to use:** Starting a new investigation, or recovering from a badly misconfigured task graph that isn't worth unwinding task by task.

```python
def reset() -> str:
```

#### Parameters

None.

#### Behavior

- Deletes all tasks
- Deletes all findings and finding_history
- Resets task ID counter (next task will be T1 again)
- Resets session timer

#### ⚠ Warning

This operation is **irreversible**. All task data, findings, and history are permanently deleted. There is no undo.

#### Returns

```
"Session reset. All 7 tasks cleared. Ready for new analysis."
```

#### Example

```python
reset()
# → "Session reset. All 7 tasks cleared. Ready for new analysis."

# Safe to start fresh
add_tasks_bulk([...])
```

---

## Task Data Structure

```python
{
    "id": "T4",                    # Auto-assigned. T1, T2, T3... in insertion order.
    "title": "FETCH run.log — search for TIMEOUT errors",
    "category": "log_check",       # log_check | config_verify | root_cause |
                                   # comparison | reproduce | general
    "priority": "high",            # high | medium | low
    "status": "pending",           # pending | in_progress | completed | skipped | blocked
    "finding": None,               # Current evidence or reason (opaque string)
    "finding_history": [],         # Prior findings from reopen_task() cycles
    "depends_on": ["T2", "T3"],    # Task IDs that must resolve before this is ready
    "unmet_deps": ["T3"],          # Subset of depends_on that are not yet resolved
    "created": "2026-04-01T10:30:00",
    "resolved_at": None,           # Timestamp when status changed to resolved
    "reopen_count": 0              # Number of times reopened via reopen_task()
}
```

---

## DAG Dependency Rules

1. **No circular dependencies** — `add_task` and `add_tasks_bulk` validate on every insertion
2. **Ready = pending AND all deps resolved** — `in_progress` upstream does not count
3. **Skipped/blocked unblock dependents** — a path closing is a resolution; dependents proceed
4. **No depends_on = immediately ready** — tasks with empty deps enter the ready queue on creation
5. **`in_progress` carries no structural weight** — informational only, does not affect the DAG
6. **`depends_on` can be rewired mid-investigation** — via `update_task(depends_on=[...])`, pending tasks only
7. **Only `blocked` tasks can be reopened** — `completed` and `skipped` are permanently resolved

---

## Finding Contract

### Definition

`finding` is a single opaque string on every task. The server stores it as text — never parses, validates, or enforces structure. The agent owns the content and quality.

### When finding is required

| Status | Required? | Enforcement | Content |
|--------|-----------|-------------|---------|
| `completed` | Yes | Server rejects empty | Evidence of what was observed |
| `skipped` | Yes | Server rejects empty | Reason why task is not needed |
| `blocked` | Yes | Server rejects empty | What is missing or preventing progress |
| `in_progress` | No | Not enforced | Intent or plan (optional) |

### Hard prohibitions

- **Do NOT omit findings for resolved tasks** — server rejects them
- **Do NOT overwrite findings after resolution** — once resolved, findings are locked
- **Do NOT treat "no logs found" as neutral** — absence of evidence MUST be explicitly stated
- **Do NOT assume the server understands JSON** — it stores the string as-is

### How findings are used at conclusion

At `conclude_analysis()`, findings from all tasks are assembled into the final summary:
1. Tasks grouped by `category`
2. Within each category, grouped by `status`
3. Each finding printed as the evidence trail for that task
4. Duration calculated from session start to conclusion

---

## Agent Optimization Patterns

These are prompt-level conventions — not server features. Embed in the agent system prompt.

### Execution loop

```
INVESTIGATION LOOP:
  1. Call add_tasks_bulk() to declare all known tasks upfront
  2. LOOP:
       a. Call get_ready_tasks()
       b. If empty → call conclude_analysis()
       c. Pick highest priority task from result
       d. Call update_task(task_id, "in_progress", "Intent: ...")
       e. Do the work
       f. Call update_task(task_id, "completed"|"skipped"|"blocked", finding)
       g. Read unlocked tasks from response
       h. Repeat from (a)
  3. EXIT only via conclude_analysis()

RULES:
  - Never skip a ready task without marking it skipped with a reason
  - Never call conclude_analysis() when get_all_tasks() shows in_progress tasks
  - If you discover a missing prerequisite, add_task() + update_task(depends_on=...)
  - If a blocked task's blocker resolves, call reopen_task() before moving on
```

### Pre-mortem convention

Always add this as the first task in every investigation:

```python
add_task(
    title="LIST all assumptions being made before investigating — what could be wrong?",
    category="general",
    priority="high"
)
```

Forces assumption surfacing before diving in. Catches wrong assumptions at the start, not at conclusion.

### Dead end handling

Instead of immediately blocking a task, try one alternative first:

```
If you hit a dead end:
  1. Add a new task: "FIND alternative approach for [what was needed]"
  2. Only mark original task blocked if the alternative also fails
```

### Confidence gate before conclusion

Before calling `conclude_analysis()`, self-check all findings:

```
Before concluding:
  1. Review all findings via get_all_tasks()
  2. For any finding with confidence == "low":
       - Can it be strengthened with another task?
       - If yes, add that task before concluding
  3. For any finding that says "not found" or "no signal":
       - Is the absence explicitly stated? It must be.
  4. Then call conclude_analysis()
```

---

## Future: Multi-Agent Extension Points

Current design is single-agent. When multi-agent is needed, these are the additions — nothing in the current design blocks them.

| Feature | Addition needed |
|---------|----------------|
| Expert routing by category | `register_agent(agent_id, specializes_in: List[str])` |
| Per-agent task queue | `get_ready_tasks(agent_id=None, category=None)` filter param |
| Task claiming / locking | `claim_task(task_id, agent_id)` |
| Stale detection | `stale_after_seconds` param on `add_task` |
| Critical path | `get_critical_path()` — already specced |
| Crash recovery | Stale detection + `reopen_task()` already covers this |
