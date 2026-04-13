---
sidebar_position: 20
title: "Appendix D: Plugin Catalog"
---

# Appendix D: Plugin Catalog

Every plugin in the maw-commands catalog as of v2.0.0-alpha.2. All plugins use `import { maw } from "maw/sdk"` — no absolute paths. All are typed — zero `any`. All installed via `copyFileSync`, never symlinks.

**Source repo**: `Soul-Brews-Studio/maw-commands`
**Install path**: `~/.oracle/commands/` (or `--dir` override)
**Count**: 17 plugins + 1 installer (`plugin.ts`)

---

## D.1 Plugin Manager

### `plugin.ts`
**Purpose**: The installer itself. Bootstraps the catalog.
**Path**: `maw-commands/plugin.ts`
**Key capabilities**:
- `maw plugin install <name>` — copy plugin from catalog.
- `maw plugin install <name> --dir <path>` — custom install path.
- `maw plugin list` — show installed.
- `maw plugin remove <name>` — uninstall.
- Uses `copyFileSync` (never `symlinkSync`).
- Reads from catalog repo or local path.

---

## D.2 Health And Observability

### `doctor.ts`
**Purpose**: System health check.
**Path**: `maw-commands/doctor.ts`
**What it reports**: SDK link status, federation peer reachability, plugin catalog sync state, node version, maw-js version, disk space.

### `feed.ts`
**Purpose**: Recent activity feed across the federation.
**Path**: `maw-commands/feed.ts`
**What it shows**: Recent commits, inbox messages, agent completions, peer status changes, in reverse chronological order.

### `logs.ts`
**Purpose**: Tail and filter the maw-js server log.
**Path**: `maw-commands/logs.ts`
**Key capabilities**: Deduplicates repeated entries, groups by source, highlights errors, supports `--since` filtering.

### `status.ts`
**Purpose**: One-line system status.
**Path**: `maw-commands/status.ts`
**Output format**: `<version> | peers: N/M | agents: X running | last: <timestamp>`.

### `who.ts`
**Purpose**: Identity check — show the current oracle's name, node, and key facts.
**Path**: `maw-commands/who.ts`

---

## D.3 Agent And Session Management

