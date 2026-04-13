# Appendix C: Cost Analysis

Token counts, time costs, and break-even points for each tier. All numbers are from session 4833f831 unless otherwise noted.

---

## C.1 Token Cost Per Tier

### Tier 1 — Agent tool

The subagent runs inside the parent process. Its tokens show up as tool results in the parent's context. Cost breakdown per agent:

| Component | Tokens (approx) |
|-----------|-----------------|
| Prompt sent to subagent | 500-2,000 |
| Subagent's internal reasoning | 5,000-30,000 |
| Tool calls made by subagent | 2,000-10,000 |
| Result returned to parent | 500-3,000 |

**Parent-visible cost**: prompt + result. ~1,500-5,000 tokens per agent.
**Total billed cost**: all four rows. ~8,000-45,000 tokens per agent.

Multiplier vs "the parent just did it": **3-7×**, depending on model (Haiku cheaper, Opus more expensive) and task depth.

### Tier 2 — TeamCreate + SendMessage

Same cost per agent as Tier 1 (the agents themselves are still in-process subagents). *Additional* overhead:

| Overhead | Tokens |
|----------|--------|
| `TeamCreate` setup | ~500 |
| `TaskCreate` per task | ~200 |
| `SendMessage` per report | ~300-1,000 |
| Shutdown protocol (×N teammates) | ~500 |

For a 3-teammate squad with 3 tasks and 6 messages, ceremonial overhead is ~5,000 tokens above the raw Tier 1 cost.

### Tier 3 — Raw tmux

Each tmux agent runs its own full Claude Code session. Its tokens are billed on that session's API key; they do *not* appear in the parent's context at all.

| Component | Tokens |
|-----------|--------|
| Initial prompt | 2,000-5,000 (bake reporting in) |
| Agent's own session tokens | 50,000-500,000 depending on depth |
| `maw hey` reports back to parent | ~50 per report |

**Parent-visible cost**: ~50 tokens per `maw hey` message. Negligible.
**Total fleet cost**: N separate full sessions, each independent.

Multiplier: **1×** relative to "just do it" — because each tmux agent is "just doing it" on a separate machine/session. But you are running N of them, so the aggregate cost is **N× a single session**.

---

## C.2 Wall-Clock Comparison (From Session)

From the three-tiers learning file (Chapter 2 / Appendix data):

| Task | Tier | Wall time | Note |
|------|------|-----------|------|
| `/learn --deep` Elysia | 1 (5 Haiku) | 2 min | 123K docs generated |
| 3-agent architecture debate | 1 (3 Opus) | ~3 min | forced explicit trade-offs |
| API migration batch (21 files) | 1 (3 worktree) | 4 min | vs 45+ min sequential |
| WASM hardening team | 2 (3 Sonnet) | 4 min | structured reports |
| WASM implementation (3 issues) | 3 (3 tmux) | ongoing | 2/3 reported; 1 silent |

The Tier 1 / Tier 2 distinction is small in wall time. The Tier 3 distinction is large — setup is slower, independence is the only reason to pay it.

---

## C.3 The 3-7× Multiplier, Unpacked

Why is a subagent 3-7× more expensive than "just doing it"?

1. **Context duplication.** The subagent needs enough context to do its work. That context is re-read and re-reasoned from scratch.
2. **Redundant tool calls.** A subagent re-reads files the parent may have already read. It re-runs `grep` the parent already ran.
3. **Internal deliberation.** Subagents often "think out loud" more than a parent would inline, because the parent has conversational context the subagent lacks.
4. **Result serialization.** The subagent has to write a summary coherent enough for the parent to consume. That summary is tokens on top of the work.

The multiplier is not wasted if the work was genuinely parallelizable. The multiplier is wasted if the same work could have been done inline.

### Heuristic

- If you can do the task in under 2 minutes inline, **don't spawn**.
- If the task is inherently parallel (5 files, 5 debates, 5 reads), **spawn**.
- If you need independent viewpoints (debate, review), **spawn**.
- If you need a result you will immediately synthesize, **spawn only if wall-clock savings exceed 5 minutes**.

