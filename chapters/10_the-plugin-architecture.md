# Chapter 10: The Plugin Architecture

> "The first plugin took an hour. The seventeenth took eleven minutes. That delta is the architecture, not the agent."

---

## 10.1 The Plugin That Lied

The first community plugin we shipped — `hello` — looked like this:

```js
// ~/.oracle/commands/hello.js (v0)
const { execSync } = require("child_process");

module.exports = async function(args) {
  const raw = execSync("curl -s http://localhost:3456/api/identity").toString();
  const id = JSON.parse(raw);
  console.log(`hello from ${id.node}`);
};
```

It worked. It also lied about three things: the port (it was hardcoded), the response shape (it assumed `id.node` existed), and the failure mode (`execSync` throws synchronously, killing the whole CLI on a single missed request). The second plugin author copied the first. The third copied the second. By plugin five, we had five different ways of misreading the federation status payload.

This is the well-known plugin pathology: every plugin reinvents transport, types, and error handling, badly. The maw-js project hit it at plugin three. The fix shipped in `b9785c8` and has shaped every line of plugin code since: a typed SDK, a single source of truth for schemas, and a `maw.fetch<T>()` escape hatch that keeps the SDK small without forcing plugins back to `curl`.

This chapter is the architectural backbone. It is also the prerequisite for the WASM runtime in Chapter 11 — the host functions exposed to WebAssembly plugins are simply the SDK in C-ABI clothing.

---

## 10.2 One Schema, Two Worlds

The single most consequential file in maw-js's plugin story is `src/lib/schemas.ts`. It is 134 lines. It is written once and consumed in three places: HTTP request validation, HTTP response inference, and SDK type exports.

```ts
// maw-js/src/lib/schemas.ts:18-25
export const Identity = Type.Object({
  node: Type.String(),
  version: Type.String(),
  agents: Type.Array(Type.String()),
  clockUtc: Type.String(),
  uptime: Type.Number(),
});
export type TIdentity = Static<typeof Identity>;
```

The `Type.Object()` call is **TypeBox**, a runtime-validating schema library where every schema is itself a JSON Schema document and `Static<typeof X>` extracts a TypeScript type at compile time. One declaration produces:

1. A JSON Schema (`Identity` — usable for OpenAPI, validation, fuzzing).
2. A TypeScript type (`TIdentity` — usable for inference everywhere).
3. An Elysia validator (`body: Identity` in route handlers — see `src/api/sessions.ts:148`).

Before TypeBox, maw-js had two definitions for `Identity`: a Zod schema for request validation and a hand-written `interface` for response typing. They drifted within a week. `agents` became `Agent[]` in one place and `string[]` in the other. The first plugin author who used SDK types and the first plugin author who parsed the raw HTTP response shipped incompatible code.

The TypeBox migration was Phase 1 of the much larger Hono → Elysia migration we cover in Chapter 12. It came first deliberately. The schema was the *interface contract*. Everything else — the HTTP framework, the SDK, the WASM bridge — bent itself to that contract.

---

## 10.3 The SDK as a Public Façade

`src/sdk.ts` is the file every plugin imports:

```ts
// maw-js/src/sdk.ts:25-32
export type Identity = Static<typeof IdentitySchema>;
export type Peer = Static<typeof PeerSchema>;
export type FederationStatus = Static<typeof FederationStatusSchema>;
export type Session = Static<typeof SessionSchema>;
export type FeedEvent = Static<typeof FeedEventSchema>;
export type PluginInfo = Static<typeof PluginInfoSchema>;
```

Every type the SDK exports is `Static<typeof Schema>`. There are no hand-written interfaces. There cannot be. If a plugin author wants the response shape of `/api/identity`, they get the same shape that Elysia uses to validate the response, that the WASM bridge uses to serialize for Rust plugins, and that the OpenAPI document at `/api/docs` advertises to the world.

The SDK has three layers, exposed under one namespace:

```ts
// maw-js/src/sdk.ts:195-209
export const maw = {
  identity,        // GET /api/identity → Identity
  federation,      // GET /api/federation/status → FederationStatus
  sessions,        // GET /api/sessions → Session[]
  feed,            // GET /api/feed → FeedEvent[]
  plugins,         // GET /api/plugins → { plugins, totalEvents, totalErrors }
  config,          // GET /api/config → Record<string, unknown>
  wake,            // POST /api/wake → { ok }
  sleep,           // POST /api/sleep → { ok }
  send,            // POST /api/send → { ok }
  print,           // colored terminal helpers (no I/O)
  baseUrl,         // resolves config.port → http://localhost:3456
  fetch: typedFetch,  // escape hatch
};
```

