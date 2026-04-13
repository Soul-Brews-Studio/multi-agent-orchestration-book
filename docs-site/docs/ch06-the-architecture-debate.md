---
sidebar_position: 7
title: "Chapter 6: The Architecture Debate"
---

# Chapter 6: The Architecture Debate

> "One agent rationalizes. Two agents disagree. Three agents decide."

---

## 6.1 The Problem With a Single Expert

A single Opus agent, asked to pick between architectures, will pick one. It will justify the pick. The justification will be internally consistent. It will also be biased, because a single agent cannot hold two opposing views simultaneously with equal commitment — it will favor whichever view it generated first and spend the rest of the turn defending it.

This is not a hallucination. It is rationalization, and it is the single most expensive failure mode in high-stakes design decisions. A research swarm will not catch it, because research is descriptive. You need a pattern that is explicitly adversarial.

The **architecture debate** is three Opus agents playing assigned roles:

- **The Advocate** — argues for option A with the strongest case available.
- **The Counter-Advocate** — argues for option B, also with the strongest case.
- **The Architect** — reads both arguments and makes the decision.

The trick is that the Advocate and the Counter-Advocate do not know about each other while they argue. They each produce the best version of their assigned side. The Architect sees both, cold, and is the only one with the whole picture. Decisions made this way survive later scrutiny because the objections have already been aired.

## 6.2 Why Opus, and Why Three

Two design choices to justify.

**Opus, not Haiku.** Research is cheap. Argument is not. Opus produces denser, better-structured reasoning — which matters here because the Architect will weigh the arguments. A weak argument loses not because its position is wrong but because it was poorly defended. Haiku cannot reliably make the strongest case for a position; Opus can. Pay the tokens.

**Three, not two.** Two agents produce a stalemate and hand the decision back to you. Three produce a decision — the Architect is an explicit role, not a tiebreaker. Four would be wasteful; five would be a committee. Three is the smallest complete shape: one voice per side, plus a judge.

The pattern is structurally similar to a court. The Advocate is counsel for the plaintiff, the Counter-Advocate is counsel for the defense, the Architect is the judge. No defendant — code doesn't have rights.

## 6.3 The Canonical Pattern

```ts
// Wave 1 — adversarial, in parallel, blind to each other.
Agent({
  subagent_type: "Plan",
  description: "Advocate: SDK-everywhere",
  prompt: `Argue for expanding maw SDK to wrap every API endpoint.
    Write the strongest case for this position. Ignore counter-arguments;
    the counter-advocate will make them. Under 600 words.
    Required: (1) developer ergonomics story, (2) type-safety story,
    (3) one concrete code example, (4) migration cost estimate.`,
})
Agent({
  subagent_type: "Plan",
  description: "Counter: hybrid maw.fetch<T>()",
  prompt: `Argue for NOT expanding the SDK. Propose a single typed helper:
    maw.fetch<T>(path, opts) that plugins parameterize themselves.
    Same structure, same length, same rigor.`,
})

// Wave 2 — synthesis. Runs AFTER both advocates return.
Agent({
  subagent_type: "Plan",
  description: "Architect: decide",
  prompt: `Read both position papers below. Decide. State the decision
    in one sentence. Then list the three strongest reasons. Then list
    the top two risks of the losing option you are deliberately accepting.
    ---
    ADVOCATE: <paste>
    ---
    COUNTER: <paste>`,
})
```

Note the two-wave structure. The first wave is parallel and adversarial. The second wave is sequential and synthetic. You do not spawn the Architect until both arguments have landed — the whole point is that the Architect sees both.

The Advocate and Counter-Advocate prompts are deliberately symmetric: same length bound, same required sections, same "ignore counter-arguments" instruction. Asymmetric prompts bias the outcome. If you ask Advocate for 800 words and Counter for 400, the Architect will almost always pick Advocate on sheer density.

## 6.4 Case Study: The `maw.fetch<T>()` Debate

At 10:10 on 2026-04-13, the plugin sprint had produced a mess. Seventeen plugins, each making HTTP calls to the maw-js API differently — raw `fetch()`, typed wrapper, ad-hoc axios, in one case a handwritten curl invocation. The question: what is the official way a plugin talks to the server?

Three obvious candidates:

- **SDK-everywhere**: Expand `maw` SDK to wrap every endpoint. `maw.peers.list()`, `maw.inbox.read()`, `maw.wake.status()`. Fully typed, autocomplete everywhere.
- **Direct fetch**: Stop pretending. Plugins use `fetch()` against `http://localhost:3000/api/*`. Document the URL schema.
- **Hybrid `maw.fetch<T>()`**: Add a single typed helper to the SDK. Plugins do `const peers = await maw.fetch<Peer[]>("/api/peers")`. No per-endpoint wrappers; full type safety at the call site.

The tempting default was SDK-everywhere. It is what "good" looks like from a distance. The subtle risk was SDK bloat: seventeen plugins today, forty tomorrow, and the SDK becomes a catalog of every API surface that ever existed — versioned, deprecated, re-exported.

We ran the debate with three Opus agents. The session retrospective captures the verdict plainly:

