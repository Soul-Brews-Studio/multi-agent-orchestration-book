---
sidebar_position: 3
title: "Chapter 2: The Three Tiers"
---

# Chapter 2: The Three Tiers

> "Convenience is for the AI. Visibility is for the human. The best system serves both."

---

## 2.1 The Three Shapes of an Agent

When you spawn a second agent, you make three decisions whether you realize it or not: who can see it, how long it lives, and how it talks back to you. The answers cluster into three distinct shapes. Each shape has a name in this book.

- **Tier 1 — Arrows.** Fast, in-process, fire-and-collect. The Agent tool. Spawned inside your conversation, returns its result inline, then disappears.
- **Tier 2 — Squads.** Coordinated, named, task-tracked. TeamCreate plus SendMessage plus TaskList. Agents that know each other's names and report back through a structured channel.
- **Tier 3 — Federation.** Real OS processes, real tmux sessions, real `claude -p` invocations. The agents your colleague can attach to, kill, or wake on a different machine.

Most multi-agent literature elides these distinctions, treating "spawning an agent" as a single primitive. In practice they differ by orders of magnitude in setup cost, operational complexity, and what the human sitting next to you can actually *see*. The wrong tier is not a bug — it is a category error. It will work, but it will work badly, and the failure mode will not be the kind that surfaces in unit tests.

This chapter introduces all three with working examples from session 4833f831, then gives you the decision tree we now use without thinking.

---

## 2.2 Tier 1 — The Agent Tool (Arrows)

The Agent tool is built into Claude Code. It spawns a subagent in your current process, gives it a prompt, and returns the agent's final message as a tool result. The subagent runs to completion and dies. There is no heartbeat, no protocol, no shutdown handshake. Spawn, collect, discard.

```typescript
Agent({
  description: "Elysia migration scout",
  subagent_type: "Explore",
  prompt: "Find every Hono route in src/api/. Return the file path and the route signature for each, grouped by file. Under 300 words.",
});
```

That is the entire ceremony. The result lands in your context as plain text, the same way a Read tool result does. This session ran the Agent tool roughly twenty times — research swarms, debate panels, worktree migration crews, retro extractors. Total spawn time in every case: instant. Total time to first useful answer: 15-60 seconds for Haiku, 60-300 seconds for Opus. Token cost: roughly 3-7× what doing it yourself would have cost, because the subagent re-reads the same files you would have read and produces a summary that you also pay to read.

**Strengths.** Zero friction. Five Haiku agents in parallel can chew through 123,000 lines of documentation in under two minutes — that is exactly what the `/learn --deep elysia` run did at hour 18. Three Opus agents arguing opposing sides of an architecture decision will surface trade-offs that none of them would have surfaced alone. The Agent tool is the right answer to "I need three independent reads of this codebase, right now, and the answers in my context."

**Limits.** The agents are invisible to anyone not staring at your terminal. They die when your session compacts hard or ends. They share your token budget — five Opus agents at 100K tokens each is a 500K hit on your context window if you are not careful. They cannot coordinate with each other. They cannot run on another machine. They cannot survive overnight.

If the task is "research, debate, or one-shot transformation, under five minutes," reach for Tier 1 first. It is almost always the right answer when it is the right answer.

---

## 2.3 Tier 2 — TeamCreate (Squads)

A team is a named group of agents that share a task list and a message bus. You create the team, define the tasks, spawn the agents with role names, and they report back via SendMessage into your conversation. The tasks are tracked in TaskList. The agents shut down with a protocol — a `shutdown_request` from the lead, a `shutdown_response` from each agent, then `TeamDelete`.

The wasm-hardening team from this session is the canonical example. Three Sonnet agents — `safety`, `tester`, `rust-verifier` — three tasks, one lead. The whole sequence took about four minutes from spawn to clean shutdown.

