# Chapter 4: Task Tracking

> "If two agents both think they own the file, one of them is about to lose work."

---

## 4.1 Why Tracking Is Not Optional

Three agents in three worktrees can produce three commits in four minutes. They can also produce three commits to the same file in four minutes, with the lead spending the next twenty resolving merge conflicts. The difference is task tracking.

Task tracking, in the Claude Code runtime, is a built-in primitive — `TaskCreate`, `TaskList`, `TaskUpdate`, `TaskGet`. It is not a project-management overlay. It is a coordination protocol the agents themselves consult and update. When the wasm-hardening team's `tester` agent woke up, the first thing it did was call `TaskList`, find the task with its name on it, mark it `in_progress`, and start working. When it finished, it called `TaskUpdate({ taskId: "2", status: "completed" })` before sending its report. The status was visible to every other agent and to the lead in real time.

This chapter walks through the lifecycle, the lead-compiles pattern that gives agents structure without giving them shared write surface, and the wasm-hardening team end to end as the worked example.

---

## 4.2 The Lifecycle

There are four states in the system: `pending`, `in_progress`, `completed`, `deleted`. There is a fifth field that does most of the work — `owner`, the name of the agent currently responsible. There is a sixth field that prevents a class of bug — `blockedBy`, a list of task IDs that must reach `completed` before this task can start.

The lifecycle of a single task:

1. **Lead creates.** `TaskCreate({ subject, description, owner })` — created `pending`, with an owner if pre-assigned, or empty for the first available agent to claim.
2. **Agent claims.** `TaskUpdate({ taskId, owner: "<my-name>", status: "in_progress" })` — claim and start in one call.
3. **Agent works.** May call `TaskUpdate` to refine subject, add metadata, or note progress in the description. Should not call it just to say "still working" — the runtime infers that from the unchanged `in_progress` state.
4. **Agent completes.** `TaskUpdate({ taskId, status: "completed" })` *before* sending the SendMessage report. Order matters; the lead will look at TaskList while it reads the report, and a stale state confuses it.
5. **Lead compiles.** When all tasks are `completed`, the lead reads each agent's report, merges branches, runs tests, and writes the final commit.

That is the whole protocol. The schema is small on purpose. Anything more elaborate ends up either ignored by the agents or duplicated in the prompt.

---

## 4.3 The Lead-Compiles Pattern

The single most important convention we landed on is this: **only the lead writes to the canonical branch.**

Each subordinate agent works in its own worktree, on its own branch, and commits there. The lead reads each agent's diffs (or just their reports, if the diffs are large), decides which to keep, and merges into `main` — or into the integration branch — itself. Subordinates never merge to main. They never even fetch each other's branches. They report and stop.

Why this works:

- **No write contention.** Three agents touching `src/api/sessions.ts` is a problem only if all three try to commit to the same branch. In their own worktrees, they cannot collide.
- **Lead arbitrates.** When two agents both touched `src/types.ts`, the lead picks the merge order, resolves any semantic conflict by reading both reports, and writes the final commit message. The lead has the full context the subordinates lack.
- **Atomic visibility.** The work appears in `main` as one commit (or one merge commit) attributable to the team as a whole, not as a confusing zigzag of partial branches.
- **Failure is local.** If `tester` produces broken code, the lead drops `tester`'s branch and the other two agents' work is unaffected. The cost of rolling back one agent is one branch deletion.

The contrasting anti-pattern, which we tried at hour 33 and abandoned at hour 36: three agents on three feature branches, all auto-merging to a shared integration branch. By the third merge the integration branch was failing in ways no individual agent had introduced. The lead spent more time bisecting than the agents had spent implementing.

The rule is short and absolute: **subordinates write to their own branch; the lead is the only writer on the integration branch.** If you only remember one rule from this chapter, remember that one.

---

## 4.4 Worked Example — The wasm-hardening Team

