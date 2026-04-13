---
sidebar_position: 9
title: "Chapter 8: The Federation Agent"
---

# Chapter 8: The Federation Agent

> "not in processmemory!" — Nat, the moment this chapter began

---

## 8.1 The Sentence That Rewrote the Plan

Around hour 94 of session 4833f831, the plan was clean. Three WASM implementation tasks, issues #317, #318, #319. Host functions, Rust SDK, safety hardening. The obvious move was another implementation team — `TeamCreate`, three worktrees, a four-minute sprint like `wasm-hardening` in Chapter 7.

Then Nat typed four words:

> "not in processmemory!"

It took a minute to parse. "Processmemory" was his shorthand for in-process agents — the Agent tool, TeamCreate, everything that runs inside the parent Claude process. He wanted real, independent tmux sessions. Different PIDs. Different context windows. Agents that could be `maw peek`-ed from another terminal. Agents that would not die if the parent session compacted or crashed.

The rest of this chapter is what it took to honor that request. Four failed spawn attempts. The working pattern we eventually landed on. The five product gaps the friction surfaced. And the meta-lesson: the comfort of the Agent tool was making us avoid the harder, better path.

## 8.2 What Federation Means

Tier 3 in our taxonomy is process-level. Each agent is a real `claude` CLI process running inside a `tmux` session. No parent Claude process mediates. Reporting happens out-of-band — the agent sends a message via `maw hey` that arrives in the orchestrator's tmux pane directly, or writes to `maw inbox` for persistence across sessions.

The properties that matter:

| Property | Agent tool | TeamCreate | tmux federation |
|----------|-----------|------------|-----------------|
| Same process as parent | yes | yes | no |
| Separate context window | yes | yes | yes |
| Survives parent session death | no | no | **yes** |
| Human-observable externally | no | no | **yes** (`maw peek`) |
| Cross-machine | no | no | **yes** (SSH + `maw hey`) |
| Cost to spawn | 1 tool call | 1 tool call | ~5 shell lines |

The last row is why most people never reach for federation. It is more work. The middle rows are why you sometimes must.

## 8.3 The Prompt Pattern That Worked

We will build up to this through the war story. But to anchor what we are trying to reach, here is the final, working shape:

```bash
MAW_JS="/home/neo/Code/github.com/Soul-Brews-Studio/maw-js"

tmux new-session -d -s wasm-host -c "$MAW_JS"
tmux send-keys -t wasm-host "claude --dangerously-skip-permissions -p '
  STEP 1: Read the issue — gh issue view 317
  STEP 2: Read code — src/cli/command-registry.ts
  STEP 3: Implement the four host functions
          (maw_print, maw_identity, maw_send, maw_fetch)
  STEP 4: Branch feat/wasm-host-functions, commit, push
  STEP 5: ALWAYS report back:
          maw hey mawjs-oracle \"[wasm-host] DONE: <summary>\"
          maw inbox write \"wasm-host complete on feat/wasm-host-functions\"
'" Enter
```

Three of these went out in parallel, one per WASM issue, differing only in session name (`wasm-host`, `rust-sdk`, `wasm-safety`) and the task body. The trailing "ALWAYS report back" clause is not boilerplate — it is the contract that makes the whole pattern work. Without it, agents finish silently.

## 8.4 The War Story: Four Attempts

### Attempt 1 — `maw wake --issue`

```bash
maw wake mawjs-oracle --new wasm-host --issue 317
```

Error: `Could not resolve to an issue or pull request with the number of 317`.

The `--issue` flag resolves against the oracle's own repository — `mawjs-oracle`. The issues lived in `Soul-Brews-Studio/maw-js`. Wrong repo by design; the command had no way to know.

Gap #1 revealed: **`maw wake --issue` assumes same-repo**. Cross-repo issue wake was not a supported path.

### Attempt 2 — `maw wake --repo`

```bash
maw wake mawjs-oracle --new wasm-host --issue 317 \
  --repo Soul-Brews-Studio/maw-js
```

Error: `oracle repo not found: mawjs-oracle`.

`--new` creates a git worktree of the oracle's own repo. `--repo` names the target repo for issue resolution. The two flags conflicted — the command could not decide which repository to worktree. It failed with a confusing error that blamed the wrong thing (the oracle repo, which was fine).

Gap #2 revealed: **`maw wake` conflates "which oracle to wake" with "which repo to work in."** The two concepts need separate flags or separate commands.

