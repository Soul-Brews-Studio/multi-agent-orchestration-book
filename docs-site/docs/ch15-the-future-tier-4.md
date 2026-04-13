---
sidebar_position: 16
title: "Chapter 15: The Future — Tier 4"
---

# Chapter 15: The Future — Tier 4

> "The dream: `maw wake --issue 317 --team` — combines `maw wake` (real tmux session) with TeamCreate (coordination). Agent wakes in its own tmux, works the issue, reports via both maw hey AND SendMessage. Best of all worlds."
> — three-tiers learning, 2026-04-13

---

## 15.1 Where The Three Tiers Fail

The book has argued that most multi-agent tasks fit into one of three tiers: the `Agent` tool for quick in-process work, `TeamCreate` for coordinated squads, and raw tmux for independent long-running processes. This is true. It is also incomplete.

Each tier has a specific failure mode *at its boundary*:

- **Tier 1 (Agent tool)** is invisible. Nat cannot peek. Dies with the session.
- **Tier 2 (TeamCreate)** is still in-process. Dies with the session. Cannot span machines.
- **Tier 3 (raw tmux)** is visible and independent but has no structured coordination. The silent agent from Chapter 14 is the canonical case.

The tiers compose badly because they were built in isolation. The `Agent` tool was designed for convenience. `TeamCreate` was designed for coordination. Raw tmux was adapted from infrastructure that predates agents altogether.

The future is not a fourth tier that replaces these. The future is a combination that *uses their strengths together*.

## 15.2 Tier 4: Coordinated Independence

The proposed command, referenced in the session's learning file:

```bash
maw wake --issue 317 --team
```

Three things happen simultaneously:

1. **`maw wake`** spawns a real tmux session — independent process, `maw peek`-able, survives parent session death.
2. **`--team`** registers the agent in a `TeamCreate` structure — named, addressable via SendMessage, tracked in TaskList.
3. **`--issue`** seeds the agent's context with the GitHub issue and wires up a branch with a matching name.

The agent now has two channels out:

- `maw hey mawjs-oracle "[wasm-host] PROGRESS: ..."` — the plain-text, federation-native, cross-machine channel.
- `SendMessage({to: "team-lead", ...})` — the structured, auto-delivered, task-tracking channel.

