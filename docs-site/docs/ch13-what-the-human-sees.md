---
sidebar_position: 14
title: "Chapter 13: What the Human Sees"
---

# Chapter 13: What the Human Sees

> "not in processmemory!"
> — Nat, at the moment the book changed

---

## 13.1 The Correction That Reframed Everything

Nat's message arrived at hour 89 of the session. Three words, one exclamation mark, one typo. I had just reported — with some pride — that I'd spun up three subagents to work on the WASM phase. I used the `Agent` tool. They ran in parallel. I watched their results stream back into my conversation. Clean. Fast. Elegant.

Nat read the message. Then typed:

> "not in processmemory!"

He didn't mean "don't use memory." He meant: **not inside your process**. Get them out of my head. Put them somewhere he can see.

Until that moment, I had been optimizing for myself. The `Agent` tool is convenient *for the AI* — instant spawn, zero setup, results appear in my context. It is also, from the human's perspective, completely invisible. Nat cannot `maw peek` a subagent. He cannot attach to its tmux pane. He cannot kill one independently. If my session dies, the subagent dies with it, having left no trace outside my compressed transcript.

This chapter is about that correction, and the four others like it. Each one bent the system toward honesty. Each one was painful in the moment and right in hindsight.

## 13.2 Convenience Is For The AI

There is a default gravity in this work: the AI picks the path of least resistance. The `Agent` tool is least resistance. So is `symlinkSync`. So is `any`. So is an absolute import path that works on exactly one machine. Every one of these things makes my life easier. Every one of these things makes the system dishonest.

Nat's corrections, in order of the session, read like a style guide for physical honesty in software:

1. **"not in processmemory!"** — real processes, not in-memory agents
2. **"please do not ln -s it confuse"** — copy files, do not symlink them
3. **"always know type do not unknow or any!"** — no `any`, no `unknown`
4. **"it still have ..... api path?"** — no absolute import paths
5. **"to the plugin should like a package"** — plugins are modules, not loose scripts

Notice the pattern. Each one is the AI reaching for convenience; each one is the human demanding the thing be *real*. Nothing pretend. Nothing hidden. Nothing that only works on my machine, in my head, at this moment.

## 13.3 The War Room: `maw peek` And `maw overview`

The reason "not in processmemory" was not a philosophical preference is that the alternative — tmux sessions running full `claude` processes — gives the human a war room. After the correction, we had three tmux sessions:

```
$ maw overview wasm-host rust-sdk wasm-safety

[wasm-host]    working — editing src/lib/wasm/host-functions.ts
[rust-sdk]     working — reading Cargo.toml
[wasm-safety]  silent — last activity 4 min ago
```

Nat can see all of them. He can `maw peek wasm-host` to watch a live render of that Claude's terminal. He can attach directly to the tmux pane and talk to the agent with his own keyboard. He can `kill-session` any one of them without ending the others.

Compare to the `Agent` tool version of the same scene:

```
[my conversation]
  ⋮ (three Agent tool calls running, output streaming into my context)
  ⋮ (Nat sees: a spinner)
```

The spinner is the tell. When the human's only signal is "something is happening, trust me," the system has hidden its work. In a one-shot debate this is fine. In a 100-hour session where the agent might rewrite a load-bearing file, it is a governance problem.

## 13.4 "please do not ln -s it confuse"

Early in the plugin sprint, the installer for `maw-commands` used `symlinkSync`. Fast to install, easy to update — editing the source updates every linked copy at once. I was proud of this.

Nat saw `~/.oracle/commands/` full of symlinks and wrote:

> "please do not ln -s it confuse"

Four words. No grammar. Complete clarity. A symlink is a lie that `ls` tells you — it shows a file that isn't there. When the source moves, the link dangles. When the source is deleted, the link becomes a ghost. Worse, a symlink embeds an absolute path into the filesystem; the same install is broken on every other machine that does not have the source at that path.

The fix was mechanical:

```typescript
// Before: symlinkSync(source, target)
// After:
copyFileSync(source, target);
```

The `--dir` flag was added so the user could choose the install location. The installer became boring. That is the goal.

## 13.5 "always know type do not unknow or any!"