---

## C.4 Break-Even Calculations

### Tier 1 break-even (vs sequential inline)

Let:
- `T_seq` = time to do all N subtasks sequentially inline
- `T_par` = time to do with N parallel subagents
- `C_seq` = 1× baseline tokens
- `C_par` = 3-7× tokens, split across the fleet (so each agent is `k × T_seq / N` tokens)

You break even on **tokens** never. You always pay more. You break even on **time**:

`T_par < T_seq` whenever tasks are genuinely parallelizable and overhead < savings.

Empirical break-even from this session: **~5 minutes of sequential work** is worth parallelizing. Below that, the spawn overhead eats the savings.

### Tier 2 break-even (vs Tier 1)

Tier 2 adds ~5,000 tokens of ceremony per team. Worth it when:

- You need named agents (SendMessage "tell safety-agent to...").
- You need task tracking (TaskList).
- You need graceful shutdown (shutdown_request protocol).
- Nat needs visibility (Tier 2 agents appear in tmux panes).

Rule of thumb: **use Tier 2 when the team will run > 5 minutes AND the lead will synthesize multi-agent results.**

### Tier 3 break-even (vs Tier 2)

Tier 3 adds ~60 seconds of spawn friction (and historically 4 attempts before the pattern works). The agent runs its own full session. Tokens for *that* session are effectively a new pay-per-use line item.

Worth it when:

- Work outlives the parent session (100h pressure).
- Work crosses machines (cross-node builds).
- Nat needs to directly attach and interact with the agent.
- You are running overnight / unattended.

Rule of thumb: **use Tier 3 when the work is expected to exceed 30 minutes OR must survive the parent session.**

---

## C.5 Session 4833f831 Aggregate Cost

Approximate totals for the 100-hour session:

| Tier | Invocations | Agents | Est. tokens |
|------|-------------|--------|-------------|
| 1 | ~20 | ~50 (5 Haiku × 2 deep learns, 3 Opus × debate, 3 Sonnet worktrees, etc.) | 2-5M |
| 2 | 1 | 3 | 200K |
| 3 | 1 | 3 | 3 separate sessions (unknown, isolated) |

The parent session itself consumed most of the visible tokens. Tier 1 subagents were the largest cost after that. Tier 2 was cheap. Tier 3 was billed separately.

---

## C.6 Cost Optimization Tips

1. **Prefer Haiku for research.** 5 Haiku agents doing `/learn --deep` produced 123K of docs in 2 minutes at a fraction of Opus cost.
2. **Use Opus sparingly — for debates.** Three Opus agents arguing a trade-off is worth the cost. Three Opus agents reading files is not.
3. **Use `isolation: "worktree"` for writes.** Avoids merge conflicts and allows clean parallel edits.
4. **Don't broadcast.** `SendMessage({to: "*", ...})` is O(N) in team size. Use named addresses.
5. **Bake reporting into Tier 3 prompts.** A silent agent wastes all its tokens.
6. **Kill early.** A tmux agent running for 3 hours on the wrong branch is 3 hours of wasted API spend.

---

## C.7 The Real Answer

After a 100-hour session and five failure modes, the honest cost statement is:

- **Tokens are the cheapest thing you're spending.** They don't matter in isolation.
- **Your attention is the expensive thing.** A failing agent costs minutes of your time, which is worth more than whatever tokens it burned.
- **Architecture debt is the most expensive thing.** A dishonest system (see Chapter 13) costs hours of debugging later.

Optimize for attention and honesty first. Tokens second.

---

## Summary Table

| Decision point | Tier | Typical token multiplier | Wall-clock savings |
|----------------|------|--------------------------|--------------------|
| 1 agent, inline work | — (no spawn) | 1× | baseline |
| 2-5 agents, < 5 min | 1 | 3-7× | 50-80% |
| 3-5 agents, coordinated, 5-30 min | 2 | 3-7× + ceremony | 60-90% |
| Long-running, independent, cross-machine | 3 | Separate sessions | Depends |
| All of the above (proposed) | 4 | Separate sessions | Depends |
