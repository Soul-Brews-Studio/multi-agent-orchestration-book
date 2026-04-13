---
sidebar_position: 10
title: "Chapter 9: The Cron Loop"
---

# Chapter 9: The Cron Loop

> "The fifth pattern is the one that works while you sleep."

---

## 9.1 Agents That Wake Themselves

The first four patterns in Part II are all triggered by the human. You spawn a research swarm when you hit a reading bottleneck. You spawn a debate when you hit a decision. You spawn a team when you hit an implementation. You federate when the work needs to outlive your attention. In every case, the human is the clock — the agents run when you press the button.

The **cron loop** is the pattern where the agent is the clock. A recurring schedule, or a self-paced rewake, that advances a task incrementally without needing the human to re-prompt. There are two shapes — `CronCreate` for fixed-interval scheduling, and `ScheduleWakeup` for dynamic self-pacing — and they serve different problems. This chapter covers both.

## 9.2 Two Shapes of Loop

**`CronCreate` — fixed interval, external trigger.**
You register a schedule ("every 5 minutes") and a prompt. The harness fires the prompt on that cadence. Each firing is a fresh session with a clean context. Previous firings are persisted only in whatever artifacts they left on disk (files, git commits, inbox entries). Use this when the work is genuinely periodic — a sprint loop, a health check, an overnight build step.

**`ScheduleWakeup` — dynamic, self-triggered.**
The current agent decides *when to be re-invoked*. Inside one conversation, the agent calls `ScheduleWakeup({ delaySeconds, prompt })` and the harness wakes the same conversation at that offset. Use this when the work is reactive — polling a background process, waiting for a build, pacing work that does not fit a clean fixed interval.

The decision is straightforward: does the cadence depend on the state of the work? If no, `CronCreate`. If yes, `ScheduleWakeup`.

## 9.3 Case Study: 17 Plugins via the 5-Minute Loop

The plugin sprint happened in the first hour of the 2026-04-13 active session, between 09:30 and 10:25. Seventeen plugins — `doctor`, `feed`, `costs`, `logs`, `transport`, `avengers`, `worktrees`, `triggers`, `morning`, `ping`, `status`, `who`, `peers`, `dashboard`, `quick`, `hello`, `plugin` — were built, typed, SDK-migrated, and committed to the `maw-commands` repository.

The mechanism was a 5-minute cron loop. A standing prompt registered with `CronCreate`:

```ts
CronCreate({
  schedule: "*/5 * * * *",   // every 5 minutes
  prompt: `
    You are the plugin builder. Your job:
    1. Check ψ/memory/plugin-backlog.md. Pick the top unbuilt plugin.
    2. Build it in maw-commands/plugins/<name>.ts
       - import { maw } from "maw/sdk"
       - zero \`any\` types
       - register the CLI command in plugin.ts
    3. Commit: "feat(<name>): initial build"
    4. Update ψ/memory/plugin-backlog.md — strike the one you built.
    5. If the backlog is empty, write "ALL CLEAR" to maw inbox and exit.
  `,
})
```

Every five minutes, a fresh Claude process fired with the same prompt, read the same backlog file, picked the next item, built it, committed, and struck its line. Fifteen firings produced fifteen plugins (two came from the human directly while the loop was running).

The architectural insight: the cron firings were **stateless-by-design**, but the backlog file carried all the state. Each firing was identical in prompt, different in effect, because the state lived in the artifact not the agent. This is the pattern's defining property. If you need each firing to know what prior firings did, put the knowledge on disk. Do not try to share context across firings — you cannot, and you should not want to.

**Metrics from the loop**:

| Measurement | Value |
|-------------|-------|
| Cadence | every 5 minutes |
| Plugins built via loop | 15 of 17 |
| Firings | 15 |
| Human interventions mid-loop | 0 (2 plugins built out-of-band) |
| State carrier | `ψ/memory/plugin-backlog.md` + git |
| Wall-clock sprint duration | ~55 minutes |
| Termination condition | "ALL CLEAR" sentinel written to inbox |

The human's job during that 55 minutes was not to write plugins. It was to watch the git log, catch any plugin that came out wrong, and push fixes. The loop did the boring work. The human did the judging.

## 9.4 The `CronCreate` Pattern

```ts
CronCreate({
  name: "plugin-builder",
  schedule: "*/5 * * * *",          // cron syntax
  prompt: `
    <the full instructions, as if this is the first time they are being read>
    <because for this agent, it always is>

    STATE LIVES IN: ψ/memory/plugin-backlog.md
    ARTIFACT LIVES IN: maw-commands/plugins/
    TERMINATION: write "ALL CLEAR" to maw inbox when backlog empty.
  `,
  // Optional: stop condition, timeout, model override
})
```

Three design rules for cron prompts:

**Rule 1: The prompt is the whole prompt.**
There is no previous turn. There is no "as we discussed." The prompt must reintroduce the task from zero every time. Treat it as if you are handing instructions to a stranger, because you are.

**Rule 2: All state must be on disk.**
The backlog file, a SQLite table, a git branch, an inbox entry — pick a medium. The agent reads state at the start and writes state at the end. In-memory state within a firing is fine; between firings, only disk survives.

**Rule 3: A sentinel terminates the loop.**
Cron will fire forever unless you stop it. Every cron prompt should include a termination clause: "if condition X, write sentinel Y and do nothing." The orchestrator (or a second cron) reads the sentinel and calls `CronDelete`. Without a sentinel, you will wake up tomorrow with 288 firings' worth of noise.

## 9.5 The `ScheduleWakeup` Pattern

`ScheduleWakeup` is the self-paced cousin. Instead of a fixed cadence, the agent chooses when to resume. The call is made from within a turn; the harness wakes the same conversation at the requested offset.

```ts
// Inside the agent's turn:
Bash({ command: "bun run build", run_in_background: true })
// ... agent checks status, decides it's mid-build ...
ScheduleWakeup({
  delaySeconds: 270,                 // under 5 minutes — stays in prompt cache
  prompt: "<re-entry instructions>",
  reason: "bun build still running, checking back in 4.5 min",
})
```

Two implementation details that matter in practice:

**The 300-second boundary.** The Anthropic prompt cache has a 5-minute TTL. Sleeping ≤270 seconds keeps your conversation context cached — the resumed turn reads everything warm and cheap. Sleeping ≥300 seconds means a full cache-miss reread on resume. Do not pick 300. Either stay under (270) or commit to a long sleep (1200+) that amortizes the cache miss across a meaningful wait.

**The reason field is user-facing.** It appears in telemetry and UI. "checking build" is a bad reason. "bun build ~6 min, checking back in 4.5 min to catch completion" is a good one. Specificity helps the human predict your cadence without having to poll you.

`ScheduleWakeup` is the right pattern when you are waiting for a background process, pacing a workload against an external rate limit, or running an overnight loop where the "next step" depends on the current result. It is the wrong pattern when the cadence is truly fixed — reach for `CronCreate` instead.

## 9.6 State Hygiene

The most common failure mode in cron loops is state drift. Firing N reads the file; firing N+1 reads a different version of the file because firing N+0.5 happened out-of-band (a human edit, a concurrent agent, a merge). Two hygiene practices prevent this.

**Atomic writes.** The backlog update must be all-or-nothing. Write to `plugin-backlog.md.tmp`, then rename to `plugin-backlog.md`. Do not edit in place. A crash mid-edit corrupts the state for every future firing.

**Monotonic IDs.** Every firing's commits should be marked with a firing ID or timestamp. If firing #7 and firing #8 both think they should build `morning.ts`, the git log will show you which won and which is a duplicate. The alternative — silent overlapping work — is very hard to diagnose.

For the plugin sprint specifically, we used one additional trick: **the backlog as a single source of truth**. There was no sprint-plan file, no issue tracker firing alongside. One file, one format ("- [ ] name — short description"), one strike-through convention. When the file had no unchecked boxes, the loop terminated. No ambiguity.

## 9.7 Observability for Loops

Cron loops without observability become silent machines. You want three things visible at all times:

1. **Firing log.** When did each firing start and end? Did any fire fail to complete? `CronList` surfaces this.
2. **State deltas.** Git log of the backlog file. `git log --follow ψ/memory/plugin-backlog.md` shows every firing's effect on the state.
3. **Sentinels and inbox.** `maw inbox read` during and after the sprint. "ALL CLEAR" should arrive exactly once. If it arrives twice, two firings hit the termination condition simultaneously and you have a race.

Our standing advice: open a tmux pane running `watch -n 5 git log --oneline -n 20` in the maw-commands repo while a cron sprint is live. You will see each firing land in real time. A gap in the log is a firing that died silently — investigate immediately.

## 9.8 When Not to Use the Loop

Two anti-uses recur.

**The loop that should have been a team.** If all your work fits in one warm context window and takes under ten minutes, `TeamCreate` is simpler. Cron firings pay a fresh-session cost each time — prompt re-read, context re-establishment. For short work, that overhead dominates.

**The loop that should have been federation.** If each firing takes longer than the interval, you will start stepping on yourself — firing N+1 launches while firing N is still running. Either lengthen the interval (often not ideal) or switch to a single long-running tmux agent with `ScheduleWakeup` inside it, so the cadence follows the work.

The right question: "is the work genuinely periodic, with each unit small enough to fit comfortably inside one interval?" If yes, cron. If no, reach for another tier.

## 9.9 The Human's Role in a Loop

Humans who watch cron loops for long enough develop a reflex: *do not interfere mid-firing*. Let the agent finish the current unit of work, let it commit, let it strike the backlog line. Then, if you need to correct something, do it between firings. Injecting edits during a firing is how you end up with two concurrent writers to the same file — precisely the class of conflict the loop was designed to avoid by having one firing at a time.

The discipline is the same as with the implementation team in Chapter 7: when the agent is working, the human is reading. When the agent is between firings, the human can write. The cadence defines the seam.

---

## Takeaways

- The cron loop is the fifth pattern: agents that wake on a schedule or self-pace via `ScheduleWakeup`.
- `CronCreate` for fixed cadences. `ScheduleWakeup` for reactive pacing.
- Every firing is a fresh session with no memory of previous firings. State must live on disk.
- Cron prompts need: full context, a disk-based state carrier, and a sentinel termination condition.
- For `ScheduleWakeup`, respect the 270s / 1200s boundary — 300s is the worst choice.
- The 17-plugin sprint shipped 15 plugins across 15 firings in 55 minutes with zero human interventions mid-loop.
- Observe loops via `CronList`, git log on the state file, and inbox sentinels. Silent firings are bugs.
- Use cron when work is periodic and per-unit small. Use team or federation otherwise.

## Next Chapter

Chapter 9 closes Part II. Part III opens with Chapter 10 — the plugin architecture that made the 17-plugin sprint even possible: the typed SDK, TypeBox as a single source of truth, and the `maw.fetch<T>()` pattern that won the debate in Chapter 6.