The wasm-hardening team ran for about four minutes wall time and produced commits b9bc15a (#317), e853dd0 (#318), and 59179bf (#319). Here is the full sequence, condensed.

### Phase 1: Lead sets up

```typescript
// Lead, hour 84, in the main mawjs-dev session.
TeamCreate({ name: "wasm-hardening", lead: "team-lead" });

TaskCreate({
  subject: "Audit memory bounds in WASM bridge",
  description: "Read src/wasm/bridge.ts. Find every read/write that could exceed the 16MB cap. Report file:line for each.",
  owner: "safety",
});
TaskCreate({
  subject: "Write 10 host-function tests",
  description: "Cover maw_print, maw_identity, maw_send, maw_fetch. At least one negative test per function.",
  owner: "tester",
});
TaskCreate({
  subject: "Verify Rust SDK against host contract",
  description: "Confirm the Rust SDK crate's host bindings match the bridge's exported functions exactly.",
  owner: "rust-verifier",
});
```

Three tasks, three pre-assigned owners, no `blockedBy` because the work is independent.

### Phase 2: Lead spawns the agents

```typescript
Agent({ name: "safety",        team_name: "wasm-hardening",
        prompt: "You are 'safety' on team 'wasm-hardening'. Run TaskList. Claim your task with TaskUpdate. Work in worktree wt-safety. When done, TaskUpdate to completed and SendMessage your findings to team-lead." });

Agent({ name: "tester",        team_name: "wasm-hardening",
        prompt: "You are 'tester' on team 'wasm-hardening'. Same protocol. Worktree wt-tester." });

Agent({ name: "rust-verifier", team_name: "wasm-hardening",
        prompt: "You are 'rust-verifier' on team 'wasm-hardening'. Same protocol. Worktree wt-rust-verifier." });
```

The prompts are nearly identical because the protocol is identical. What differs is the task name and the worktree.

### Phase 3: Agents work in parallel

Within thirty seconds, `TaskList` looks like this:

```
#1  in_progress  safety         Audit memory bounds in WASM bridge
#2  in_progress  tester         Write 10 host-function tests
#3  in_progress  rust-verifier  Verify Rust SDK against host contract
```

Each agent did the same opening dance: `TaskList`, find its task, `TaskUpdate({ taskId, status: "in_progress" })`, then start reading code. The lead's TaskList view updates in real time. There is no need to ping any agent for a status update.

### Phase 4: Agents report

`rust-verifier` finished first at ~T+2 min:

```typescript
TaskUpdate({ taskId: "3", status: "completed" });
SendMessage({
  to: "team-lead",
  summary: "rust SDK verified against host contract",
  message: "All 4 host functions match. One signature drift fixed: maw_send was u32 in SDK, i32 in bridge. Patched in wt-rust-verifier. Branch ready to merge.",
});
```

`tester` finished at ~T+3 min, `safety` at ~T+4 min. Each followed the same `TaskUpdate` → `SendMessage` order. By T+4, the `TaskList` was three `completed` rows.

### Phase 5: Lead compiles

```bash
git fetch wt-rust-verifier && git merge wt-rust-verifier/main --no-ff
git fetch wt-tester        && git merge wt-tester/main        --no-ff
git fetch wt-safety        && git merge wt-safety/main        --no-ff
bun test     # 10 new tests, all green
```

Three commits, three reports, one merge sequence by the lead. The commits became b9bc15a, e853dd0, 59179bf in the maw-js history. Total wall time from `TeamCreate` to clean shutdown: roughly four minutes.

### Phase 6: Shutdown

```typescript
SendMessage({ to: "safety",        message: { type: "shutdown_request" } });
SendMessage({ to: "tester",        message: { type: "shutdown_request" } });
SendMessage({ to: "rust-verifier", message: { type: "shutdown_request" } });
// each replies with shutdown_response approve:true
TeamDelete({ name: "wasm-hardening" });
```

Clean. No leftover panes, no dangling tasks, no half-merged branches.

---

## 4.5 What TaskCreate Buys You That a TODO List Does Not

You could, in principle, replace TaskCreate with a markdown TODO file and a convention. The reasons not to:

- **TaskList is a runtime primitive.** Every agent in the team can call it at any time without reading and parsing a file. The latency is microseconds, not seconds.
- **Status is structured.** "completed" is an enum, not a string. The lead can filter on it, the runtime can render it, future tooling can graph it.
- **`blockedBy` is enforceable.** Tasks with unsatisfied dependencies cannot be claimed. The runtime says so. A markdown convention requires the agent to remember to check, and the agent will not.
- **`owner` is a coordination point.** When an unassigned task appears, the next available agent claims it by setting `owner` and `in_progress` in one call. Two agents racing for the same task is resolved by the runtime, not by polite convention.

The TODO file emerges naturally from an agent that has not been told about TaskCreate. Once you teach the agent the primitive, the TODO file looks crude in retrospect.

---

## 4.6 When To Use `blockedBy`

Most tasks in a team are independent — that is the whole reason you are using a team. But occasionally there is a real ordering constraint. Migration: schemas first, then DI, then framework swap. Build: compile, then test, then package. For these, `blockedBy` is the right tool.

```typescript
TaskCreate({ subject: "Compile",  owner: "builder" });          // id 1
TaskCreate({ subject: "Test",     owner: "tester",
             addBlockedBy: ["1"] });                             // id 2
TaskCreate({ subject: "Package",  owner: "packager",
             addBlockedBy: ["2"] });                             // id 3
```

`tester` cannot claim task 2 until task 1 is `completed`. The runtime enforces this. The agents do not need to coordinate the ordering by talking to each other.

If you find yourself drawing a complex DAG of `blockedBy` dependencies, you are probably over-engineering. Three to five tasks with mostly-independent ownership is the sweet spot. Above that, decompose into multiple sequential teams instead of one big team with intricate dependencies.

---

## Takeaways

- TaskCreate / TaskList / TaskUpdate are the runtime's coordination primitive — not optional ceremony.
- The lifecycle is small: `pending` → `in_progress` → `completed`, with `owner` doing the routing.
- Lead-compiles is the rule that keeps three agents from corrupting each other's work: subordinates write to their own branches; only the lead merges to the integration branch.
- The wasm-hardening team finished three tasks, three commits, in four minutes by following the protocol mechanically.
- `blockedBy` exists for real ordering constraints. Use it sparingly; deep dependency graphs are a sign you should split the team.

## Next Chapter

Part I closes here. Part II opens with Chapter 5 and the first real pattern: the research swarm. Three to five Haiku agents in parallel, exploring a codebase or a body of documentation, returning a synthesis in minutes — and the wave-execution discipline that keeps the swarm from wasting tokens on questions it has already answered.
