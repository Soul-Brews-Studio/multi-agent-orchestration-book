---
sidebar_position: 17
title: "Appendix A: Command Reference"
---

# Appendix A: Command Reference

A complete reference for every command and tool call referenced in this book. Organized by surface: `maw` CLI, tmux spawn pattern, `Agent` tool, `TeamCreate` protocol, and supporting tools (`SendMessage`, `TaskCreate`, `TaskList`, `TaskUpdate`).

---

## A.1 `maw` CLI (maw-js v2.0.0-alpha.2)

### Agent lifecycle

| Command | Purpose |
|---------|---------|
| `maw wake <oracle> --new <name>` | Create a new tmux session running a Claude agent under the given oracle identity. |
| `maw wake <oracle> --new <name> --issue <n>` | As above, seeded with GitHub issue `n`. *Caveat*: cross-repo resolution is broken in v2.0.0-alpha.2 (see Chapter 14.6). |
| `maw wake <oracle> --new <name> --repo <owner/repo>` | Target a specific repo. *Caveat*: interacts poorly with `--new`. |
| `maw peek <name>` | Live-render the named tmux session's terminal. |
| `maw overview <name1> <name2> ...` | War-room view: state of multiple agents at once. |
| `tmux kill-session -t <name>` | Hard stop an agent. Manual cleanup; see Appendix B for shutdown protocol. |

### Messaging

| Command | Purpose |
|---------|---------|
| `maw hey <target> "<message>"` | Send a plain-text message to another oracle's tmux pane. Federation-native. |
| `maw inbox write "<message>"` | Persist a message to the oracle's inbox. Survives session death. |
| `maw inbox read` | Read unread inbox messages. |
| `maw inbox list` | List all inbox entries. |

### Federation

| Command | Purpose |
|---------|---------|
| `maw peers` | List known federation peers. |
| `maw federation status` | Show health across peers. |
| `maw update` | Pull latest maw-js, re-link SDK, refresh plugin catalog. |

### Plugins

| Command | Purpose |
|---------|---------|
| `maw plugin install <name>` | Install a plugin from maw-commands catalog via `copyFileSync`. |
| `maw plugin install <name> --dir <path>` | Install to a custom directory. |
| `maw plugin list` | List installed plugins. |
| `maw plugin remove <name>` | Remove an installed plugin. |

### Observability

| Command | Purpose |
|---------|---------|
| `maw worktrees` | List all git worktrees, flag stale ones. |
| `maw doctor` | Health check: SDK link, federation, plugin catalog, node version. |
| `maw feed` | Recent activity across the federation. |
| `maw costs` | Token and API cost summary. |
| `maw logs` | Tail the maw-js server log. |

---

## A.2 Tmux Spawn Pattern (Tier 3)

The working pattern (attempt 4 from Chapter 14 / blog post):

```bash
MAW_JS="/home/neo/Code/github.com/Soul-Brews-Studio/maw-js"

tmux new-session -d -s wasm-host -c "$MAW_JS"
tmux send-keys -t wasm-host "claude --dangerously-skip-permissions -p '
  STEP 1: Read the issue — gh issue view 317
  STEP 2: Read code — src/cli/command-registry.ts
  STEP 3: Implement host functions
  STEP 4: Branch, commit, push
  STEP 5: Every 5 min, report:
    maw hey mawjs-oracle \"[wasm-host] PROGRESS: <what>\"
  STEP 6: When done or stuck:
    maw hey mawjs-oracle \"[wasm-host] DONE: <branch>\"
    maw hey mawjs-oracle \"[wasm-host] STUCK: <reason>\"
'" Enter
```

**Notes**:
- `-d` detaches immediately; session runs in background.
- `-c <dir>` sets the working directory.
- `claude -p "<prompt>"` runs the prompt and exits. Bake all instructions, including reporting, into the initial prompt.
- Follow-up instructions can be sent with a second `tmux send-keys` call, but the agent must still be alive to receive them.

---

## A.3 `Agent` Tool (Tier 1)

In-process subagent. Spawned from inside a running Claude session.

```json
{
  "description": "Explore Elysia source tree",
  "subagent_type": "Explore",
  "prompt": "Find where the error() helper is defined in node_modules/elysia/src. Report file path and exports."
}
```

### Fields

| Field | Required | Notes |
|-------|----------|-------|
| `description` | Yes | 3-5 word label. |
| `prompt` | Yes | Full self-contained task. Agent has no memory of the parent conversation. |
| `subagent_type` | No | `general-purpose` (default), `Explore`, `Plan`, or named agent. |
| `model` | No | `sonnet`, `opus`, `haiku`. Haiku for parallel research, Opus for debates. |
| `isolation` | No | `worktree` creates a git worktree; auto-cleans if no changes. |
| `run_in_background` | No | Returns immediately; result delivered later. |

### Typical invocations

**Research swarm** (5 parallel Haiku):

```json
{
  "description": "Map Elysia plugin system",
  "subagent_type": "Explore",
  "model": "haiku",
  "prompt": "Read ψ/learn/elysiajs/elysia/origin/src/plugin.ts and report the plugin lifecycle in under 200 words."
}
```

