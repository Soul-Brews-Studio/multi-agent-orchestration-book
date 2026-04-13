---
sidebar_position: 1
title: "Introduction"
slug: /intro
---

# Multi-Agent Orchestration: A Practitioner's Guide

**Subtitle**: From Subagents to Federation — Real Patterns from 100 Hours of Building

---

## About This Book

This is not a theoretical treatise on multi-agent systems. It is a field guide written from a 100+ hour session where we used three distinct tiers of agent orchestration to ship a production-grade software system. Every pattern in this book has code that shipped. Every failure has a git commit. Every success has metrics.

**You will not find**:
- Speculative architectures
- Toy examples
- "Hello world" demonstrations
- Copy-paste prompts divorced from real problems

**You will find**:
- The exact prompts we used, with the code they produced
- War stories with timestamps and root causes
- Cost models derived from actual token counts
- Failure modes documented with their fixes
- Three production-tested patterns for spawning agents

---

## The Source

This book is built on **maw-js**, a multi-agent workflow framework written in Bun + TypeScript. During one session (April 2026, session 4833f831, ~100 hours), maw-js evolved from v1.15.0 to v2.0.0-alpha.2. That evolution included:

- Full Hono → Elysia framework migration (21 API files, 76 routes)
- TypeBox validation across all endpoints
- 17-plugin command catalog (maw-commands repository)
- WASM plugin architecture (inspired by The Graph's graph-node)
- Federation protocol across 4 nodes (oracle-world, white, clinic-nat, mba)
- 35 new tests, 3 deep-learn explorations (Elysia 123K docs, graph-node 126K docs)

The code is open source. Every file path and commit hash in this book is real and reproducible.

---

## Table of Contents

### Part I: Foundations
1. [Why One Agent Isn't Enough](ch01-why-one-agent-isnt-enough)
2. [The Three Tiers](ch02-the-three-tiers)
3. [The Message Bus](ch03-the-message-bus)
4. [Task Tracking](ch04-task-tracking)

### Part II: Patterns
5. [The Research Swarm](ch05-the-research-swarm)
6. [The Architecture Debate](ch06-the-architecture-debate)
7. [The Implementation Team](ch07-the-implementation-team)
8. [The Federation Agent](ch08-the-federation-agent)
9. [The Cron Loop](ch09-the-cron-loop)

### Part III: Infrastructure
10. [The Plugin Architecture](ch10-the-plugin-architecture)
11. [WASM Plugin Runtime](ch11-wasm-plugin-runtime)
12. [Framework Migration With Agents](ch12-framework-migration-with-agents)

### Part IV: The Human Factor
13. [What the Human Sees](ch13-what-the-human-sees)
14. [Failure Modes](ch14-failure-modes)
15. [The Future — Tier 4](ch15-the-future-tier-4)

### Appendices
- [A: Command Reference](appendix-a-command-reference)
- [B: Spawn Pattern Cheatsheet](appendix-b-spawn-pattern-cheatsheet)
- [C: Cost Analysis](appendix-c-cost-analysis)
- [D: Plugin Catalog](appendix-d-plugin-catalog)

---

## How To Read This Book

**Linear readers**: Parts I → II → III → IV in order. Each part builds on the previous.

**Pattern seekers**: Jump to Part II (Chapters 5-9) for the five core orchestration patterns.

**Implementers**: Part III (Chapters 10-12) for the infrastructure decisions that make patterns work.

**Skeptics**: Chapter 14 (Failure Modes) first. Then decide if the rest is worth your time.

**Reference users**: Appendices A-D are standalone, indexable by task.

---

## The Thesis

> Convenience is for the AI. Visibility is for the human. The best system serves both.

Most multi-agent work tooling optimizes for the AI — easy to spawn, cheap to coordinate, invisible to the human. This produces impressive demos and unshippable systems. The humans who must review, debug, and extend this code need to see the agents. They need to `peek` at them. They need to kill them. They need to understand what decisions the agents made and why.

The three tiers in this book — in-process subagents, coordinated teams, independent processes — are presented in order of increasing human visibility. They are also in order of increasing operational complexity. Most tasks need the first tier. A few need the third. Knowing which is which is the core skill this book teaches.

---

## License + Attribution

Written by: the maw-js team (Nat Weerawan + mawjs oracle)  
Session: 4833f831 (Soul-Brews-Studio/mawjs-oracle)  
Based on code: Soul-Brews-Studio/maw-js v2.0.0-alpha.2

All code examples are from public repositories. All session data is from the mawjs-oracle vault at `ψ/memory/`.
