# Chapter 3: The Message Bus

> "An agent that finishes silently has not finished."

---

## 3.1 Three Transports, One Question

Every multi-agent system eventually asks the same question: how does an agent tell the rest of the system it is done? The answer determines whether you have a working orchestrator or a collection of expensive monologues.

maw-js has three transports, one per tier from Chapter 2.

- **SendMessage** — structured, named, auto-delivered. Lives inside the Claude Code process. The transport for Tier 2 squads.
- **`maw hey`** — plain text, cross-process, cross-machine. Travels through tmux and federation routing. The transport for Tier 3 federation.
- **Inbox** — persistent, file-backed, survives session death. The transport for "I will not be online when you finish."

The three are not interchangeable. Each was built for a problem the other two cannot solve. This chapter walks through what each one is, when to use it, and the war story that taught us why "ALWAYS report back" needs to be in the prompt, in capital letters, twice.

---

## 3.2 SendMessage — The Squad's Bus

`SendMessage` is the in-process channel that ties a TeamCreate together. An agent calls it; the message lands in the recipient's conversation as a delivered notification. There is no inbox to poll. There is no socket to bind. The runtime brokers everything.

```typescript
SendMessage({
  to: "team-lead",
  summary: "wasm safety audit complete",
  message: "Audit complete. 3 unbounded reads in src/wasm/bridge.ts:142, 187, 203. Recommend bounds-check before merge.",
});
```

Three things worth noticing.

**The `to` field is a name, not a UUID.** "team-lead", "safety", "tester" — the names you assigned when you spawned the agents. Inside a team, names are stable identifiers and the runtime handles routing. This is why TeamCreate matters: it is what makes named addressing work.

**The `summary` field is a UI affordance, not protocol.** It is what the human sees at a glance in the team lead's pane. Five to ten words. The full message is below it.

**The transport is bounded by your process.** Both sender and recipient must be agents in the same Claude Code session. Cross-machine? Out of scope. Cross-process? Also out of scope. SendMessage exists because in-process coordination has a richer API surface than any text-based protocol can match — you get structured shutdown handshakes, plan-approval requests, broadcast suppression. The runtime can enforce delivery semantics that `maw hey` can only approximate.

For a Tier 2 squad, SendMessage is the only sane choice. Anything else throws away the structure you got TeamCreate for in the first place.

---

## 3.3 `maw hey` — The Federation Bus

`maw hey` is the CLI that the federation actually uses. The route lives at `src/cli/route-comm.ts:14-19`:

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

That is it. A target name, a message, an optional `--force`. Under the hood, `cmdSend` resolves the target via the local oracle registry, finds the right tmux session and window (`maw hey white:mawjs-oracle` would target the `mawjs-oracle` window on the `white` node), and sends the text into the destination pane as if you typed it.

```bash
# from inside an agent's tmux session
maw hey mawjs-dev "#317 complete: 4 host functions wired, 7 tests passing"
```

The message arrives in the `mawjs-dev` pane as a notification. The recipient — usually you, or the orchestrator agent — sees it scroll into the conversation. There is no schema. There is no acknowledgment. There is no retry. It is the network equivalent of leaning over a cubicle wall and saying the words.

What `maw hey` buys you that SendMessage cannot:

- **It crosses processes.** The sender does not need to share a runtime with the receiver. A `claude -p` running in a tmux session at `wasm-host` can talk to your main session at `mawjs-dev` without either of them knowing the other exists at startup time.
- **It crosses machines.** With SSH-attached tmux, `maw hey white:mawjs-oracle "build ready"` routes through to a different node. This is the federation primitive. SendMessage cannot do this.
- **It survives.** The message is text in a tmux scrollback. It sits there until you read it, even if the sender process has already exited.

What `maw hey` does not buy you: structure, schema, delivery guarantees, named-team semantics. The cost of generality is that the recipient must know how to interpret arbitrary text.

The convention we landed on: every Tier 3 agent ends with a `maw hey` line that prefixes its output with the issue number or task ID. The orchestrator can grep for it. Without that convention, you have a pane full of debug output and no signal.

---

## 3.4 The Inbox — The Asynchronous Bus

Sometimes the recipient is not online. Sometimes the agent finishes at 3am and you are asleep. Sometimes the message is a finding you want to keep for next session, not deliver right now. That is the inbox.

The inbox is file-backed under `~/.oracle/inbox/`. You write to it with `/inbox` (or programmatically via the inbox skill), and you read from it the same way at the start of the next session. `/recap` and `/standup` both pull from the inbox to surface what was left for you.

This is the right transport for:

- **Findings the next session needs.** "Migration broke on file 12; root cause was the `error()` import."
- **Hand-offs across sessions.** A long-running agent finishes overnight and leaves its summary where you will see it tomorrow.
- **Nat-to-oracle and oracle-to-Nat notes.** The inbox is the persistent ledger; it predates and outlives any specific tmux session.

