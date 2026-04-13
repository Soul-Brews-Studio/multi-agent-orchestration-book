# Chapter 5: The Research Swarm

> "Reading is embarrassingly parallel. You are just the scheduler."

---

## 5.1 The Shape of the Problem

Before you write code, you read. Before you read, you need to know where to look. In a novel codebase — or in a dependency you have never used — the ratio of reading-to-writing is easily 10:1. For a human that ratio is painful. For a single agent it is crippling, because every file you read costs context you could have spent on the problem you were actually trying to solve.

The **research swarm** is the first pattern in this book, and the one you will reach for most often. Three to five small agents, each with a narrow question, all reading in parallel, each returning a compressed summary that fits in a single tool-result turn. The lead agent — you — never reads the raw files. You read the compressed reports.

This is Tier 1 from Chapter 2: the `Agent` tool, in-process, fanning out with a single message containing multiple tool-use blocks.

## 5.2 The Canonical Pattern

```ts
// Pseudocode — what you actually write is a single assistant message
// containing N Agent tool-use blocks, executed concurrently.

Agent({ subagent_type: "Explore", description: "API surface",
        prompt: "Map every public export of elysiajs/elysia..." })
Agent({ subagent_type: "Explore", description: "Routing internals",
        prompt: "How does Elysia dispatch requests..." })
Agent({ subagent_type: "Explore", description: "Validation path",
        prompt: "Trace how TypeBox schemas become runtime validators..." })
Agent({ subagent_type: "Explore", description: "Plugin model",
        prompt: "How do Elysia plugins compose via .use()..." })
Agent({ subagent_type: "Explore", description: "Testing patterns",
        prompt: "How is Elysia tested end-to-end with eden..." })
```

Five agents. One message. They run concurrently and return concurrently. The lead gets five reports, not five file trees.

The rules of the pattern:

1. **One question per agent.** If a prompt contains the word "and," split it.
2. **Haiku unless you need Opus.** Reading is cheap. Reasoning is expensive. Haiku reads faster and costs ~5× less.
3. **Ask for a report, not a dump.** "Return under 400 words, with file paths and line numbers for citations" is the prompt discipline.
4. **Write to disk, then summarize.** If the report matters beyond the session, tell the agent to write it to `ψ/learn/<topic>/<date>/` AND return a summary. The summary fits in context; the on-disk artifact outlives the session.

## 5.3 Case Study: `/learn --deep` on Elysia

At 10:25 on 2026-04-13, the session pivoted from "the plugin sprint is done" to "we are migrating Hono to Elysia." We knew almost nothing about Elysia. We had the framework name and a tutorial page. We needed an operational understanding in the next ten minutes — otherwise the migration plan that was about to be drafted would be built on vibes.

The `/learn --deep` skill is, mechanically, a research swarm. Five Haiku agents spawned from a cloned copy of `elysiajs/elysia`, each with a distinct reading brief:

| Agent | Brief | Output file |
|-------|-------|-------------|
| 1 | Map the public API surface — every export, every type | `1018_API-SURFACE.md` (30.0K) |
| 2 | Document the architecture — request lifecycle, plugin composition | `1018_ARCHITECTURE.md` (24.8K) |
| 3 | Extract canonical code snippets for every major feature | `1018_CODE-SNIPPETS.md` (29.0K) |
| 4 | Condense a one-page quick reference | `1018_QUICK-REFERENCE.md` (16.1K) |
| 5 | Map the testing patterns, Eden treaty, end-to-end idioms | `1018_TESTING.md` (23.7K) |

**Total output**: ~123K of structured markdown. **Wall time**: under two minutes. **Tokens consumed in the lead agent's context**: the five short summaries — a few thousand tokens. The 123K sat on disk, available to `grep` or re-read on demand but not clogging the context window.

This is the economic argument for the pattern in one data point. A single sequential reader would have taken forty minutes minimum, consumed its entire context on source-file quotes, and produced a worse report because it would have compacted mid-read. Five parallel Haiku agents produced a better artifact in 3% of the wall-clock time for roughly 5× the token spend — and those tokens were spent in isolated windows, not the lead's.

## 5.4 Case Study: `/trace --deep`

Where `/learn` reads external source, `/trace` reads your own history. Same pattern, different corpus. The question on 2026-04-13 was "what do we know about agent spawning from tmux — commands, friction, disagreements?" The answer was not in one file. It was sprawled across git log, GitHub issues, Oracle memory, and retrospectives.

Four Haiku agents, four corpora:

```ts
Agent({ description: "Files sweep",
        prompt: "Search ψ/memory, ψ/learn, CLAUDE.md for 'tmux' + 'spawn' + 'maw wake'. Cite file:line." })
Agent({ description: "Git archaeology",
        prompt: "git log --all --grep='tmux|wake|spawn' in maw-js. Return commits + messages + dates." })
Agent({ description: "GitHub mining",
        prompt: "gh issue list + gh pr list, filter for tmux/WASM/agent-spawn. Return numbers + titles + state." })
Agent({ description: "Retrospective scan",
        prompt: "Read every ψ/memory/retrospectives/*.md from the last 30 days. Extract tmux-spawn mentions." })
```

The four reports landed in the lead's context almost simultaneously. The lead's job was synthesis: spot the through-line across all four, discard noise, and write a single blog post (`1200_blog-spawning-tmux-agents.md`, 191 lines). The "four attempts" narrative in that blog did not come from any one report — it came from triangulating commit messages (git agent) against issue comments (GitHub agent) against the retrospective's "friction points" section (retrospective agent).

No agent had the whole story. The lead did, because the pattern is explicitly designed to assemble wholes from fragments.

## 5.5 Wave Execution: Surface First, Deep Only If Needed

The seductive failure mode of the research swarm is over-subscribing. Five agents is cheap; fifteen is not. If you spawn fifteen agents when three would do, you pay 5× the tokens and wait for the slowest of fifteen instead of the slowest of three.

The discipline is **wave execution**:

- **Wave 1 (always)**: 3-5 agents with broad, surface-level briefs. "Map the landscape."
- **Wave 2 (only if Wave 1 surfaces a specific unknown)**: 1-3 agents with narrow, deep briefs targeting exactly the gap you discovered.

On the Elysia migration, Wave 1 was the five-agent `/learn --deep`. Wave 2 did not exist — the five summaries gave us enough to draft the migration plan. Two hours later, when the `error()` bug appeared (Chapter 14), we spawned a Wave 2 of a single agent with the brief "find every reference to `error` as an export in elysiajs/elysia v1.4.28." It returned: none. That one agent, scoped tightly, saved us further trial-and-error.

Contrast this with the anti-pattern: spawning twenty agents up front "to be thorough." Ten of them return redundant information, five return noise, three return gold. You spent 20× the tokens to get the same gold that three well-scoped agents would have delivered. Breadth without a plan is just waste.

## 5.6 Report Contracts

The single highest-leverage habit in the research swarm is specifying the report contract in the prompt. Compare:

```
// Weak
"Look into how Elysia handles validation."

// Strong
"Explain Elysia's validation pipeline in under 400 words.
Required sections: (1) schema declaration, (2) request parsing,
(3) error shape on failure. Cite file:line for every claim.
If a behavior is version-dependent, state the version explicitly."
```

The weak prompt returns prose. The strong prompt returns a document. When five agents all return documents with the same section headers, the lead's synthesis step reduces from "read and interpret" to "concatenate and dedupe." That is the difference between a pattern that scales to a book chapter and one that collapses into a blob.

The contract has three parts:

1. **Length bound** — "under 400 words," "three paragraphs," "one table." Bounds force compression.
2. **Structure** — section headers, required fields, output format.
3. **Citation discipline** — file paths and line numbers for every factual claim. No citations, no claim.

## 5.7 When the Swarm Is the Wrong Tool

The research swarm is for reading. It is not for writing. Two anti-uses recur:

- **"Have five agents draft five versions and I'll pick one."** This is not research; it is a vote. It produces five mediocre drafts rather than one considered one. The right pattern for generative work is the architecture debate (Chapter 6).
- **"Have five agents edit five files in parallel."** This is not research; it is implementation. Without coordination and worktree isolation you will merge-conflict yourself into a corner. The right pattern is the implementation team (Chapter 7).

The research swarm is read-only. That constraint is its power. Read-only agents cannot step on each other.

---

## Takeaways

- The research swarm is 3-5 parallel Haiku agents, each with one narrow question, each returning a bounded report.
- Measure by wall-clock and context-consumed, not token count. Tokens spent in sub-agent windows do not compact the lead's window.
- Write long outputs to disk; return only summaries to the lead. The disk outlives the session.
- Enforce a report contract: length, structure, citations. Contracts turn synthesis into concatenation.
- Execute in waves. Wave 1 surfaces the unknowns. Wave 2 resolves them. Do not spawn Wave 2 speculatively.
- Keep the swarm read-only. Writing belongs to other patterns.

## Next Chapter

Chapter 6 flips the polarity. Instead of many cheap agents reading in parallel, we spawn three expensive agents to argue. The pattern is called the architecture debate, and it is how the `maw.fetch<T>()` design won against two better-advertised alternatives.