Every function returns a typed promise. Every function has a fallback for unreachable servers (`identity()` returns `{ node: "unknown", ... }` instead of throwing). The print helpers — `maw.print.ok()`, `maw.print.kv()`, `maw.print.table()` — are pure local functions; they never hit the network. Plugins use them so all CLI output looks consistent regardless of which plugin produced it.

The plugin author does not need to know that `loadConfig()` looks at `~/.oracle/config.json`. They do not need to know the server runs on port 3456 by default. They write:

```ts
import { maw } from "maw/sdk";
const id = await maw.identity();
maw.print.ok(`hello from ${id.node}`);
```

And it works.

---

## 10.4 The maw.fetch<T>() Debate

The first version of the SDK exposed *only* the wrapped methods. Plugin three asked: "How do I call `/api/avengers`? It's not in the SDK." The naive answer is: add it to the SDK. The honest answer is: every plugin will need a different endpoint, the SDK will grow without bound, and we'll be back to maintaining a hand-written interface for every payload.

We ran the architecture-debate pattern from Chapter 6. Three Opus agents argued three positions:

- **SDK-everywhere**: every endpoint gets a typed wrapper. Maximum safety, exponential maintenance.
- **Raw fetch + cast**: plugins do `await fetch(...).then(r => r.json() as T)`. Maximum flexibility, zero safety.
- **Hybrid (winner)**: SDK wraps the *common* endpoints; an escape hatch with explicit typing covers the rest.

The debate transcript is in `ψ/memory/debates/2026-04-08-sdk-shape.md`. The winning argument was operational: a hand-curated SDK forces the maintainer (us) to ratify which endpoints are "stable" public API. Adding a method to `maw.*` is a contract. An escape hatch is opt-out from that contract, which is the right default for plugins poking at experimental routes.

Here is the escape hatch. Forty-five lines. The typed version takes a generic and *throws on failure* — the opposite of the wrapped methods, which swallow errors:

```ts
// maw-js/src/sdk.ts:53-61
async function typedFetch<T>(path: string, init?: RequestInit & { timeout?: number }): Promise<T> {
  const { timeout = 5000, ...rest } = init || {};
  const res = await fetch(`${baseUrl()}${path}`, { signal: AbortSignal.timeout(timeout), ...rest });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ""}`);
  }
  return await res.json() as T;
}
```

Plugin authors who call `maw.fetch<T>()` are signalling, in code: *I am calling an endpoint not blessed by the SDK. I have read the response shape myself. I will handle the throw.* Reviewers grep for `maw.fetch<` to find the unstable surface area. Eight of the seventeen shipped plugins use it; the other nine touch only the wrapped methods.

The pattern matters more than the function. The SDK does not pretend to cover the full API. It pretends to cover the part that *doesn't change*. For everything else, you opt into instability with a generic parameter the type checker forces you to name.

---

## 10.5 The Plugin Registry

Plugins are loaded by `src/cli/command-registry.ts` from `~/.oracle/commands/`. The contract for a TypeScript plugin is six lines:

```ts
// example: ~/.oracle/commands/hello.ts
export const command = {
  name: "hello",
  description: "Say hello, federated.",
};
export default async function(args: string[]) {
  const { maw } = await import("maw/sdk");
  const id = await maw.identity();
  maw.print.ok(`hello from ${id.node} (${id.agents.length} agents)`);
}
```

The registry's job is small: scan the directory, import the module, validate `command.name`, and store the descriptor. Subcommand routing is by longest-prefix match — `fleet doctor` beats `fleet` if both are registered:

```ts
// maw-js/src/cli/command-registry.ts:62-78
export function matchCommand(args: string[]): { desc; remaining; key } | null {
  let best = null;
  for (const [key, entry] of commands) {
    const parts = key.split(/\s+/);
    let match = true;
    for (let i = 0; i < parts.length; i++) {
      if (!args[i] || args[i].toLowerCase() !== parts[i]) { match = false; break; }
    }
    if (match && parts.length > (best?.len ?? 0)) {
      best = { desc: entry.desc, remaining: args.slice(parts.length), key, len: parts.length };
    }
  }
  return best;
}
```

The registry has no opinions about plugin behaviour. It does not sandbox TypeScript plugins (they run in the same Bun process; they have full filesystem and network access). The sandboxing story belongs to WASM plugins — Chapter 11. The TS plugin contract is "we trust you, but we make it ergonomic to do the right thing."

That ergonomic pull is the entire point of the SDK. A plugin author *can* do `execSync("curl ...")`. They almost never do, because `import { maw } from "maw/sdk"` is shorter, typed, and produces output that matches every other maw command.

---

## 10.6 Case Study: 17 Plugins, Zero `any`

The maw-commands repository (`Soul-Brews-Studio/maw-commands`) shipped 17 plugins between commits `7a4e1c2` and `f0d3b9a`, mostly via the cron loop pattern from Chapter 9. After the SDK landed, every plugin built since plugin four has the same shape:

```ts
import { maw } from "maw/sdk";