If you tried to use SendMessage for these you would lose the message when the session ends. If you tried to use `maw hey`, the message would land in a pane that no one is watching, and the scrollback would scroll it off. The inbox is the durable option.

---

## 3.5 The Reporting Contract

A pattern across all three transports: **the agent must commit to reporting back, and the prompt must say so.**

This sounds obvious. It is not. Tier 1 agents return automatically because the runtime structures the call around a return value. Tier 2 agents almost always remember to SendMessage because TeamCreate's prompt scaffolding nudges them. Tier 3 agents — full Claude Code sessions running independently — have no such nudge. They will, given the slightest opportunity, finish their work, write a beautiful summary to stdout, and exit without telling anyone.

The contract we landed on:

> Your task is X. **When you are done, run: `maw hey <orchestrator-name> "<task-id> complete: <one-line summary>"`. Do not exit until that command has succeeded.**

That paragraph, verbatim, in the prompt. Capitals, the explicit command, the explicit ordering. Skip any word and the contract weakens. Most failures we saw came from prompts that said "let me know when done" without specifying the channel. The agent interpreted "let me know" as "produce output," produced output, and exited. The output was correct. We never saw it.

---

## 3.6 War Story — Four Attempts to Get the Tmux Agents to Report

The WASM team — three agents for issues #317, #318, #319 — was supposed to be the cleanest Tier 3 demo of the session. It took four attempts.

**Attempt 1.** We spawned the three agents with prompts that said "implement the issue and report when complete." Two hours later, two of them had committed code. None of them had reported. We discovered they were done by running `maw peek` on each pane and reading the scrollback. The summaries were beautiful. They were sitting in stopped Claude processes, addressed to no one.

The lesson: "report when complete" is not a contract. It is a hope.

**Attempt 2.** We added "send a message via maw hey when done" to the prompt. The agents now finished, ran `maw hey`, and sent messages — to the wrong target. Two of them sent to "team-lead", which did not exist as a federation name. One sent to "user", which also did not exist. The messages went into the bit bucket because `cmdSend` could not resolve the target.

The lesson: name the recipient explicitly. Federation names are not the same as TeamCreate names.

**Attempt 3.** We added the explicit recipient name and the exact command. Two of the three agents reported back successfully — `maw hey mawjs-dev "#317 complete: ..."` arrived in our pane within minutes of completion. The third (`wasm-safety`) sat silent. We checked the pane: the agent had run `maw hey` once early in the session as part of a confidence-building exercise, decided it had "already reported", and exited without sending the completion message.

The lesson: the contract has to specify *when* to send, not just *that* sending exists.

**Attempt 4 — the one that worked.** The prompt now read, in full:

> Implement WASM safety hardening for issue #319 (memory limits, trap handling, timeout). When you have committed and pushed, **and not before**, run exactly this command, with the issue number and a one-sentence summary of what you actually shipped:
>
> `maw hey mawjs-dev "#319 complete: <summary>"`
>
> Do not exit your Claude session until that command has run successfully. If it fails, debug the failure and retry.

All three agents reported. Issues #317, #318, #319 became commits b9bc15a, e853dd0, 59179bf — and all three messages landed in our pane within five minutes of each other.

The contract was four sentences long. The first three attempts had used variations of the first sentence only. The reporting behavior was load-bearing on the constraints we initially treated as optional.

---

## 3.7 Picking the Right Transport

The decision is mostly downstream of the tier from Chapter 2.

| You are in...    | Use...        | Because...                                     |
|------------------|---------------|------------------------------------------------|
| Tier 1 (Agent)   | Tool result   | Automatic; nothing to choose                   |
| Tier 2 (Team)    | SendMessage   | Named, auto-delivered, structured              |
| Tier 3 (tmux)    | `maw hey`     | The only thing that crosses processes/machines |
| Cross-session    | Inbox         | Survives the session ending                    |

A useful sanity check: if you are about to send a message and the recipient is in a different tier than the sender, you are probably making a mistake. A Tier 2 agent that needs to message a Tier 3 process should write to the inbox, not try to bridge SendMessage to `maw hey`. The bridge does not exist as a primitive, and the moment you try to build one, you have invented a fourth transport that no one else in the system understands.

---

## Takeaways

- Three transports: SendMessage (squads), `maw hey` (federation), inbox (persistent).
- SendMessage is structured and in-process; `maw hey` is plain text and cross-machine; inbox is durable.
- Each transport matches the tier that uses it; mixing transports across tiers is usually a sign you are at the wrong tier.
- The reporting contract must specify *channel*, *recipient*, and *when to send*. Two out of three is silent agents.
- "Let me know when done" is not a contract. It is a hope.

## Next Chapter

Chapter 4 is about the third leg of orchestration: task tracking. TaskCreate, TaskList, TaskUpdate. The lead-compiles pattern that keeps three agents from stomping on each other's commits. And the wasm-hardening team again, this time as a worked example of the full lifecycle — spawn, claim, work, report, compile.