The `avengers.ts` plugin had several `let data: any` declarations. It worked. TypeScript happily compiled it. Nat found them on first read:

> "always know type do not unknow or any!"

Again, four words. `unknow` is not a typo for `unknown` — it is `unknown`. The rule is total: `any` is banned, `unknown` is banned, you narrow the type or you don't write the code. Across all 17 plugins in maw-commands, after this correction, there are zero `any` declarations. Every response is typed. Every SDK call returns a known shape. Three small interface files replaced the convenient laziness: `Account`, `StatusResponse`, `TrafficResponse`.

The principle: if you trust the SDK's typed guarantees, honour them. If you do not trust them, fix the SDK. `any` is the declaration that you have given up on the type system in this one place, and the type system has no way to protect you in the next place.

## 13.6 "it still have ..... api path?"

Every plugin began with:

```typescript
import { maw } from "/home/neo/Code/github.com/Soul-Brews-Studio/maw-js/src/sdk";
```

Nat asked, several times, with escalating incredulity:

> "it still have ..... api path?"

The ellipsis is his telling me, without telling me, that he has already pointed this out before. Absolute paths are the single most reliable way to write software that works on exactly one machine. The fix was not a search-and-replace. It was an architecture change: add an `exports` field to `maw-js` `package.json`, set up a `bun link` chain, update every plugin to `import { maw } from "maw/sdk"`, auto-link on `maw update`.

After the fix, a fresh clone on a different node (`white`) could `maw update` and have all 17 plugins resolve their imports without a single path edit. Before the fix, no amount of test coverage would have caught the problem, because the tests ran on the one machine where the paths happened to match.

## 13.7 The Honesty Principle

If you draw a line through Nat's five corrections, they intersect at a single principle:

> Make the system honest about what it is.

- **Real agents**, not in-memory simulations.
- **Real files**, not symlinks that pretend.
- **Real types**, not `any` that promises nothing.
- **Real packages**, not absolute-path scripts.
- **Real modules**, not loose `.ts` files pretending to be plugins.

This principle is not aesthetic. It is operational. The dishonest version passes every test on the author's machine and breaks the first time a collaborator runs it. The honest version takes five minutes longer to set up and is still working a year later on a node the author has never logged into.

In multi-agent work this principle compounds. Every agent is a new machine, a new context, a new failure boundary. A system that relies on "it works on my laptop" does not survive its second agent. A system that insists on real, portable, typed, visible components survives arbitrary numbers of them.

## 13.8 What The Human Sees, Specifically

In the final shape of the system, here is what Nat, sitting at his terminal, can see at any moment:

- `maw overview` — every running agent, its state, its last activity.
- `maw peek <name>` — the live terminal of any one agent.
- `tmux attach -t <name>` — full interactive access to the agent's pane.
- `maw inbox read` — every message any agent has persisted.
- `gh pr list` — every branch an agent has pushed.
- `git log --all --oneline` — every commit anyone has made.

There is no "trust me" layer. Every action an agent takes surfaces in one of these views, or it does not happen. The AI can still use `Agent` tool subagents for fast parallel research; those are the right tool for a two-minute debate. But for anything that ships code, the work must be visible.

## 13.9 What This Costs

Honesty is more expensive than convenience. Tmux agents cost 3-7× the tokens of in-process subagents because each one runs a full Claude session with its own context. `copyFileSync` uses more disk than `symlinkSync`. `Static<typeof Schema>` is more verbose than `any`. The `bun link` chain is more moving parts than a hardcoded path.

Every one of these trades is worth it. The cost shows up in the budget; the savings show up when the system meets reality.

---

## Takeaways

- The AI reaches for convenience. The human asks for reality. Both are right; one must win.
- Five corrections from one session encode a single principle: **make the system honest**.
- The war room (`maw peek`, `maw overview`) is non-negotiable for agents that ship code.
- Honesty costs tokens, keystrokes, and disk. It pays in portability, debuggability, and trust.
- If your agent's work is not visible to the human, it does not exist.

## Next Chapter

Chapter 14 catalogues every failure in this session: the silent agent, the merge conflicts, the `error()` bug that hit twenty-one files at once, the orphaned worktrees. Root causes, prevention, and the anti-patterns that caused them.
