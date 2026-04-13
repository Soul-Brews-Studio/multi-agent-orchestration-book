---
sidebar_position: 18
title: "Appendix B: Spawn Pattern Cheatsheet"
---

# Appendix B: Spawn Pattern Cheatsheet

All three tiers on one page. Decision flowchart, one-liners, the shutdown protocols that actually work.

---

## B.1 Decision Flowchart

```
                      ┌─────────────────────────┐
                      │ What's the task?        │
                      └───────────┬─────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
     < 5 min,                 5-30 min,              > 30 min OR
    research/debate          coordinated              cross-machine OR
    pure read                implementation           overnight
          │                       │                       │
          ▼                       ▼                       ▼
    ┌──────────┐           ┌─────────────┐         ┌──────────────┐
    │  Tier 1  │           │   Tier 2    │         │   Tier 3     │
    │ Agent    │           │ TeamCreate  │         │ tmux +       │
    │ tool     │           │ + SendMsg   │         │ claude -p    │
    └──────────┘           └─────────────┘         └──────────────┘
         │                       │                       │
    Spawn 3-5               Named members,         Bake `maw hey`
    parallel,               task tracking,         into prompt.
    results inline          graceful shutdown      Monitor via
                                                   `maw peek`.
```

**Shortcut rules**:

- Needs to survive my session dying? → **Tier 3**.
- Nat must see the work? → **Tier 2 or 3**.
- Results feed my next decision within 5 min? → **Tier 1**.
- Coordination required (tasks depend on each other)? → **Tier 2**.

---

## B.2 One-Liners By Tier

### Tier 1 — Agent tool

Parallel research (3 Haiku):

```ts
Agent({description: "Map plugin lifecycle", subagent_type: "Explore", model: "haiku",
       prompt: "Read ψ/learn/.../plugin.ts, report lifecycle in 200 words."})
```

Architecture debate (3 Opus, one call each):

```ts
Agent({description: "Advocate SDK-everywhere", model: "opus",
       prompt: "Argue for per-endpoint SDK wrappers. 400 words. Address maintenance, types, ergonomics."})
```

Worktree implementation:

```ts
Agent({description: "Migrate API batch 1", isolation: "worktree",
       prompt: "Migrate src/api/{auth,users,posts}.ts to Elysia. Pattern: health.ts. Commit feat/elysia-batch1."})
```

### Tier 2 — TeamCreate

Create, assign, report, shutdown:

```ts
TeamCreate({name: "wasm-hardening", members: [
  {name: "safety", role: "verify memory/gas caps"},
  {name: "tester", role: "integration tests"},
  {name: "rust-verifier", role: "compile Rust SDK"}
]})

TaskCreate({subject: "Verify 16MB cap", owner: "safety", activeForm: "Verifying cap"})
Agent({description: "safety work", prompt: "...you are the safety teammate..."})

// teammate sends back:
SendMessage({to: "team-lead", summary: "cap verified", message: "..."})

// lead shuts down:
SendMessage({to: "safety", message: {type: "shutdown_request", reason: "done"}})
TeamDelete({name: "wasm-hardening"})
```

### Tier 3 — Tmux + claude -p

The full working pattern (attempt 4):

```bash
MAW_JS="/home/neo/Code/github.com/Soul-Brews-Studio/maw-js"

tmux new-session -d -s wasm-host -c "$MAW_JS"
tmux send-keys -t wasm-host "claude --dangerously-skip-permissions -p '
  STEP 1: gh issue view 317
  STEP 2: Read src/cli/command-registry.ts
  STEP 3: Implement host functions
  STEP 4: Branch, commit, push
  STEP 5: Every 5 min report:
    maw hey mawjs-oracle \"[wasm-host] PROGRESS: <what>\"
  STEP 6: Final:
    maw hey mawjs-oracle \"[wasm-host] DONE: <branch>\" | \"STUCK: <why>\"
'" Enter
```

Monitor:

```bash
maw peek wasm-host
maw overview wasm-host rust-sdk wasm-safety
```

Shutdown:

```bash
tmux kill-session -t wasm-host
git worktree remove /path/to/wasm-host   # if a worktree was used
```

---

## B.3 Prompt Template For Tier 3 Agents

Every tmux agent's prompt should include:

```
YOU ARE: <agent-name>, an autonomous agent under oracle <parent>.
YOUR TASK: <one sentence>.

STEPS:
  1. <concrete first action>
  2. <concrete second action>
  ...

REPORTING (non-negotiable):
  - Every 5 minutes while working:
      maw hey <parent> "[<agent-name>] PROGRESS: <what you just did>"
  - When complete:
      maw hey <parent> "[<agent-name>] DONE: <branch or artifact>"
  - If blocked:
      maw hey <parent> "[<agent-name>] STUCK: <what you need>"

CONSTRAINTS:
  - Do not edit files outside <allowed paths>.
  - Branch name: feat/<agent-name>.
  - All commits must be small and reviewable.

END STATE:
  - Branch pushed.
  - Final `maw hey` sent.
```

Missing any part of the REPORTING block produced the silent agent in Chapter 14.

---

## B.4 Shutdown Protocols

### Tier 1 (Agent tool)

Automatic. The tool result arrives; the subagent process is already gone. No cleanup needed unless `isolation: worktree` was used, in which case the agent's final message includes the worktree path for the lead to prune.

### Tier 2 (TeamCreate)

Graceful, four steps:

```ts
// 1. Lead asks teammate to stop
SendMessage({to: "safety", message: {type: "shutdown_request", reason: "work complete"}})

// 2. Teammate approves
SendMessage({to: "team-lead", message: {type: "shutdown_response", request_id: "...", approve: true}})

// 3. Teammate process ends

// 4. Lead tears down
TeamDelete({name: "wasm-hardening"})
```

Skip step 1-2 at your peril: a teammate killed mid-task may leave the repo in an odd state.

### Tier 3 (tmux)

Manual. Three considerations:

1. **Has the agent reported DONE?** If not, `maw peek` first to see if it's actually finished or mid-work.
2. **Is there a branch to merge?** `git branch -a | grep <agent-name>`.
3. **Is there a worktree?** `git worktree list`. Remove with `git worktree remove`.

Then:

```bash
tmux kill-session -t <agent-name>
git worktree remove <path>
git branch -d <merged-branch>      # or -D to force
```

---

## B.5 When NOT To Spawn Agents

- **The task is a one-liner.** Don't spawn an agent to rename a variable. Just rename it.
- **You don't know the plan.** Agents need a clear scope. If you don't have one, write it first.
- **The work is read-only and fits in one agent's context.** Don't parallelize for parallelization's sake.
- **You have less than 5 minutes.** Tier 2 setup alone costs ~30 seconds. Tier 3 costs minutes.
- **The agents would need to see each other's changes.** Agents are bad at merging. Serialize instead.

---

## B.6 Quick Reference Card

| Tier | Tool | Spawn time | Survives? | Cross-machine? | Tokens | Best for |
|------|------|-----------|-----------|----------------|--------|----------|
| 1 | `Agent` | instant | No | No | 3-7× | Research, debate |
| 2 | `TeamCreate` + `Agent` | ~30s | No | No | 3-7× | Coordinated squad |
| 3 | tmux + `claude -p` | ~60s | **Yes** | **Yes** | separate | Long-running, federated |
| 4 | `maw wake --team` | (future) | **Yes** | **Yes** | separate | All of the above |

Print this page. Tape it to the monitor.