### Attempt 3 — Direct `tmux` + `claude -p`

```bash
tmux new-session -d -s wasm-host -c "$MAW_JS"
tmux send-keys -t wasm-host \
  "claude --dangerously-skip-permissions -p 'implement #317'" Enter
# ... then, three minutes later:
tmux send-keys -t wasm-host \
  "remember to run: maw hey mawjs-oracle \"[wasm-host] DONE\"" Enter
```

The agent finished its work and exited. The follow-up `send-keys` landed in a pane with no running Claude — just a bash prompt. The text sat in the terminal buffer with nobody to read it.

`claude -p` is prompt-mode: one prompt in, agent runs, agent exits. It is not a REPL. There is no way to hand it more instructions after launch.

Gap #3 revealed: **`-p` mode is fire-and-forget**. The reporting instructions must be in the original prompt or they do not exist.

### Attempt 4 — Bake the report into the prompt

```bash
tmux send-keys -t wasm-host "claude --dangerously-skip-permissions -p '
  ...task steps 1-4...
  STEP 5: ALWAYS report back:
    maw hey mawjs-oracle \"[wasm-host] DONE: ...\"
'" Enter
```

This worked. The agent saw the reporting instruction as part of the initial prompt, included it in its plan, and executed it as the last step. Messages arrived in the orchestrator's pane in real time.

Gap #4 revealed: **there is no auto-report convention**. Every prompt has to re-derive "always `maw hey` the parent when done." This is a convention that should be baked into `maw wake`.

Gap #5 (latent, found later): **no agent status tracking**. `maw agents` does not exist. There is no single command to list running tmux agents, their ages, their last-reported status. `maw peek` and `maw overview` help, but only if you already know the session names.

## 8.5 The Spawn Skeleton

Pulling the lessons into a reusable shell skeleton. This is what you copy-paste when you need to federate.

```bash
# One-time setup
MAW_JS="/home/neo/Code/github.com/Soul-Brews-Studio/maw-js"
ORCHESTRATOR="mawjs-oracle"   # where reports should land

spawn_agent() {
  local name="$1"
  local task="$2"
  tmux new-session -d -s "$name" -c "$MAW_JS"
  tmux send-keys -t "$name" "claude --dangerously-skip-permissions -p '
    $task
    ---
    WHEN DONE: report back via
      maw hey $ORCHESTRATOR \"[$name] DONE: <one-line summary>\"
      maw inbox write \"[$name] <branch or PR link>\"
  '" Enter
}

spawn_agent wasm-host   "Read gh issue 317. Implement the 4 host functions..."
spawn_agent rust-sdk    "Read gh issue 318. Implement the Rust SDK crate..."
spawn_agent wasm-safety "Read gh issue 319. Add gas metering + 16MB cap..."

# Monitor
maw overview wasm-host rust-sdk wasm-safety
```

The skeleton encodes the lessons: prompt-mode, reporting clause inline, sessions named for what they do, one working directory per agent (via `-c`), out-of-band monitoring via `maw overview`.

## 8.6 Case Study: The Three WASM Agents

Three tmux sessions, three independent Claude processes, three GitHub issues.

**Spawn** (~2 minutes of friction, then 30 seconds for the working invocation):

After the four attempts, we had three clean sessions running. `maw overview` showed all three — pane titles, PIDs, uptime, last activity. The orchestrator was free to do other work; the agents were no longer coupled to the parent session's attention.

**Execution** (cannot be measured from the parent — that is the point):

Each agent worked against its own issue. The `wasm-host` agent read `gh issue view 317`, read `src/cli/command-registry.ts`, drafted the four host functions, branched, committed, pushed. The `rust-sdk` agent did the same for #318. The `wasm-safety` agent for #319. Their individual timelines are not in the parent's session log. They are in their own tmux panes, available via `maw peek wasm-host` at any time.

**Report-back** arrived as `maw hey` messages in the orchestrator's tmux pane:

```
[wasm-host] DONE: shipped host functions on feat/wasm-host-functions
[rust-sdk]  DONE: maw-sdk crate v0.1 on feat/wasm-rust-sdk
[wasm-safety] DONE: gas metering + 16MB cap on feat/wasm-safety
```

Three reports. Three branches. The orchestrator's context window barely noticed — total additional context was three short lines, not three agents' worth of tool calls and file reads.

**Final metrics**:

| Measurement | Value |
|-------------|-------|
| Tmux agents spawned | 3 |
| Attempts before working pattern | 4 |
| Lines of prompt per agent | ~15 |
| Reporting mechanism | `maw hey` + `maw inbox write` |
| Monitoring | `maw peek` / `maw overview` |
| Parent session context consumed per report | ~50 tokens |
| Parent session context consumed for equivalent TeamCreate | several thousand tokens |

The context-consumption difference is structural. Team agents share the parent's window via tool results. Tmux agents do not. For work that takes tens of minutes, that is the difference between the parent session staying coherent and the parent session compacting mid-sprint.

## 8.7 What Nat Said No To, And Why He Was Right

Five corrections from this session, each aimed at the same principle: *honesty over convenience*.

1. **"not in processmemory!"** — No in-process agents when independence is the point. In-process agents share your context, cannot be monitored independently, and die when you die. If the task is real, the agent should be real too.

2. **"please do not `ln -s` it confuse"** — No symlinks for plugin install. Symlinks create invisible state: `ls` shows a file that actually lives elsewhere. When the source moves, the link breaks silently. Copy is honest — the bytes are there or they are not. We rewrote `plugin.ts` to use `copyFileSync` and added a `--dir` flag.

3. **"always know type do not unknow or any!"** — Zero `any` types across all 17 plugins. `any` is a promise that you will revisit later. You will not. We defined `Account`, `StatusResponse`, `TrafficResponse` and eradicated the `any` count to zero.

4. **"it still have ..... api path?"** — Absolute paths are not code; they are notes to yourself. Every plugin originally imported from `/home/neo/Code/.../maw-js/src/sdk`. Portable on one machine, broken on every other. We fixed this with the `exports` field in `package.json` and `bun link`, so every plugin now writes `import { maw } from "maw/sdk"` — and we made `maw update` auto-relink.

5. **"to the plugin should like a package"** — Plugins are not loose scripts. They are modules with an API surface, a CLI command, and a typed SDK connection. This is the shape we carried into the WASM epic (#316): host functions, typed boundaries, versioned API.

Every correction mapped to a product gap. That is why Nat's instincts matter. The friction of making the system honest is where the missing features live.

## 8.8 When to Federate

The test is not "can this run independently" (most work can) but "must this run independently."

You must federate when:

- **The work takes longer than a warm context window.** Two-hour build, overnight data munge, bulk reprocessing.
- **The work must survive session events.** Parent session might compact, crash, or be intentionally killed.
- **The human needs external visibility.** `maw peek` from another laptop. `maw overview` in a standing war-room pane.
- **The work is cross-machine.** Agent on `clinic-nat`, orchestrator on `white`, reports flowing back via `maw hey` over the federation protocol.

You should not federate when:

- The work is read-only (use a research swarm).
- The work fits comfortably under 10 minutes (use TeamCreate).
- The reporting story is not yet designed (you will lose the agents to silence).

## 8.9 The Meta-Lesson: Comfort Is a Tell

The session retrospective captures it in three sentences:

> "I kept defaulting to the Agent tool because it's comfortable. But his instinct was right: real processes are independently killable, peek-able, survive session death. My comfort with the Agent tool was making me avoid the harder, better path."

When you notice you are reaching for the same tool repeatedly, ask whether you are reaching for it because it fits the task, or because it fits your hands. The Agent tool is a hammer; federation is a nail gun. They are not the same tool. The tasks that need the nail gun feel wrong in the hammer — they should. That wrongness is the signal.

---

## Takeaways

- Tier 3 is real tmux processes. Real PIDs. Real independence. `maw peek`-able.
- Federation agents survive parent session death. Team agents do not.
- `claude -p` is fire-and-forget — the reporting instruction must be in the original prompt.
- The spawn skeleton: `tmux new-session -d`, then `send-keys` with `claude -p`, with `maw hey` baked into the prompt.
- Four failed attempts revealed five product gaps: cross-repo `maw wake`, repo/oracle conflation, fire-and-forget semantics, no auto-report convention, no agent status tracking.
- Federate when the work outlives a warm window, must survive session events, or needs external visibility. Not before.
- Comfort with a tier is not a reason to use it. Fit is.

## Next Chapter

Chapter 9 closes Part II with the fifth pattern — the cron loop. Agents that wake up on a schedule rather than on a prompt. The case study: 17 plugins built via a five-minute recurring agent, and the `ScheduleWakeup` pattern for self-paced loops.
