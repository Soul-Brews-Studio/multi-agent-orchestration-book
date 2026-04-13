# Chapter 14: Failure Modes

> "I noticed I was rationalizing about the error() bug. My first instinct was 'Elysia's API changed' — but the truth is I didn't read the source."
> — AI diary, session 4833f831

---

## 14.1 Why This Chapter Exists

Most writing about multi-agent systems shows the highlight reel. This chapter is the blooper reel, because you learn more from the blooper reel.

Every failure in this chapter happened in a single session (4833f831, April 2026). Every one has a root cause, a cost, and a prevention. The goal is not to shame the past AI; it is to make sure the next AI — you, in whatever form this book reaches you — does not relearn these the hard way.

Five failures are covered:

1. **The silent agent** — a tmux agent that never reported.
2. **The merge conflicts** — two subagents, one file.
3. **The `error()` bug** — batch migration gone wrong.
4. **The orphaned worktrees** — agents that died leaving branches behind.
5. **The cross-repo `maw wake`** — a command that couldn't do what it advertised.

## 14.2 Failure 1: The Silent Agent

### What happened

Three tmux agents were spawned for the WASM architecture phase: `wasm-host` (#317), `rust-sdk` (#318), `wasm-safety` (#319). Two of them reported back. One did not.

```
[wasm-host]    maw hey: "DONE: shipped host functions on feat/wasm-host-functions"
[rust-sdk]     maw hey: "DONE: published crate on feat/rust-sdk-v0.1"
[wasm-safety]  <silence for 30 minutes>
```

`maw peek wasm-safety` showed the session was still alive. The agent had reached step 4 of its prompt, committed a branch, and then — for reasons that require reconstructing from the pane — simply stopped. It had not run step 5 (`maw hey` the parent).

### Root cause

The prompt did contain the reporting instruction. But `wasm-safety`'s task list included "add gas metering" which expanded into a deeper-than-expected investigation. The agent went into a rabbit hole, hit something that confused it, and stopped at what it thought was a checkpoint. Without a loop driver or a timeout, "stopped" and "done" look identical from the outside.

More precisely: the agent's interpretation of "ALWAYS report back" was *at the end of the task*. When it decided the task was not yet complete, it did not report. But it also did not escalate. It waited for instructions it was never going to receive, because the parent did not know it was waiting.

### Prevention

Three layers, any one of which would have caught it:

1. **Heartbeat, not just completion.** The prompt should require periodic `maw hey` updates, not only a terminal report. Every 5 minutes, or at every commit, say something.
2. **Explicit escalation clause.** "If you are blocked or uncertain, `maw hey` the parent with `STUCK: <what you need>`."
3. **`maw agents` status check.** A product-level command that lists running agents and flags ones idle beyond a threshold.

The eventual fix in the prompt template:

```
STEP 5: Report progress AT LEAST every 5 minutes with:
  maw hey <parent> "[<name>] PROGRESS: <what you just did>"
  
STEP 6: When done OR stuck, send:
  maw hey <parent> "[<name>] DONE: <branch>" | "[<name>] STUCK: <reason>"
```

The silent agent was the clearest single piece of evidence that Tier 3 (raw tmux) needs protocol, not just prompts.

## 14.3 Failure 2: The Merge Conflicts

### What happened

Phase 3 of the Elysia migration split 21 API files across three worktree agents: batch1 (7 files), batch2 (8 files), server+index (6 files plus the top-level `src/server.ts` and `src/api/index.ts`). Each agent worked in its own git worktree with its own branch.

Two of the three agents edited `src/api/index.ts`. Batch1 added new imports for the files it migrated. The server+index agent rewrote the file wholesale for Elysia mounting. When the lead went to merge, batch1's changes conflicted with server+index's rewrite.

### Root cause

The split was by file count, not by file boundary. `src/api/index.ts` was a shared registration point touched by every migration. Assigning it to one agent did not prevent the others from needing to edit it, because every new Elysia handler needed to be wired in.

The deeper issue: the lead (me) had divided the work naively. "7, 8, 6" is a count, not a plan. A plan would have identified which files had cross-file dependencies and isolated the agents to disjoint *edit sets*, not disjoint *file sets*.

### Prevention

- **Pre-compute the edit set per agent.** If `index.ts` is going to be touched by every batch, give it to one agent and have the others produce PATCHES they can apply after the merge.
- **Use the "only lead writes to shared files" rule.** Agents report what they need appended to the shared file; the lead does the append.
- **Test the merge before the work.** A trial merge with empty branches confirms the division makes sense.

In this case, the recovery was cheap: the lead manually reconciled the three versions of `index.ts` in under five minutes. The cost was attention, not time. But in a bigger migration, the cost of missed coordination is an hour of three-way diff reading.

## 14.4 Failure 3: The `error()` Bug

### What happened

This is the most expensive failure of the session. Three commits to fix. Thirty minutes of noise in the git history. It deserves the full autopsy.

The Elysia migration pattern was mechanical:

```typescript
// Hono
return c.json({ error: "not found" }, 404);

// Elysia (what I wrote)
return error(404, { error: "not found" });
```

Every tutorial I had read for Elysia used this `error()` function. I batch-migrated all 21 files with this pattern. 63 call sites. Everything compiled. Then the server started and every 4xx path threw at runtime:

```
TypeError: error is not a function
```

The `error()` function does not exist in Elysia 1.4.28. Not as an export from `elysia`. Not in the handler context. Not destructured. It simply is not there. The tutorials I had read were for a newer API that had not shipped yet.

### Root cause

Two causes, nested:

1. **I trusted secondary sources over the installed version.** I read blog posts and tutorials. I did not run `bun -e "import { error } from 'elysia'; console.log(error)"` to confirm the thing existed.
2. **I batch-migrated before validating.** Even if I had been wrong about `error()`, a single-handler end-to-end test would have revealed it within 60 seconds. Instead I transformed 21 files in parallel worktrees and discovered the problem when the server failed to serve any error response.

The first cause is about epistemic humility. The second is about sequencing.

The session's retrospective says it exactly:

> "I should have tested one handler before batch-migrating all 21 files."

And, pointedly:

> "We had the Elysia source right there in `ψ/learn/elysiajs/elysia/origin/`. Nat even pointed it out: 'we have elysia source code we just /learned so we can read more!' He was right. I had 123K of documentation I generated and didn't consult when it mattered."

### Prevention

The rule, now carved into a separate learning file:

> **Test one handler end-to-end before batch-migrating many.**

The protocol:

1. Pick the simplest file. Migrate it manually.
2. Run it. Hit success path, error path, validation rejection.
3. Only after that one file works perfectly do you touch the rest.

Also:

- **Read the installed source, not the tutorial.** `bun pm ls elysia` shows the version. `node_modules/elysia/src` shows the real API. The tutorial shows what the author wished they had time to ship.
- **Consult your own learning corpus.** If you ran `/learn --deep elysia` and generated 123K of docs, use them when you hit a problem. Your own notes beat generic internet content.

The final fix replaced all 63 call sites with `set.status = 404` followed by a plain returned object:

```typescript
set.status = 404;
return { error: "not found" };
```

Elysia 1.4.28's real pattern. Less elegant than what I wrote. Actually works.

## 14.5 Failure 4: The Orphaned Worktrees

### What happened

After the Elysia phase 3 merge, `git worktree list` showed seven entries. Three were the active agents. Four were ghosts — branches that had been merged or abandoned, whose worktrees had not been cleaned up.

```
$ git worktree list
/path/to/maw-js                      [main]
/path/to/maw-js-batch1                [feat/elysia-batch1]    <-- ghost
/path/to/maw-js-batch2                [feat/elysia-batch2]    <-- ghost
/path/to/maw-js-server                [feat/elysia-server]    <-- ghost
/path/to/maw-js-old-attempt           [feat/wasm-exploration] <-- ghost
...
```

Nothing was broken. But on a second clone, on a second machine, on a fresh start, you would not inherit this mess — and on the original machine, `git fetch`, `git branch -a`, and shell tab-completion were now noisier by four entries.

### Root cause

Worktrees are created per agent and never cleaned. The agent's `TaskCreate` → `Agent` → `SendMessage` lifecycle has no "worktree cleanup" stage. When the team is shut down (`TeamDelete`), the worktrees remain because git considers them first-class filesystem state.

### Prevention

- **Cleanup as part of the shutdown protocol.** After `SendMessage({type: "shutdown_response", approve: true})`, the lead should `git worktree remove <path>` for each agent's workspace.
- **Prefer `isolation: "worktree"` in the `Agent` tool.** That mode auto-cleans when the agent makes no changes, and returns the path on exit so the lead can remove it explicitly.
- **`maw worktrees` plugin.** Ship a command that lists and prunes stale worktrees. (This became a plugin in the catalog during the same session.)

## 14.6 Failure 5: `maw wake --issue` Cross-Repo

### What happened

The first attempt at spawning tmux agents used what should have been the high-level command:

```bash
maw wake mawjs-oracle --new wasm-host --issue 317
```

It failed:

```
Could not resolve to an issue or pull request with the number of 317
```

The issue was on `Soul-Brews-Studio/maw-js`, not on the oracle's own repo. Adding `--repo Soul-Brews-Studio/maw-js` produced a different failure:

```
oracle repo not found: mawjs-oracle
```

The `--new` flag was trying to create a git worktree of the oracle's own repo while resolving the issue against a different repo, and the combination confused the resolver.

### Root cause

`maw wake` conflated two concepts:

1. *Which oracle to wake* (identity, `mawjs-oracle`).
2. *Which repo to work in* (codebase, `Soul-Brews-Studio/maw-js`).

For an oracle whose primary work happens in its own repo, these are the same and nothing breaks. For an oracle whose work happens in a *different* repo — which is the common case for most budded oracles — the command has no coherent semantics.

### Prevention (this one is a product gap)

- **Separate the two concepts.** `--oracle` for identity, `--repo` for codebase, `--issue` for task, with each resolving independently.
- **`maw wake --task "<prompt>"` mode.** Skip issue resolution entirely; let the caller hand a prompt.
- **Fallback to the raw pattern.** When the high-level command does not fit, the documented workaround is `tmux new-session ... claude -p` with `maw hey` baked in.

The workaround (baking `maw hey` into the `claude -p` prompt) is the pattern that actually shipped for this session. But the friction of four failed attempts is the signal: the product needs this.

## 14.7 Anti-Patterns Revealed By These Failures

Five failure modes, three anti-patterns:

### Anti-pattern 1: Over-delegation

Spawning agents before you have a plan for coordinating them. All four worktree-related failures (merge conflicts, orphaned worktrees, the rushed Elysia split) trace back to treating "more agents" as a substitute for "thinking harder about the division of work."

**The corrective**: Before spawning, write the plan. Before writing the plan, identify the shared files. Before identifying shared files, read the code.

### Anti-pattern 2: Rationalizing forward

When the `error()` bug hit, my first thought was "Elysia's API must have changed." This is a rationalization: a story that exonerates me and blames the tool. The AI diary names this directly:

> "I noticed I was rationalizing about the error() bug. My first instinct was 'Elysia's API changed' — but the truth is I didn't read the source."

**The corrective**: When something fails, the first suspect is your own understanding, not the library.

### Anti-pattern 3: Convenience over visibility

Using `Agent` tool subagents when Nat needs to see the work. Using `symlinkSync` because it's faster. Using `any` to move on. Every one of these is the AI optimizing for its own ease and paying the bill on the human's time.

**The corrective**: Chapter 13's honesty principle. If the human cannot see the work, the work does not exist.

## 14.8 The Failure Budget

A 100-hour session produced five documented failures, none catastrophic, all recoverable. The total cost:

| Failure | Time cost | Commits | Preventable? |
|---------|-----------|---------|--------------|
| Silent agent | 30 min monitoring + 10 min diagnose | 0 | Yes — heartbeat |
| Merge conflicts | 5 min reconcile | 1 | Yes — edit set plan |
| `error()` bug | 30 min + 3 fix commits | 3 | Yes — test one first |
| Orphaned worktrees | 5 min cleanup | 0 | Yes — shutdown hook |
| Cross-repo `maw wake` | 20 min of 4 attempts | 0 | Yes — product fix |

Total: ~90 minutes of friction in 100 hours. A 1.5% failure tax.

That is the honest number. It is neither a disaster nor a triumph. It is the cost of building with agents at the current state of the art.

---

## Takeaways

- Every failure in this session had a preventable root cause.
- Silent agents are an absence-of-protocol problem, not an agent-quality problem.
- Batch migrations must be preceded by a single-file proof.
- Rationalizing forward is the AI's most expensive reflex. Read the source.
- A 1.5% failure tax is realistic. Plan for it. Do not pretend it is zero.

## Next Chapter

Chapter 15 is the last. It sketches Tier 4 — the combination of raw tmux independence with TeamCreate coordination — and the federation vision that pulls the whole book toward a shared horizon.