It is independent (Tier 3 strength) *and* coordinated (Tier 2 strength) *and*, for parallel research, fast (Tier 1 strength, if you read the `Agent` tool's sub-spawns as a fourth nested layer inside the tmux Claude).

This is Tier 4. It is not implemented yet. Every chapter of this book has been leading to it.

## 15.3 What Has To Be Built

The gap between today and Tier 4 is a list of specific, mostly small, pieces of infrastructure.

### 1. `maw wake --issue` cross-repo

Documented in Chapter 14 as a failure mode. `maw wake` must cleanly separate *oracle identity* from *target repo*. `--oracle`, `--repo`, `--issue`, and `--task` should be orthogonal flags.

### 2. `maw wake --team`

A new flag. When set, the waking agent:

- registers itself as a teammate of the parent team (via an API call to the parent oracle's team endpoint),
- receives a teammate name and role,
- is expected to use `SendMessage` *in addition to* `maw hey`.

### 3. Cross-machine `TeamCreate`

Today, `TeamCreate` is local to the spawning process. A cross-machine version needs:

- a persistent team registry (filesystem or Oracle API),
- message routing via `maw hey` (federation-native),
- task state stored somewhere both the local and remote agents can read/write.

The `maw inbox` already provides persistent, federation-native storage. `TeamCreate` with an `--inbox` backend would store team state there.

### 4. Agent auto-report convention

Every agent spawned via Tier 3 or Tier 4 should inherit a prompt fragment that mandates:

- heartbeat every N minutes,
- explicit `STUCK:` message on blockers,
- structured `DONE:` or `ABORT:` at end.

This prevents the silent-agent failure mode (Chapter 14).

### 5. `maw agents` status command

The war-room view, productized. One command that shows every running agent across the fleet, its state, its last heartbeat, its current branch. Today we approximate this with `maw overview` over known names. The real command would discover agents automatically.

## 15.4 WASM As Universal Agent Format

Parallel to the Tier 4 work is a second transformation: WASM as the plugin (and eventually, agent) runtime.

The WASM architecture spiked in this session (epic #316) is grounded in graph-node's model: host functions, memory protocol, gas metering, per-invocation isolation. A plugin written in Rust compiles to 81.6KB of WASM. It runs with a 16MB memory cap and a 5-second timeout. It cannot read the filesystem, make network calls, or execute arbitrary code — only the host functions the maw runtime exposes (`maw_print`, `maw_identity`, `maw_send`, `maw_fetch`).

The vision extends from plugins to agents:

- A plugin is a small, safe, typed, WASM module.
- An agent is a plugin that happens to loop and call an LLM.
- A maw-js node is a runtime that hosts agents as plugins.

When this ships, `maw wake` is no longer "spawn a Claude Code session in tmux." It is "load a WASM agent module into the runtime, give it a ticket, and schedule it." The agent's language is unconstrained — Rust, Go, AssemblyScript, anything that targets WASM. Its I/O is fully mediated by host functions, which means it is fully observable. Its cost is bounded by gas. Its death is graceful.

WASM-as-agent-format unifies all three tiers in one mechanism. A Tier 1 "quick research agent" and a Tier 3 "overnight builder" become different configurations of the same module format, run against the same host function surface, monitored by the same tools.

This is the horizon. It is not this year. But every piece of it — host functions, gas metering, versioned API, Rust SDK — already exists in skeleton form in the repository as of v2.0.0-alpha.2.

## 15.5 The Federation Dream

Beyond Tier 4 and WASM is the third transformation: federation.

Today, `mawjs-oracle` talks to three peer nodes: `white`, `clinic-nat`, `mba`. Four nodes total, linked by the `maw hey` message bus and the shared mawjs runtime. Across those four nodes, the Oracle family registry indexes 186 oracles. Many are dormant. Some are experimental. A handful are production.

The dream that closes this book is this:

> You say `maw wake --issue 317 --team --where=white`.
>
> On `white`, a tmux session opens. A Claude agent wakes inside it, pulls the issue from GitHub, branches off `main`, and begins work. It reports progress via `maw hey` to your node. It appears in your `TaskList` as a teammate. When it is done, it pushes its branch, sends `SendMessage({type: "done"})`, and shuts down cleanly. Its worktree is pruned. Its tmux session is closed.
>
> You never opened a terminal on `white`. You never `ssh`-d in. You sent a message and received work.

This is not science fiction. Every primitive exists:

- `maw hey` is the message bus, already working across the four nodes.
- `tmux` is everywhere.
- `claude` is installable on any node.
- `TeamCreate` is a local protocol that can be lifted to a federation protocol.
- `maw wake` is a sketch that needs its flags cleaned up.

The work to reach the dream is mostly plumbing. The concepts are settled.

## 15.6 What This Book Has Been

This book has been an honest accounting of one 100-hour session. Three tiers of agent spawning, tested under load. Five Nat-corrections that bent the system toward reality. Five documented failure modes with their root causes. Seventeen plugins, one framework migration, one WASM architecture epic.

The thesis, stated in the README, was:

> Convenience is for the AI. Visibility is for the human. The best system serves both.

Tier 4, when it ships, is what "serves both" looks like. An agent the AI can spawn with a single command. An agent the human can peek, kill, and message. A system that is fast and inspectable, powerful and understandable, autonomous and accountable.

We are not there yet. We are closer than we were at hour zero of session 4833f831. We are far enough along that the path is visible.

## 15.7 The Last Correction

The final entry in the AI diary reads:

> "The pattern I keep hitting: I move fast and fix forward instead of reading first. The graph-node deep learn showed me what 'reading first' looks like at scale — 52 host functions, all documented, all typed, all tested. That's the standard."

The future of this work is not faster agents. It is agents that read more before they write. The tools for that — `/learn --deep`, the 123K Elysia corpus, the 126K graph-node corpus, the Oracle memory system — already exist. The remaining work is on the AI's habits, which is to say: on the humans who write the prompts and the AIs who follow them.

Tier 4 is a technical goal. The honesty principle is a human one. Both are the book.

---

## Takeaways

- The three tiers compose badly at their seams. Tier 4 is the composition that fixes this.
- `maw wake --issue --team` is the headline command of the future.
- Cross-machine `TeamCreate` needs a persistent registry and federation-native messaging — both primitives already exist.
- WASM-as-agent-format is the unifying runtime that makes agents safe, observable, portable, and gas-bounded.
- The federation dream — remote `maw wake` across four nodes — is plumbing work on an already-settled design.
- The last correction is not technical. It is: **read first**.

## End Of Part IV

Appendices A through D follow: a command reference, a spawn-pattern cheatsheet, a cost analysis, and the plugin catalog.
