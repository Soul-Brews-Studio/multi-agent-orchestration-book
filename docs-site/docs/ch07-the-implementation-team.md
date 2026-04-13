---
sidebar_position: 8
title: "Chapter 7: The Implementation Team"
---

# Chapter 7: The Implementation Team

> "Two agents editing the same file is not parallelism. It is a merge conflict with extra steps."

---

## 7.1 When Reading Is Done

Research produced the map. Debate produced the plan. Now someone has to write the code. At this point, the temptation is to hand the whole plan to a single agent and let it execute. That works, up to a scale — and the scale is "whatever fits in one warm context window." Beyond that, you are back to the problem of Chapter 1: the agent forgets what it already wrote.

The **implementation team** is the pattern for crossing that threshold. A small, coordinated squad — typically three agents with explicit named roles — working from a shared task list, each in their own git worktree. The lead agent does not write code. The lead assigns, monitors, and merges.

This is Tier 2 from Chapter 2: `TeamCreate`, `SendMessage`, `TaskCreate`, `TaskUpdate`. Still inside a single parent session, still in-process as far as the harness is concerned — but each agent has its own turn budget and its own working directory.

## 7.2 The Four Rules

Teams work when you obey four rules. Teams fall apart when you break any of them.

**Rule 1: Named roles, not "worker 1" and "worker 2."**
A role is a contract. "Safety auditor" means something; it constrains the scope of the agent's work and the shape of its report. "Worker 2" means nothing. When roles are named, cross-talk between agents gets coherent — "safety, can you verify the gas metering in the patch the tester is reviewing?" is a real sentence. "Can worker 2 look at worker 1's thing" is noise.

**Rule 2: Worktree isolation per agent.**
Each agent works in a separate `git worktree` pointing at its own branch. No two agents ever see the same working tree. The filesystem enforces what the prompt cannot: you cannot edit a file you cannot see. This trades ~200MB of disk for zero merge conflicts during the parallel phase.

**Rule 3: Only the lead writes to main.**
Agents push branches. Agents open PRs (or, in fast mode, report "branch ready"). The lead is the only actor authorized to merge. This is a discipline, not a technical barrier — but it is the single discipline that most distinguishes working teams from broken ones.

**Rule 4: Every agent reports back via TaskUpdate.**
No status check polling. Agents mark their tasks `completed` when done. The lead reads `TaskList` and merges. Silence means not-done; the lead waits (or after a timeout, asks). This is the machine version of "closing the loop" — agents who finish silently are the bane of multi-agent systems.

## 7.3 The Canonical Pattern

```ts
// Step 1: Create the team container.
TeamCreate({
  name: "wasm-hardening",
  members: [
    { name: "safety",   role: "WASM runtime safety auditor",   model: "opus"   },
    { name: "tester",   role: "Test author for host functions", model: "sonnet" },
    { name: "verifier", role: "End-to-end runtime verifier",    model: "sonnet" },
  ],
})

// Step 2: Create the tasks, one per agent, with explicit deliverables.
TaskCreate({ id: "1", subject: "Audit memory protocol",
             description: "Review src/wasm/memory.ts for OOB reads,
                           confirm 16MB cap, 5s timeout, trap handling.
                           Branch: chore/wasm-safety-audit.",
             owner: "safety" })
TaskCreate({ id: "2", subject: "Write host function tests",
             description: "Cover maw_print, maw_identity, maw_send, maw_fetch.
                           Branch: test/wasm-host-functions.",
             owner: "tester" })
TaskCreate({ id: "3", subject: "Verify Rust hello-world → WASM e2e",
             description: "Build hello-world, load into runtime, confirm output.
                           Branch: test/wasm-e2e-hello.",
             owner: "verifier" })

// Step 3: Kick them off. Each agent starts in its own worktree.
SendMessage({ to: "safety",   message: "Task #1 is yours. Report via TaskUpdate." })
SendMessage({ to: "tester",   message: "Task #2 is yours. Report via TaskUpdate." })
SendMessage({ to: "verifier", message: "Task #3 is yours. Report via TaskUpdate." })

// Step 4: Lead waits, polls TaskList, merges when ready.
// Step 5: Lead runs the tests, pushes to main, closes tasks.
```

The shape is deliberate. Roles are named before tasks are created. Tasks are created before messages are sent. Messages assign one task each. Nothing is implicit.

## 7.4 Case Study: The `wasm-hardening` Team

This is a small team that punched above its weight. The goal: take the WASM plugin runtime from "it runs" to "it runs safely." Three agents. Four minutes of wall-clock. Every task completed.

**Setup** (roughly 20 seconds):

The lead created a team named `wasm-hardening` with three members — `safety` (Opus, auditor), `tester` (Sonnet, test author), and `verifier` (Sonnet, e2e runner). Three worktrees spun up automatically under `.worktrees/`, each on its own branch.

**Parallel execution** (roughly 3.5 minutes):

The three agents worked in isolation. `safety` read every file in `src/wasm/`, filed notes on three OOB concerns, and patched the memory bounds check on branch `chore/wasm-safety-audit`. `tester` authored a test file covering all four host functions (`maw_print`, `maw_identity`, `maw_send`, `maw_fetch`) on branch `test/wasm-host-functions`. `verifier` built the Rust hello-world example, loaded the resulting 81.6KB WASM into the runtime, confirmed the output hit stdout, and wrote a smoke-test harness on branch `test/wasm-e2e-hello`.

