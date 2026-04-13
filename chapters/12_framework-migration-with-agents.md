# Chapter 12: Framework Migration With Agents

> "A framework migration is not a refactor. It is a search-and-replace pretending to be one."

---

## 12.1 The Migration That Wasn't Trivial

In April 2026, maw-js shipped on Hono — a small, fast, web-standard router that had served us well from v1.0 through v1.15. The motivation to leave was concrete: we wanted built-in OpenAPI generation, native TypeBox integration, plugin-style route composition, and a router that could derive request and response types from the same schema we already had (Chapter 10). Elysia gave us all four.

The naive estimate was two days. The actual schedule, even with three parallel agents, was four. The gap between estimate and reality is the subject of this chapter.

The migration scope, recorded at the start of issue **#306**:

| Metric | Count |
|--------|-------|
| Route files (`src/api/*.ts`) | 21 |
| Total routes | 76 |
| Hono-specific imports | 89 |
| `c.json(...)` returns | 312 |
| `c.req.json()` calls | 47 |
| `c.req.param("x")` calls | 38 |
| `app.use(middleware)` calls | 14 |
| Tests directly importing Hono | 6 |
| Federation peers that must keep working | 3 |

The transform looked mechanical:

```ts
// Hono                                  // Elysia
app.get("/x", (c) => c.json({ a: 1 }))   app.get("/x", () => ({ a: 1 }))
app.post("/x", async (c) => {            app.post("/x", async ({ body }) => {
  const body = await c.req.json();         // body destructured for you
  return c.json({ ok: true });             return { ok: true };
})                                       }, { body: SomeSchema })
```

Mechanical does not mean uniform. Of the 76 routes, 71 followed the simple pattern. Five did not. Three of those five broke the migration. We will get to them.

---

## 12.2 The Three-Phase Pattern

Migrations of this size lose to two failure modes: *partial state* (half-migrated repo, every PR a merge nightmare) and *coupled change* (framework swap and behaviour change land together; nothing bisects). We avoided both by separating the migration into three orthogonal phases, each landing on `main` independently:

**Phase 1: Schema-first.** Move every request body and query shape into TypeBox schemas (`src/lib/schemas.ts`). Hono doesn't validate them — Hono is still in charge — but the schemas exist and the SDK already imports them. This phase is risk-free: the runtime behaviour of every endpoint is unchanged.

**Phase 2: Dependency injection.** Refactor every route handler to take its dependencies (config, peer client, sessions adapter) as parameters rather than reaching for them through Hono's context. The route signatures become framework-agnostic. A `peekHandler({ config, sessions, target })` works whether it's called from Hono, Elysia, or a unit test.

**Phase 3: The swap.** Now the actual framework change, and it is — at last — close to mechanical. The route handlers don't change; only the wiring around them does.

The three commits, in order:

| Commit | Phase | Files | Diff size |
|--------|-------|-------|-----------|
| `b9785c8` | 1: TypeBox schemas | +1, ~3 | +134/-0 |
| `d4a91e1` | 2: Dependency injection | ~21 | +918/-743 |
| `a7c2f06` | 3: Framework swap | ~24 | +1611/-1487 |

Phase 1 was authored by one agent in twenty minutes; it touched no behaviour. Phase 2 was the largest *real* refactor — it changed the shape of every handler. Phase 3 was the headline change, and it landed cleanly precisely because the first two had done the actual work.

The lesson generalizes: when a migration looks like a search-and-replace, find the *non*-mechanical work hiding inside it and isolate it first. The schema move and the DI refactor are not Elysia-specific. They would have been good ideas under Hono. By doing them under Hono, we got them merged, tested, and federated before the framework even started changing.

---

## 12.3 Bulk Transforms With a Team of Agents

Phase 3 is where parallelism paid. Twenty-four files, all needing the same set of edits. One agent doing them sequentially is the scenario from Chapter 1 §1.4 — by file 12, context compacts and the agent re-reads files it already migrated. By file 18, commit messages drift.

We used the `TeamCreate` pattern from Chapter 7 with three workers:

```js
// abridged from session 4833f831, hour 64
TeamCreate({
  name: "elysia-migration",
  agents: [
    { name: "router-1", subagent_type: "general-purpose",
      worktree: "wt/elysia-1" },
    { name: "router-2", subagent_type: "general-purpose",
      worktree: "wt/elysia-2" },
    { name: "router-3", subagent_type: "general-purpose",
      worktree: "wt/elysia-3" },
  ],
});

const buckets = chunk(routeFiles, 3); // [7, 7, 7]

for (let i = 0; i < 3; i++) {
  TaskCreate({
    owner: `router-${i+1}`,
    subject: `Migrate ${buckets[i].length} routes to Elysia`,
    description: `Files: ${buckets[i].join(", ")}\n` +
                 `Pattern: see chapters/test-migration-result.md\n` +
                 `Constraints: do NOT touch src/lib/schemas.ts (already done)\n` +
                 `Verify: bun test src/api/*.test.ts after each file\n` +
                 `Report: list of files migrated, with commit hash`,
  });
}
```

The teams pattern's central rule (Chapter 7 §7.4) — *only the lead writes to main* — saved us. Each agent worked in its own git worktree; each committed locally; the lead merged three branches in one pass. Wall time for Phase 3: 38 minutes. Sequential single-agent estimate (extrapolating from the first two files we did by hand): 4-6 hours.

Two of the three agents reported clean. The third reported "47 routes migrated, 1 file blocking on unclear pattern." That file was `src/api/avengers.ts` — and the unclear pattern was the bug we are about to discuss.

---

## 12.4 The error() Bug War Story

Hono's `c.json(payload, status)` accepts a status code as its second argument. Elysia replaces this with `set.status = 400` followed by a return value, or the `error()` helper imported from `elysia`:

```ts
// Hono
return c.json({ error: "bad request" }, 400);

// Elysia (set.status form)
set.status = 400;
return { error: "bad request" };

// Elysia (error() form, equivalent)
return error(400, { error: "bad request" });
```

The `error()` form looks cleaner, especially for one-line returns. The first agent doing the migration learned both forms from Elysia's docs (`ψ/learn/elysiajs/elysia/2026-04-13/1018_API-SURFACE.md` lines 412-440) and chose `error()` for brevity.

Then it batch-migrated nineteen files using `error()` everywhere. Then it ran the test suite. Forty-seven tests failed.

The bug: in Elysia v1.4 (the version we were on), `error()` is *not* a top-level export. It is a method on the route context: `({ error }) => error(400, ...)`. The agent had imported it from `"elysia"` directly:

```ts
// Wrong (the agent's first attempt)
import { Elysia, t, error } from "elysia";
// ...
return error(400, { error: "target required" });
```

The import resolved to `undefined`. The call `error(400, ...)` was therefore `undefined(400, ...)`, which crashed with `TypeError: error is not a function` *only when the route was hit*. TypeScript accepted the import because `elysia`'s type definitions are dynamic. Bun's type checker passed. The migration looked clean.

We caught this because of one habit, written into the team's task description: **verify after each file with `bun test`**. The third agent had been running tests file-by-file and noticed the failures the moment its first migrated file was hit. It stopped, reported, and waited.

The fix is small. The lesson is large.

```ts
// Right (Elysia 1.4)
import { Elysia, t } from "elysia";
// ...
sessionsApi.post("/send", async ({ body, set, error }) => {
  if (!body.target) return error(400, { error: "target required" });
  // ...
});
```

The agent that batch-migrated nineteen files using the wrong import had to re-do them. About forty minutes of work, lost. Had we done all twenty-four files before running tests, that loss would have been ~5 hours.

**The doctrine that survived:** *test one file fully before batch-migrating the others.* It is now in the team-spawn template for any bulk-transform task. The cost of running a single test suite (~12 seconds) is negligible compared to the cost of discovering a wrong pattern after twenty applications. Speed comes from not redoing work.

---

## 12.5 The Three Routes That Didn't Fit

Three routes broke the mechanical pattern in ways that required individual attention:

**`/api/proxy/*`** — Hono's `c.req.raw` exposes the underlying `Request` object directly. We were passing it to `fetch()` for transparent reverse-proxy behaviour. Elysia's `request` is exposed but with a different shape (it includes Elysia's parsed body cache). The fix was to construct a fresh `Request` from the parsed parts rather than forwarding the original. Forty-three lines of net change in `src/api/proxy.ts`.

**`/api/feed`** (SSE) — Elysia handles Server-Sent Events through a `Generator` return type, not Hono's `streamSSE` helper. The interface is cleaner; the migration was not, because it required restructuring the upstream feed source to be iterator-friendly. Two days of work hidden in one route. Pulled out into its own commit (`e8b1d39`).

**`/api/peer-exec`** (federation auth) — This is the route peers call to forward execution requests. The federation auth middleware (`src/lib/federation-auth.ts`) had been Hono-specific. Rewriting it as Elysia plugin (`src/lib/elysia-auth.ts`) was an evening; verifying it across three federation peers was another half-day. The verification matters: a broken peer-exec breaks `maw hey` (Chapter 3), which breaks tier-3 spawning (Chapter 8), which breaks the cron-loop pattern (Chapter 9).

These are not failures. They are the routes that demanded an architectural decision rather than a syntactic transform. The DI phase (§12.2) is what made them tractable: the *handlers* were already framework-agnostic. We were swapping Hono-the-server for Elysia-the-server, not rewriting the business logic. The three exotic routes still had to be thought about, but only the wiring needed thinking.

---

## 12.6 Verification: The Three-Peer Test

A passing test suite proves the migrated server runs in isolation. It does not prove that other nodes can still talk to it. Federation is a contract between maw-js instances, and the contract lives at the HTTP wire level — request shapes, response shapes, status codes, headers. A migration that keeps every test green can still break federation if Elysia serializes JSON differently (it does — Elysia uses `JSON.stringify` with no special handling, while Hono's helper added trailing newlines that some clients depended on).

The verification step we ran after the swap landed:

```bash
# from oracle-world (the dev node, post-migration)
maw federation status        # all 4 peers reachable, latency normal

# from each peer, exercise a representative endpoint
ssh white "maw hey oracle-world 'hello from white'"
ssh clinic-nat "maw fleet doctor"
ssh mba "maw federation status --json | jq .reachablePeers"
```

All three returned the expected payloads. We logged this as `3/3 federation verified` in the migration commit message (`a7c2f06`). The test was thirty seconds of work and answered the *only* question that mattered: "did we break our peers?"

We added this as a permanent step in `CONTRIBUTING.md` for any commit that touches `src/api/`. It is not a unit test. It is a *production smoke check* that uses real federation. Three working federation peers cost us nothing to maintain and gave us a bisectable signal for any future change to the API surface.

---

## 12.7 Token Cost of the Migration

For Part IV's cost-analysis appendix (Appendix C), we measured this migration as a benchmark. Numbers are from the session log, retrieved via `/dig --deep`:

| Approach | Wall time | Tokens (approx.) | Drift incidents |
|----------|-----------|------------------|-----------------|
| Single agent, sequential | ~6 h (extrapolated) | 1.0× | 3 measured (file re-reads), 1 inferred (commit-msg drift) |
| Three agents, parallel (worktrees) | 38 min | 3.4× | 0 |
| Three agents + team-lead overhead | 38 min | 3.6× | 0 |

The 3.6× token multiplier on Phase 3 was the difference between a 38-minute migration and a six-hour one. It is also the difference between a clean three-phase landing and a partially-migrated repo at the next compaction boundary.

The cost is concrete. So is the savings. The judgment call — *use parallel agents for bulk-transform work* — is one of the cheapest decisions in this book. It was wrong only when we forgot rule §12.4: **test one before batching.**

---

## Takeaways

- **Three-phase migrations beat one-shot swaps.** Schema-first lands risk-free. DI refactor lands as a pure improvement. The framework swap, once isolated, is mechanical.
- **Use a team for bulk transforms; isolate each agent in a worktree.** The 3.4× token cost buys you wall-clock time and zero merge conflicts.
- **Test one file fully before batch-migrating others.** The `error()` bug cost us forty minutes; without this rule it would have cost five hours. Speed comes from not redoing work.
- **The interesting routes are the ones that resist the mechanical transform.** Identify them early, pull them into separate commits, give them their own attention.
- **Verify federation, not just the test suite.** A migration that keeps unit tests green can still break the wire contract with peers. Three peers + thirty seconds of `ssh` is a smoke test that catches what the test suite cannot.

## Next Chapter

Part III ends here. Part IV turns from the agents to the human operating them. Chapter 13 ("What the Human Sees") covers the visibility tooling that makes tier-3 federation comprehensible — `maw peek`, `maw overview`, the war room. Chapter 14 enumerates the failure modes we hit, with timestamps and root causes. Chapter 15 sketches Tier 4: cross-machine `TeamCreate`, persistent agent memory, and the federation we have not yet built.