export const command = {
  name: "fleet doctor",
  description: "Diagnose federation health.",
};

export default async function(args: string[], flags: Record<string, unknown>) {
  const fed = await maw.federation();
  const broken = fed.peers.filter(p => !p.reachable);
  if (broken.length === 0) {
    maw.print.ok(`all ${fed.totalPeers} peers reachable`);
    return;
  }
  maw.print.warn(`${broken.length}/${fed.totalPeers} peers unreachable`);
  maw.print.list(broken.map(p => `${p.node ?? p.url} (${p.url})`));
}
```

We grepped the catalog at the end of the session:

| Metric | Count |
|--------|-------|
| Plugins in catalog | 17 |
| Plugins importing `maw/sdk` | 17 |
| Plugins using `execSync("curl …")` | 0 |
| Plugins with `: any` annotations | 0 |
| Plugins using `maw.fetch<T>()` | 8 |
| Plugins using only wrapped methods | 9 |
| Median plugin LOC | 41 |
| Largest plugin LOC | 187 (`fleet weather` — talks to 4 endpoints) |

The interesting number is the *median*. Forty-one lines of TypeScript is the size of a plugin that actually does something useful. Most of those forty-one lines are `maw.print.*` calls — which is to say, most of a plugin is the output formatting, because the SDK has erased the rest.

The first plugin took an hour to write — most of it spent re-deriving how the federation endpoint structures its response. The seventeenth took eleven minutes. The architecture is not the agents; it is the boring, single-source-of-truth schema that makes every plugin author's first guess at the shape correct.

---

## 10.7 What the Architecture Buys at Runtime

The plugin system has three loaders, all driven by the same registry:

1. **Builtin TypeScript** — files in `src/cli/` registered at startup.
2. **User TypeScript** — files in `~/.oracle/commands/`, loaded with dynamic `import()`.
3. **WASM** — `.wasm` files in either directory, loaded via `loadWasmCommand()`.

The user-TypeScript path is straightforward `import()`. The WASM path is the subject of the next chapter. What both paths share is the SDK contract: the WASM bridge in `src/cli/wasm-bridge.ts:21` literally imports the same `maw` object that TypeScript plugins use, and re-exposes its methods through C-ABI host functions.

```ts
// maw-js/src/cli/wasm-bridge.ts:21
import { maw } from "../sdk";

// ... later, the maw_send host function:
maw_send(tPtr: number, tLen: number, mPtr: number, mLen: number): number {
  const target = readString(getMemory(), tPtr, tLen);
  const text = readString(getMemory(), mPtr, mLen);
  maw.send(target, text).catch(...);
  return 1;
},
```

There is no second SDK for WASM. There is one SDK, and a thin C-ABI translation layer. This is the payoff of starting with schemas: the boundary between TypeScript plugin and WASM plugin disappears, because both are calling `maw.send()` underneath — one through a `Promise`, one through a function pointer.

---

## Takeaways

- **One schema, three consumers.** TypeBox lets the same definition validate HTTP requests, infer TypeScript types, and document the API. The alternative — separate request validators and response interfaces — drifts within a week.
- **The SDK is a curated façade, not a complete mirror.** Wrap the stable endpoints. Provide a typed escape hatch for the rest. The escape hatch's existence is what lets the wrapped surface stay small.
- **Make the right thing the easy thing.** TypeScript plugins are not sandboxed. They could `execSync` whatever they want. They don't, because `import { maw } from "maw/sdk"` is fewer characters and more correct.
- **Defer the loader question.** The registry knows nothing about plugin behaviour — it dispatches by longest-prefix match and gets out of the way. WASM plugins, command-aware plugins, hot-reload plugins: all add to the registry without modifying it.

## Next Chapter

Chapter 11 takes the same SDK and reaches it across a sandbox boundary. We adopt graph-node's host-function pattern, build a memory protocol that survives the JS/Rust ABI gap, and ship a Rust plugin SDK on top. The `hello-rust` example compiles to 81.6KB of WASM, prints federation status, and cannot — by construction — read a file outside its own linear memory. The contract from this chapter does not change. The transport does.