```typescript
TeamCreate({ name: "wasm-hardening", lead: "team-lead" });

TaskCreate({ subject: "Audit memory bounds in wasm bridge",   owner: "safety" });
TaskCreate({ subject: "Write 10 host-function tests",         owner: "tester" });
TaskCreate({ subject: "Verify Rust SDK against host contract", owner: "rust-verifier" });

Agent({ name: "safety",        team_name: "wasm-hardening", prompt: "..." });
Agent({ name: "tester",        team_name: "wasm-hardening", prompt: "..." });
Agent({ name: "rust-verifier", team_name: "wasm-hardening", prompt: "..." });
```

Each agent shows up in tmux as its own pane, addressable by name. `safety` finishes its audit, calls `TaskUpdate({ taskId: "1", status: "completed" })`, then `SendMessage({ to: "team-lead", message: "Audit complete: 3 unbounded reads in wasm/bridge.ts:142, 187, 203. See gist." })`. The lead sees the message land in its conversation automatically. No polling. No inbox check. The structured contract makes the work legible.

**Strengths.** Named addressing: "tell `tester` to skip the slow tests" is a one-line SendMessage. Real-time task visibility through TaskList. Auto-delivered reports — you do not check an inbox, the message arrives in your conversation. The shutdown protocol is graceful: the lead asks, the agents acknowledge, the team is deleted. Tmux panes mean a human can `maw peek` and see what each agent is doing.

**Limits.** Still in-process. The team dies when your session dies. Setup is heavier than Tier 1 — you write a TeamCreate, three TaskCreate calls, three Agent spawns, and a shutdown sequence. That is the right amount of ceremony for a coordinated implementation; it is too much for "summarize this file."

The token cost is the same 3-7× per agent as Tier 1, because the agents are still real subagent runs. Tier 2 buys you coordination, not efficiency.

---

## 2.4 Tier 3 — Raw tmux + `claude -p` (Federation)

Tier 3 is what happens when you stop pretending the agent lives inside your process. You open a new tmux session, launch `claude -p "your prompt"` inside it, and let it run as an independent OS process. The agent reports back by calling `maw hey <your-name> "done"` from inside its own session — a message that travels through the federation message bus into your tmux pane.

The WASM implementation team — issues #317, #318, #319 — was three of these, spawned at hour 72 of the session.

```bash
tmux new-session -d -s wasm-host \
  "cd /home/neo/Code/.../maw-js && claude -p \
   'Implement WASM host function bridge for #317. \
    When done, run: maw hey mawjs-dev \"#317 complete: <summary>\"'"
```

That `maw hey` line is the reporting contract. Without it, the agent finishes silently and you have no idea. With it, your tmux pane gets a notification when the work is done. The CLI route is in `src/cli/route-comm.ts:14-19`:

```typescript
if (cmd === "hey" || cmd === "send" || cmd === "tell") {
  const force = args.includes("--force");
  const msgArgs = args.slice(2).filter(a => a !== "--force");
  if (!args[1] || !msgArgs.length) {
    console.error("usage: maw hey <agent> <message> [--force]");
    process.exit(1);
  }
  await cmdSend(args[1], msgArgs.join(" "), force);
  return true;
}
```

Three tiers, three message buses. The Agent tool returns through tool-result text. TeamCreate routes through SendMessage. Tier 3 routes through `maw hey`, which works across tmux sessions on the same machine and across machines via SSH+tmux.

**Strengths.** True independence. The process survives your session ending. It survives compaction. It can run on a different machine — `ssh white "tmux new-session -d -s nightly-build 'claude -p ...'"` is a one-line cross-machine spawn. It is a full Claude Code session with every tool, not a subagent. A human can `maw peek wasm-host`, attach to the pane, kill the session, or read the scrollback.

**Limits.** The setup is brittle. We needed four attempts before we landed a working spawn pattern — Chapter 3 documents that war story in detail. There is no built-in task tracking. There is no coordination between the three agents. There is no graceful shutdown protocol — when the work is done you still have a stopped Claude process and a tmux session to clean up by hand. And at least one of the three WASM agents simply did not call `maw hey` when finished. The `wasm-safety` pane sat idle for an hour before we noticed.

If you need an agent that outlives your session, runs overnight, or works on another node, Tier 3 is the only choice. If you do not need any of those things, Tier 3 is overkill and the friction will hurt you.