### `avengers.ts`
**Purpose**: War-room view of running agents.
**Path**: `maw-commands/avengers.ts`
**Type work**: Defines `Account`, `StatusResponse`, `TrafficResponse` interfaces (zero `any` after Nat's correction).

### `worktrees.ts`
**Purpose**: List and prune git worktrees.
**Path**: `maw-commands/worktrees.ts`
**Fixes**: Orphaned worktrees from terminated agents (Chapter 14.5).

### `triggers.ts`
**Purpose**: Manage scheduled agents (CronCreate targets).
**Path**: `maw-commands/triggers.ts`
**Key capabilities**: List, create, delete, fire-now for scheduled agents.

### `morning.ts`
**Purpose**: Morning standup automation — combined feed, agent status, and overnight summary.
**Path**: `maw-commands/morning.ts`
**Common workflow**: Run at start of day; shows what happened overnight.

---

## D.4 Federation And Peers

### `peers.ts`
**Purpose**: List known federation peers and their reachability.
**Path**: `maw-commands/peers.ts`
**Covers**: The 4-node federation (oracle-world, white, clinic-nat, mba).

### `ping.ts`
**Purpose**: Ping a specific peer.
**Path**: `maw-commands/ping.ts`
**Output**: Round-trip time, reachability, reported version.

### `transport.ts`
**Purpose**: Show how a given oracle is reachable — maw hey, inbox, thread, or absent.
**Path**: `maw-commands/transport.ts`
**Used by**: Contacts system to pick the right transport when sending a message.

---

## D.5 Cost And Usage

### `costs.ts`
**Purpose**: Token and API cost summary.
**Path**: `maw-commands/costs.ts`
**Output**: Per-model cost, per-session totals, top spenders, trend.

---

## D.6 Interactive And Utility

### `dashboard.ts`
**Purpose**: Compact multi-panel dashboard for a single terminal view.
**Path**: `maw-commands/dashboard.ts`
**Panels**: Status, feed, agents, peers, costs.

### `quick.ts`
**Purpose**: Frequently-used shortcuts (common `maw hey`, common inbox writes).
**Path**: `maw-commands/quick.ts`

### `hello.ts`
**Purpose**: Reference implementation — the minimal plugin.
**Path**: `maw-commands/hello.ts`
**Size**: 391 bytes. Used as the template for new plugins.

---

## D.7 Plugin Contract

Every plugin must export:

```typescript
import { maw } from "maw/sdk";

export const command = {
  name: "hello",
  description: "Greet someone",
};

export default async function (args: string[]) {
  // Plugin body. Receives argv[2..]. Uses maw.fetch<T>() for API calls.
  console.log("hello");
}
```

Requirements (Nat-enforced):

1. **Import from `"maw/sdk"`** — never an absolute path.
2. **No `any`, no `unknown`** — every response shape is declared.
3. **Uses `maw.fetch<T>()`** — no direct `fetch` against the maw API.
4. **Exports `command.name` and `command.description`** — registered in the CLI.
5. **Default export is the handler** — async, takes `string[]`.

---

## D.8 WASM Plugin Variant (Epic #316)

The WASM plugin architecture (Chapter 11) extends this catalog to non-TypeScript plugins:

- Compiled WASM module (~80KB typical, 16MB cap).
- Host functions: `maw_print`, `maw_identity`, `maw_send`, `maw_fetch`.
- 5-second invocation timeout.
- Gas metering (planned in #319).

Reference WASM plugin:

- `hello-world` Rust crate — compiles to 81.6KB WASM, prints via `maw_print`.

WASM plugins are not yet in the catalog as of v2.0.0-alpha.2. The scaffolding ships; bulk migration is a future epic.

---

## D.9 Source And Commits

All 17 plugins landed across 15 commits in `Soul-Brews-Studio/maw-commands` during session 4833f831. The commit range in the retrospective:

> 17 plugin files (doctor, feed, costs, logs, transport, avengers, worktrees, triggers, morning, ping, status, who, peers, dashboard, quick, hello, plugin)
> All migrated to `import { maw } from "maw/sdk"`
> plugin.ts rewritten: copy not symlink, --dir flag, catalog support

The ordering in which they were built (from the session timeline):

1. `doctor`, `feed` — first two, cron-loop seed.
2. `costs`, `logs`, `transport`, `avengers`, `worktrees`, `triggers`, `morning`, `ping` — catalog sprint.
3. `plugin` rewrite — copy not symlink.
4. `status`, `who`, `peers`, `dashboard`, `quick`, `hello` — filled out during SDK refactor.

Full history: `git log --oneline` in the maw-commands repo.

---

## D.10 How To Add A Plugin

```bash
cd maw-commands
cp hello.ts mynewcmd.ts
# Edit: name, description, body. Use maw.fetch<T>() with typed T.
bun test
git add mynewcmd.ts
git commit -m "add mynewcmd plugin"
git push

# On any node:
maw update
maw plugin install mynewcmd
```

The installer copies the file (no symlinks), registers the command, and makes it available as `maw mynewcmd`.

---

## Summary Table

| Plugin | Category | Purpose |
|--------|----------|---------|
| `plugin` | Manager | Install/remove/list other plugins |
| `doctor` | Health | System health check |
| `feed` | Health | Recent activity feed |
| `logs` | Health | Tail maw-js logs |
| `status` | Health | One-line status |
| `who` | Health | Identity |
| `avengers` | Agents | War-room agent view |
| `worktrees` | Agents | Worktree hygiene |
| `triggers` | Agents | Scheduled agents |
| `morning` | Agents | Morning standup |
| `peers` | Federation | Peer list |
| `ping` | Federation | Peer reachability |
| `transport` | Federation | How-to-reach-X |
| `costs` | Cost | Token/API spend |
| `dashboard` | UX | Multi-panel view |
| `quick` | UX | Shortcuts |
| `hello` | Reference | Minimal plugin template |