None of them saw each other's work during this phase. None of them could have — worktree isolation made it physically impossible.

**Sequential merge** (roughly 30 seconds):

The lead read `TaskList`, saw three `completed` statuses, and merged in dependency order: `safety` first (it touched the memory protocol the tests relied on), then `tester`, then `verifier`. Ran the full test suite on main. Green. Pushed.

**Final metrics**:

| Measurement | Value |
|-------------|-------|
| Team members | 3 (1 Opus, 2 Sonnet) |
| Wall time (spawn → merge) | ~4 minutes |
| Branches produced | 3 |
| Merge conflicts | 0 |
| Tasks completed | 3/3 |
| Files touched total | 11 |
| Files touched by more than one agent | 0 |
| WASM artifact size | 81.6KB (Rust hello-world) |

The zero-merge-conflict number is the one that matters. It is not luck. It is a consequence of worktree isolation plus disjoint task assignments — the lead designed the task boundaries so that no two tasks required editing the same file. That is part of the job.

## 7.5 The Lead's Real Work: Drawing the Seams

The most important thing the lead does is decide where the cuts between tasks go. Cut well, and three agents run in parallel without conflict. Cut badly, and you have one agent waiting on another, or worse, both editing `src/server.ts`.

Three heuristics for drawing seams:

**By module.** If `src/wasm/memory.ts` and `src/wasm/host.ts` do not import each other, they can be worked on independently. Check the import graph first. `rtk grep "from.*memory"` tells you in seconds which files are coupled.

**By concern.** "Audit" (read + small patch), "test" (new test file), "verify" (e2e harness) are naturally disjoint — the audit touches source, the test touches `test/`, the verifier touches a scratch harness. Three concerns, three directories, three seams.

**By branch.** If your plan requires two tasks to both land in `src/server.ts`, they are not actually two tasks — they are one task with two sub-steps. Collapse them to one agent, or sequence them across waves.

When you cannot find a clean seam, the task is wrong. Reshape it before spawning agents. A team cannot rescue a plan that is not decomposable.

## 7.6 Model Choice Per Role

Not every role needs Opus. In the `wasm-hardening` team, the safety auditor got Opus because the work was adversarial reasoning — "what could go wrong here that the author did not think of?" The tester and verifier got Sonnet because their work was procedural — "write tests that cover these four functions," "load this binary and check stdout."

A rough guide:

| Role shape | Default model |
|------------|---------------|
| Auditor, designer, architect, reviewer | Opus |
| Implementer, test author, refactorer | Sonnet |
| Reader, summarizer, file-sweeper | Haiku |

Mixing models across the team is economical and correct. A three-Opus team costs 3× a three-Haiku team and is only right when all three roles need Opus-grade reasoning — rare. Most teams are 1-Opus, 2-Sonnet, or all-Sonnet.

## 7.7 When a Team Is the Wrong Tier

Two failure modes.

**The team that should have been a swarm.** If your three tasks are all "read X and report," you do not need a team — you need a research swarm (Chapter 5). Teams imply writing; swarms imply reading. Paying team overhead for read-only work is waste.

**The team that should have been tmux.** If your tasks take more than thirty minutes each, or if they need to survive a session crash, or if the human needs to `peek` at an agent from another terminal — you need tmux federation (Chapter 8). Teams are in-process. They die when the parent session dies. For a 4-minute sprint like wasm-hardening, that is fine. For a 4-hour overnight build, it is catastrophic.

The decision tree, compressed: under 30 minutes and writes code → team. Over 30 minutes or cross-session → tmux. Read-only at any scale → swarm.

## 7.8 The Lead Never Writes Code

This is the rule that most breaks when the pattern goes wrong. The lead gets impatient. The lead "just fixes one little thing" while waiting for the team. Now the lead is editing the same `src/server.ts` that `verifier` is about to open. Merge conflict. Or worse, the lead's edit silently overwrites `verifier`'s work.

The discipline: while the team is running, the lead does not touch code. The lead reads task output, drafts merge messages, prepares the next wave. When the team is idle (tasks all completed, merged, tested), the lead can write — but at that point, the team is no longer running and the next wave has not yet started.

This rule has teeth. In our sessions, every time we broke it, we paid for it within the next ten minutes. Every time we held it, the merge was boring. Boring merges are the goal.

---

## Takeaways

- The implementation team is 3-5 named roles working from a shared task list, each in their own git worktree.
- Worktree isolation makes merge conflicts physically impossible during the parallel phase.
- The lead assigns, monitors, and merges. The lead does not write code while the team runs.
- Draw seams between tasks by module, by concern, or by branch. Bad seams are the lead's failure, not the team's.
- Mix models by role: Opus for reasoning, Sonnet for implementation, Haiku for reading.
- Use teams when you need to write code in under 30 minutes. Use tmux when you need longer or cross-session.
- The `wasm-hardening` team shipped 3 tasks across 3 branches in 4 minutes with zero conflicts. That is the benchmark.

## Next Chapter

Chapter 8 steps outside the parent session entirely. When work needs real isolation — a process you can `maw peek` at from another terminal, that survives your laptop going to sleep, that reports back via `maw hey` — you are in federation territory. We will tell the war story of four failed spawn attempts and the pattern that finally worked.
