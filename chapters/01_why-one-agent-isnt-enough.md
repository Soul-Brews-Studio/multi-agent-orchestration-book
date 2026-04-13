# Chapter 1: Why One Agent Isn't Enough

> "The context window is not infinite. Neither is your patience. Neither is the clock."

---

## 1.1 The Moment You Know

There is a moment, usually around hour fifteen of a long coding session, when you realize a single agent cannot finish the task. The context window has compressed three times. The agent has forgotten which files it already modified. It asks you to "read the existing implementation" of code it wrote two hours ago. You read the git log and discover the agent is, in fact, the author.

This happened to us at hour 57 of session 4833f831. The task was the Hono → Elysia migration. 21 files. 76 routes. Every file mechanically transformable: `c.json(data)` → `return data`, `c.req.json()` → destructured `body`. The transform was trivial. The scope was not.

At hour 57, the agent had migrated 6 files. It was "still thinking about sessions.ts" — a file it had already migrated at hour 48. The earlier migration had been compressed out of context. The agent was rewriting its own work, differently each time, introducing subtle inconsistencies.

One agent was not going to finish this.

## 1.2 The Math of Context

Claude Code's context window is 200K tokens. A typical TypeScript file is 1-3K tokens. A session log with tool calls, outputs, and reasoning easily hits 2K tokens per turn. At 100 turns, you've burned 200K just on operational overhead — the code itself has not yet been read.

Claude has a mechanism called **compaction**: when the window approaches full, earlier turns are summarized into a shorter form. This preserves the gist of what happened but loses the details. The specific commit hash is gone. The exact line numbers are gone. The reason why we chose approach A over approach B is reduced to "we chose approach A."

For a 2-hour session, compaction is imperceptible. For a 100-hour session, it is a cognitive hemorrhage.

**Session 4833f831 metrics** (via `/dig --deep`):
- Duration: ~100 hours active
- Compactions: 3 (measured by gaps in retrievable detail)
- Unique file edits: 127
- Commits: 65 (50 maw-js + 15 maw-commands)
- Turns: ~2,400

At hour 57, the agent had genuinely forgotten which files it had modified two hours earlier. Not a hallucination — an architectural limit.

## 1.3 The "Forgot What I Built" Problem

This is the pattern:

1. Hour 1: Agent designs a system, writes schemas.ts, commits it. Commit `b9785c8`.
2. Hour 20: Context compacts. Schemas.ts summary reduced to "added TypeBox schemas."
3. Hour 30: Another agent (or the same agent post-compaction) asks "where should we define types?"
4. Hour 30: Agent proposes creating `src/lib/types.ts` — unaware schemas.ts exists.
5. Hour 31: Human catches it, points to the existing file, prevents duplication.

The agent did not lie. It did not hallucinate. It faithfully reported what it could see, which was a summary that omitted the critical detail.

**The fix is structural, not prompt-engineering.** You cannot prompt the agent to "remember" something outside its context window. You must either:

1. **Persist externally** — write to disk, commit to git, `/rrr` after each phase
2. **Parallelize** — give each agent a smaller scope so the window isn't the bottleneck
3. **Hand off** — end the session, start fresh with a minimal handoff document

This book is about option 2.

## 1.4 The 76 Routes Problem

maw-js had 76 API routes across 21 files when the migration began. The transform pattern was uniform. One agent could do each file in about 30 seconds. Sequential execution: 21 × 30s = 10.5 minutes of actual work, plus reading, plus testing, plus commit messages. Call it 45 minutes under ideal conditions.

But conditions are never ideal. At file 8, the agent hits an unexpected error (the `error()` import bug, which we will discuss at length in Chapter 14). It spends 15 minutes diagnosing. By file 12, context compacts; the agent re-reads files it already migrated. By file 18, the commit messages become inconsistent because the agent has lost track of its own conventions.

**Parallel execution** — three agents in worktrees, each handling 7 files — completed the same work in 4 minutes with zero context drift. Each agent worked on isolated files. Each committed its batch. The lead merged three branches and ran tests.

The math:

| Approach | Agents | Wall time | Token cost | Drift risk |
|----------|--------|-----------|------------|------------|
| Sequential | 1 | 45+ min | 1× | High |
| Parallel worktree | 3 | 4 min | ~3.5× | Low |
| Parallel shared | 3 | 4 min | ~3.5× | Merge conflicts |

The token multiplier is real (3-7× per agent, depending on model and task). It is also the point. You are trading tokens for wall clock time and for context isolation. On a migration of 76 routes, that trade is obvious. On a one-line typo fix, it is absurd.

## 1.5 What This Book Teaches You To Decide

By the end of this book you will be able to look at a task and pick the right tier:

- **Tier 1 — Agent tool (in-process)**: Research, debates, quick parallel reads. Sub-5-minute tasks.
- **Tier 2 — TeamCreate**: Coordinated implementation. 3-5 agents. Structured reporting. Under 30 minutes.
- **Tier 3 — Raw tmux**: Long-running, cross-machine, survives session death. Hours to days.

Each tier has a token cost, a coordination cost, a visibility cost. Each tier solves a different problem. Most developers learning multi-agent systems reach for the wrong tier because they have not internalized the cost model.

This chapter was the why. Chapter 2 is the what. The rest is the how.

---

## Takeaways

- Context windows compress. At 100 hours, compression is catastrophic.
- One agent has a natural ceiling around "what fits in a warm context window."
- Parallelization trades tokens for wall time and context isolation.
- The 3-7× token multiplier is real; use it deliberately.
- The right question is not "can an agent do this?" but "how many agents, at what tier?"

## Next Chapter

Chapter 2 introduces the three tiers in detail: the Agent tool (arrows), TeamCreate (squads), and raw tmux (federation). We compare them side by side with working code and actual metrics from this session.