> "3-agent debate — Opus team: SDK-everywhere vs direct-fetch vs hybrid → architect chose `maw.fetch<T>()`"
> — `ψ/memory/retrospectives/2026-04/13/12.03_elysia-migration-plugin-ecosystem.md`

The Architect's reasoning, condensed to one paragraph: SDK-everywhere optimizes for new-plugin-author ergonomics (one person, once) at the cost of SDK maintenance burden (one maintainer, forever). `maw.fetch<T>()` inverts that trade — slightly worse ergonomics at authoring time (you spell out the path string) in exchange for permanent freedom from SDK churn when endpoints change. The plugins "own their interfaces." The SDK "owns the wire."

**Metrics from that decision**:

| Measurement | Value |
|-------------|-------|
| Agents | 3 Opus |
| Wall time for debate | ~5 minutes |
| Plugins migrated post-decision | 6 immediately, 17 by session end |
| `any` types in plugin code | 0 |
| Lines added to the SDK | 1 method |
| Lines that would have been added under SDK-everywhere | ~200 (estimated from 17 plugins × 20 endpoints × signature overhead) |

The decision was not reversed for the rest of the session. It is still the rule.

## 6.5 Case Study: The Elysia Migration Triad

Five minutes after the `maw.fetch<T>()` debate resolved, a second debate launched — this one with different roles. The question was not "A vs B" but "can we do this at all, and if so, how?" Three Opus agents, three distinct analytical lenses:

1. **The Typing Analyst** — "map every type flowing through the existing Hono codebase. Where is it `any`? Where is it validated? Where does the wire format diverge from the declared type?"
2. **The Hono Auditor** — "inventory every use of Hono primitives that do not have a clean Elysia analog. Identify migration blockers."
3. **The Migration Architect** — "given the above two reports, design a phased migration plan that ships working code at every phase boundary."

This variant of the pattern is not adversarial; it is **orthogonal**. The three agents are not arguing — they are looking at the same elephant from three angles and handing their observations to the Architect role. The Architect then writes the plan.

The output was the 3-phase migration plan (schemas → DI → framework swap) that shipped later the same day: 21 API files migrated, 76 routes validated, epic #305 closed with 9 linked issues. The plan was drafted in roughly ten minutes. It survived contact with reality almost entirely intact — the one deviation was the `error()` bug in Chapter 14, which no amount of planning would have caught because it required running the code.

## 6.6 Advocate / Counter / Architect vs Orthogonal / Orthogonal / Architect

Both variants use three agents. Both terminate in a synthesis role. The difference is the relationship between the first two agents.

| Variant | When to use | First two roles | Architect job |
|---------|-------------|-----------------|---------------|
| Advocate / Counter | Picking between explicit options | Adversarial — strongest case each | Decide, name the loser's risk |
| Orthogonal triad | Designing something new | Independent lenses on same system | Synthesize into a plan |

If you catch yourself running the orthogonal triad when the real question is a binary pick, you will get mush instead of a decision. If you catch yourself running advocate/counter when the question is really "design me a system," you will get two polished but unrelated proposals. Choose the variant to match the question.

## 6.7 The Failure Mode: Over-Debating

The architecture debate costs roughly 3-6× what a single Opus consultation costs, and it is slower because of the two-wave structure. Do not run it for small decisions. A good rule:

> If the decision is reversible within an hour, skip the debate.
> If the decision will outlive the session, run the debate.

`maw.fetch<T>()` passed this test — it set the convention for every plugin, present and future. A variable name does not pass this test. A function signature does not. The architecture of a subsystem does.

A secondary failure mode is the **ghost debate**: running the pattern with agents that are not actually positioned to disagree. If both Advocate and Counter-Advocate are reading the same prior context with the same assumptions, they will converge. To prevent this, prompt each agent to defend its side *regardless of personal conviction* and explicitly forbid it from "steelmanning the other side" — that is the Architect's job, not theirs.

## 6.8 The Meta-Lesson

The debate pattern works because it separates advocacy from judgment. A single agent must do both in one turn, and rationalization is the predictable consequence. Three agents, each doing one job, each unaware of the others until the Architect reads the record, produce decisions that survive review.

You are not simulating democracy. You are simulating a trial. The goal is not consensus. The goal is that the losing side was steelmanned before it lost.

---

## Takeaways

- The architecture debate is three Opus agents: Advocate, Counter-Advocate, Architect.
- Run Advocate and Counter in parallel, blind to each other. Run Architect sequentially, after both.
- Opus, not Haiku — argument density matters more than reading speed.
- Use the orthogonal triad variant when the question is "design," not "pick."
- The decision bar: run the pattern only for commitments that outlive the session.
- `maw.fetch<T>()` beat SDK-everywhere because the Architect saw both cases; no single agent could have steelmanned the losing side fairly.

## Next Chapter

Chapter 7 moves from deciding to building. Once the architecture is chosen, you need to ship it — often across many files, with isolation so agents do not collide. The pattern is the implementation team: TeamCreate, named roles, worktree isolation, and the single hardest rule in multi-agent systems: only the lead writes.