---

## 2.5 Side-by-Side

| Dimension              | Tier 1: Agent          | Tier 2: TeamCreate            | Tier 3: tmux + `claude -p` |
|------------------------|------------------------|-------------------------------|----------------------------|
| Spawn syntax           | `Agent({...})`         | `TeamCreate` + `Agent` + tasks | `tmux new-session ... claude -p` |
| Setup time             | ~0s                    | ~30s                          | ~60s (after pattern is known) |
| Reporting channel      | Tool result (inline)   | SendMessage (auto-delivered)  | `maw hey` (tmux message)   |
| Task tracking          | None                   | TaskList                      | None                       |
| Coordination           | None                   | Named, task-bound             | None                       |
| Visible to human       | Hidden                 | Tmux panes                    | Tmux sessions              |
| Survives session death | No                     | No                            | **Yes**                    |
| Cross-machine          | No                     | No                            | **Yes**                    |
| Shutdown               | Automatic              | Graceful protocol             | Manual `tmux kill-session` |
| Token cost             | 3-7× per agent         | 3-7× per agent                | Separate session budget    |
| Best for               | Quick research         | Coordinated implementation    | Long-running independence  |

The token-cost row is the one most people misread. Tiers 1 and 2 charge against your context window. Tier 3 spawns an entirely separate Claude session with its own budget — you pay in dollars, not in your remaining 200K tokens. For a long task that would otherwise compact your main session out of usefulness, Tier 3 can be the *cheaper* option from a context-economics perspective even though it is the most expensive in raw tokens.

---

## 2.6 The Decision Tree

We use this tree without thinking now. Read it once, write it on a sticky note, throw the note away after a week.

1. **Will the work outlive my session, or does it need to run on another machine?**
   → Tier 3. No further questions.
2. **Do multiple agents need to coordinate or report progress to a lead?**
   → Tier 2.
3. **Can I describe this as "two-to-five independent reads or transforms, under five minutes"?**
   → Tier 1.
4. **None of the above?**
   → Do it yourself. Most tasks fall here. The third agent you spawn for a five-minute job costs more in coordination than it saves in wall time.

The tree has a meta-rule under it: **prefer the lowest tier that works.** Tier 1 is cheaper to spawn, cheaper to debug, and cheaper to clean up. Reach for Tier 2 when coordination is the actual problem, not because three agents sound impressive. Reach for Tier 3 only when independence — survival, machine boundaries, human visibility — is the actual requirement.

---

## 2.7 The Cost Model

A rough model from this session, useful enough to make trade-offs with:

- **Tier 1**: 3-7× the tokens you would have spent doing the task yourself, paid out of your context window. Wall time: parallel ÷ slowest agent.
- **Tier 2**: Same 3-7× per agent, plus ~5K tokens of TeamCreate / TaskCreate / shutdown ceremony. Buys you coordination and visibility.
- **Tier 3**: Roughly N× a fresh session's cost (separate budget). Buys you independence and survival.

A 10-minute task done by three Tier-1 agents costs roughly the tokens of 30 minutes of solo work, finishes in ~4 minutes wall time, and compacts your main context. The same task in Tier 3 costs the same dollars but in a separate process — your main context survives untouched.

Pick the tier whose cost shape matches the budget you actually care about: tokens, wall time, context, or human visibility.

---

## Takeaways

- Three tiers exist: Agent (arrows), TeamCreate (squads), tmux + `claude -p` (federation).
- They differ in setup cost, coordination, lifetime, and what the human can see.
- Tier 1 is right for "research, debate, transform, under five minutes."
- Tier 2 is right when coordination *is* the problem.
- Tier 3 is the only option for survival, overnight runs, or cross-machine work.
- Cost is paid in different currencies: context tokens (Tiers 1-2) vs. session dollars (Tier 3).
- The decision tree is short. Use the lowest tier that fits.

## Next Chapter

Chapter 3 unpacks the message bus that makes the squads and the federation work. Three transports — `SendMessage`, `maw hey`, the inbox — and the reporting contract that determines whether your agents come back to you with answers or vanish into silent panes.