**Architecture debate** (3 Opus):

```json
{
  "description": "SDK-everywhere vs hybrid",
  "model": "opus",
  "prompt": "Advocate for per-endpoint SDK wrappers (20+ methods). Full arguments in 400 words. Address maintenance burden, type safety, plugin ergonomics."
}
```

**Worktree implementation**:

```json
{
  "description": "Migrate API batch 1 (7 files)",
  "isolation": "worktree",
  "prompt": "In this worktree, migrate src/api/{auth,users,posts,...}.ts from Hono to Elysia. Follow the pattern in the already-migrated src/api/health.ts. Commit and push feat/elysia-batch1. Report back with branch name."
}
```

---

## A.4 `TeamCreate` Protocol (Tier 2)

### Create a team

Open a coordinated squad. Lead agent (the caller) is implicit. Teammates are spawned via `Agent` calls referencing the team.

```json
// TeamCreate
{
  "name": "wasm-hardening",
  "members": [
    {"name": "safety", "role": "verify memory and gas caps"},
    {"name": "tester", "role": "write integration tests"},
    {"name": "rust-verifier", "role": "confirm Rust SDK compiles"}
  ]
}
```

### Assign tasks

```json
// TaskCreate
{
  "subject": "Verify 16MB memory cap enforcement",
  "activeForm": "Verifying memory cap",
  "owner": "safety"
}
```

### Teammate reports back

```json
// From teammate, via SendMessage
{
  "to": "team-lead",
  "summary": "Memory cap verified",
  "message": "All 3 allocation paths bounded at 16MB. See commit abc123."
}
```

### Shutdown protocol

Lead requests shutdown; teammate approves; lead deletes team.

```json
// Lead → teammate
{"to": "safety", "message": {"type": "shutdown_request", "reason": "work complete"}}

// Teammate → lead
{"to": "team-lead", "message": {"type": "shutdown_response", "request_id": "...", "approve": true}}

// Lead
// TeamDelete({name: "wasm-hardening"})
```

---

## A.5 Task Tools

| Tool | Purpose |
|------|---------|
| `TaskCreate` | Add a task to the shared list. `subject`, `activeForm`, optional `owner`. |
| `TaskList` | Read the full task list. |
| `TaskGet({taskId})` | Read one task. |
| `TaskUpdate({taskId, status})` | Move a task to `in_progress`, `completed`, or `deleted`. |
| `TaskOutput({taskId})` | Pull output produced by the task owner. |
| `TaskStop({taskId})` | Abort a running task. |

### Dependencies

```json
{"taskId": "3", "addBlockedBy": ["1", "2"]}
```

Task 3 will not start until 1 and 2 are complete.

---

## A.6 `SendMessage` (Tier 2 Message Bus)

```json
{
  "to": "safety",
  "summary": "Review this PR",
  "message": "Please verify wasm/host-functions.ts against the gas budget in spec.md."
}
```

- `to`: teammate name, or `"*"` for broadcast (use sparingly).
- `summary`: 5-10 word preview.
- `message`: plain text, or structured protocol object (shutdown, plan approval).

---

## A.7 Cron And Scheduled Agents

| Tool | Purpose |
|------|---------|
| `CronCreate` | Schedule a recurring agent. |
| `CronList` | List scheduled agents. |
| `CronDelete` | Cancel a schedule. |
| `ScheduleWakeup` | Self-pace inside a `/loop` skill invocation. |
| `RemoteTrigger` | Fire a scheduled agent manually. |

Used in Chapter 9 for the 5-minute cron loop that built 17 plugins.

---

## A.8 Worktree Tools

| Tool | Purpose |
|------|---------|
| `EnterWorktree` | Move into an isolated worktree for the rest of the session. |
| `ExitWorktree` | Leave the worktree; return to primary checkout. |

Use with `Agent({isolation: "worktree"})` for per-agent isolation.

---

## A.9 Plan Mode

| Tool | Purpose |
|------|---------|
| `EnterPlanMode` | Switch to plan-only mode; no writes until approved. |
| `ExitPlanMode` | Commit the plan and resume normal operation. |

Useful when spawning agents you do not fully trust yet — have them plan first, approve, then execute.

---

## A.10 Cross-Reference

| Chapter | Commands used |
|---------|---------------|
| Ch 3 (Message Bus) | `SendMessage`, `maw hey`, `maw inbox` |
| Ch 4 (Task Tracking) | `TaskCreate`, `TaskList`, `TaskUpdate` |
| Ch 5 (Research Swarm) | `Agent` × 5 Haiku |
| Ch 6 (Debate) | `Agent` × 3 Opus |
| Ch 7 (Implementation Team) | `TeamCreate`, `Agent` with `isolation: worktree` |
| Ch 8 (Federation Agent) | `tmux new-session`, `claude -p`, `maw hey`, `maw peek` |
| Ch 9 (Cron Loop) | `CronCreate`, `ScheduleWakeup` |
| Ch 13 (Human Sees) | `maw peek`, `maw overview` |
| Ch 15 (Future) | `maw wake --issue --team` (proposed) |
