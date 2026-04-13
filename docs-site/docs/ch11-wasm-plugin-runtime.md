---
sidebar_position: 12
title: "Chapter 11: WASM Plugin Runtime"
---

# Chapter 11: WASM Plugin Runtime

> "WebAssembly is not a faster JavaScript. It is a smaller, meaner contract."

---

## 11.1 Why WASM at All

By plugin twelve we hit the inevitable question: *why is every plugin written in TypeScript?* Two community contributors wanted Rust. One wanted Go. One wanted "anything that doesn't need a 90MB Bun install." The TypeScript-only plugin path forced a runtime choice on every author and a trust assumption on every operator. A `~/.oracle/commands/foo.ts` file, once dropped, can read `~/.ssh/id_ed25519` as easily as it can call `maw.identity()`.

WebAssembly answers both. It is language-agnostic — Rust, Go, AssemblyScript, Zig, C, Swift all compile to it. And it is *capability-restricted by construction* — a `.wasm` module has access to its own linear memory and the host functions you explicitly inject. Nothing else. No file system. No network. No environment variables. No syscalls.

The maw-js WASM runtime did not invent any of this. We learned it from **graph-node**, The Graph Protocol's indexer, which has been running adversarial WASM "subgraphs" against blockchain data since 2018. Their patterns translate directly. The deep-learn from session 1144 (`ψ/learn/graphprotocol/graph-node/2026-04-13/`) catalogued sixty-plus host functions, the AscType serialization protocol, gas metering, and the trap-handling discipline that distinguishes "deterministic failure (skip and continue)" from "fatal error (kill the indexer)."

We adopted the four patterns that were load-bearing for a small system: host-function bridge, length-prefixed memory protocol, hard timeout, and a memory cap. Gas metering — graph-node's most distinctive feature — we explicitly deferred. We will return to that decision in §11.7.

---

## 11.2 The Memory Protocol

WebAssembly's MVP gives you exactly one shared substrate between host and guest: a contiguous block of bytes called *linear memory*. Strings, structs, arrays — anything bigger than an `i32` — must be encoded into bytes, written into linear memory, and addressed by `(pointer, length)`. There is no `String` type at the boundary. There is no `JSON.parse`. There is `Uint8Array` and discipline.

We chose a single, uniform encoding for every cross-boundary string in maw-js:

> **A "host string" is `[u32 LE length][UTF-8 bytes]` written into the WASM module's linear memory at a pointer returned by the module's exported allocator.**

That sentence is the whole protocol. It applies to every string the host returns to the guest — `maw_identity()` JSON, `maw_async_result()` HTTP body, future host functions yet unwritten. The TypeScript helper that writes one is twelve lines:

```ts
// maw-js/src/cli/wasm-bridge.ts:46-57
export function writeString(
  memory: WebAssembly.Memory,
  alloc: (size: number) => number,
  value: string,
): number {
  const bytes = textEncoder.encode(value);
  const ptr = alloc(4 + bytes.length);
  const view = new DataView(memory.buffer);
  view.setUint32(ptr, bytes.length, true);
  new Uint8Array(memory.buffer).set(bytes, ptr + 4);
  return ptr;
}
```

The Rust-side decoder is fifteen:

```rust
// maw-js/src/wasm/maw-plugin-sdk/src/lib.rs:74-89
fn read_host_string(ptr: *const u8) -> String {
    if ptr.is_null() { return String::new(); }
    unsafe {
        let len_bytes: [u8; 4] = [
            *ptr, *ptr.add(1), *ptr.add(2), *ptr.add(3),
        ];
        let len = u32::from_le_bytes(len_bytes) as usize;
        let data = core::slice::from_raw_parts(ptr.add(4), len);
        String::from_utf8_lossy(data).into_owned()
    }
}
```

The first version of the bridge used null-terminated C strings. We kept that path as a fallback in `command-registry.ts:184-188` for legacy modules, but every host function written since `c1f8e22` uses the length-prefixed form. The reason is brutal: null-terminated strings cannot contain JSON that contains the byte `0x00` (rare, but legal in escape sequences), and they require the host to scan for the terminator — an O(n) read where length-prefixed is O(1). We took the four extra bytes per call.

The protocol relies on one export the WASM module *must* provide: `maw_alloc(size: u32) -> u32`. The host calls it before writing return data. The maw-plugin-sdk Rust crate provides a default implementation that delegates to Rust's allocator:

```rust
// maw-js/src/wasm/maw-plugin-sdk/src/lib.rs:62-66
#[no_mangle]
pub extern "C" fn maw_alloc(size: usize) -> *mut u8 {
    let layout = Layout::from_size_align(size, 1).expect("bad layout");
    unsafe { alloc(layout) }
}
```

If the module forgets to export `maw_alloc`, the bridge falls back to a host-side bump allocator that grows the WASM memory directly:

```ts
// maw-js/src/cli/wasm-bridge.ts:159-172
maw_alloc(size: number): number {
  const mem = getMemory();
  const currentPages = mem.buffer.byteLength / 65_536;
  const needed = Math.ceil(size / 65_536);
  if (needed > 0) {
    if (currentPages + needed > maxPages) {
      throw new Error(
        `[wasm-safety] maw_alloc denied: ${currentPages + needed} pages would exceed ${maxPages}-page limit (${maxPages * 64}KB)`,
      );
    }
    mem.grow(needed);
  }
  return currentPages * 65_536;
}
```

This fallback also enforces the 16MB memory cap (256 × 64KB pages). A misbehaving plugin cannot grow itself out of bounds.

---

## 11.3 The Host-Function Bridge

Graph-node's `runtime/wasm/src/host_exports.rs` is 1,600 lines of host functions — `store.set`, `ethereum.call`, `crypto.keccak256`, and so on. The maw-js bridge is 196 lines and exposes nine. The reduction is intentional. Plugins do not need persistence (yet — see §11.7); they need to read federation state, send messages, fetch URLs, and print.

The bridge's central idea is the `importObject`. When the host instantiates a WASM module, it passes a JS object whose properties become callable functions inside the guest. We name our import namespace `env`, mimicking graph-node:

```ts
// maw-js/src/cli/wasm-bridge.ts:78-179 (condensed)
export function buildImportObject(
  getMemory: () => WebAssembly.Memory,
  getAlloc: () => (size: number) => number,
  opts?: { memoryMaxPages?: number },
) {
  let cachedIdentity: string | null = null;
  let cachedFederation: string | null = null;

  return {
    env: {
      maw_print(ptr, len) { process.stdout.write(readString(getMemory(), ptr, len)); },
      maw_print_err(ptr, len) { process.stderr.write(readString(getMemory(), ptr, len)); },
      maw_log(level, ptr, len) { /* dispatched to console.{debug,log,warn,error} */ },

      maw_identity() { return writeString(getMemory(), getAlloc(), cachedIdentity!); },
      maw_federation() { return writeString(getMemory(), getAlloc(), cachedFederation!); },

      maw_send(tPtr, tLen, mPtr, mLen) {
        const target = readString(getMemory(), tPtr, tLen);
        const text = readString(getMemory(), mPtr, mLen);
        maw.send(target, text).catch(e => console.error(`[wasm] maw_send failed:`, e.message));
        return 1;
      },

      maw_fetch(urlPtr, urlLen) {
        const id = ++asyncSeq;
        const url = readString(getMemory(), urlPtr, urlLen);
        fetch(url, { signal: AbortSignal.timeout(10_000) })
          .then(r => r.text())
          .then(body => asyncResults.set(id, body))
          .catch(e => asyncResults.set(id, JSON.stringify({ error: e.message })));
        return id;
      },

      maw_async_result(id) {
        const result = asyncResults.get(id);
        if (result === undefined) return 0;
        asyncResults.delete(id);
        return writeString(getMemory(), getAlloc(), result);
      },

      maw_alloc, // (see §11.2 above)
    },
    _setCachedIdentity(json: string) { cachedIdentity = json; },
    _setCachedFederation(json: string) { cachedFederation = json; },
  };
}
```

Three subtleties hide in those nine functions.

**Late-binding.** The bridge needs to read the WASM module's memory and call its allocator. Both are exports of the *Instance* — which doesn't exist yet when we build the import object. We can't pass the memory directly. We pass *getters* (`getMemory: () => WebAssembly.Memory`) and the registry mutates the closures after instantiation:

```ts
// maw-js/src/cli/command-registry.ts:97-117
let wasmMemory: WebAssembly.Memory;
let wasmAlloc: (size: number) => number;

const bridge = buildImportObject(
  () => wasmMemory,
  () => wasmAlloc,
  { memoryMaxPages: WASM_MEMORY_MAX_PAGES },
);

let instance = new WebAssembly.Instance(mod, bridge);

wasmMemory = instance.exports.memory as WebAssembly.Memory;
wasmAlloc = (instance.exports.maw_alloc as (size: number) => number)
  ?? bridge.env.maw_alloc;
```

This trick is straight from graph-node's `RuntimeHostBuilder` — they call it "the chicken-and-egg with memory/alloc exports" in their comments.

**Sync façades over async data.** WASM's MVP cannot await a promise. `maw.identity()` is async (it makes an HTTP call). So the host pre-caches identity and federation into strings *before* invoking `handle()`, and the host functions return the cached bytes synchronously:

```ts
// maw-js/src/cli/wasm-bridge.ts:186-195
export async function preCacheBridge(bridge: WasmBridge): Promise<void> {
  const [id, fed] = await Promise.all([
    maw.identity().catch(() => ({ error: "unreachable" })),
    maw.federation().catch(() => ({ error: "unreachable" })),
  ]);
  bridge._setCachedIdentity(JSON.stringify(id));
  bridge._setCachedFederation(JSON.stringify(fed));
}
```

The cost: identity is a *snapshot* taken at the start of the WASM call. The benefit: the guest gets a synchronous API and never blocks the host's event loop.

**Polling for async results.** For genuinely async operations like `maw_fetch`, we use the pattern graph-node calls *trigger handlers* and we call *async stash*. `maw_fetch(url)` returns an ID immediately and kicks off the actual `fetch()` on the host side. The guest polls `maw_async_result(id)` until it returns non-zero. This is uglier than `await`, but it's honest about the WASM/JS impedance mismatch and it doesn't require a future MVP feature.

---

## 11.4 Safety: The Cap, the Clock, the Trap

Three lines, scattered across `command-registry.ts`, are the entire sandbox enforcement story:

```ts
// maw-js/src/cli/command-registry.ts:25-26
const WASM_MEMORY_MAX_PAGES = 256;       // 16MB max (256 * 64KB)
const WASM_COMMAND_TIMEOUT_MS = 5_000;   // 5s limit for commands
```

```ts
// maw-js/src/cli/command-registry.ts:194-199
const timeoutGuard = new Promise<never>((_, reject) =>
  setTimeout(
    () => reject(new Error(`[wasm-safety] timed out after ${WASM_COMMAND_TIMEOUT_MS / 1000}s`)),
    WASM_COMMAND_TIMEOUT_MS,
  ),
);
await Promise.race([wasmExec, timeoutGuard]);
```

That is it. A 16MB memory cap (enforced by the allocator above and re-validated on every call). A 5-second deadline (enforced by `Promise.race`). A `try/catch` that classifies failure modes into four buckets and invalidates the WASM instance on any of them:

```ts
// maw-js/src/cli/command-registry.ts:201-218
try {
  await Promise.race([wasmExec, timeoutGuard]);
} catch (err: any) {
  const msg = err.message || String(err);
  if (msg.includes("wasm-safety") && msg.includes("timed out")) {
    console.error(`[commands] WASM timeout in "${desc.name}": exceeded ${WASM_COMMAND_TIMEOUT_MS / 1000}s`);
  } else if (msg.includes("unreachable") || msg.includes("RuntimeError")) {
    console.error(`[commands] WASM trap in "${desc.name}": ${msg}`);
  } else if (msg.includes("out of bounds") || msg.includes("memory")) {
    console.error(`[commands] WASM memory error in "${desc.name}": ${msg}`);
  } else if (msg.includes("wasm-safety")) {
    console.error(`[commands] WASM safety limit in "${desc.name}": ${msg}`);
  } else {
    console.error(`[commands] WASM error in "${desc.name}": ${msg}`);
  }
  wasmInstances.delete(desc.path!);  // state may be corrupted after a trap
}
```

The instance-invalidation is the rule we lifted directly from graph-node's "deterministic vs fatal failure" doctrine: a trapped WASM instance has unknown internal state, and calling it again is undefined behaviour. We throw the instance away and force a reload on next invocation.

The 16MB cap was chosen by reading what `wasm-bindgen`-generated modules actually need. The hello-rust example uses two pages. A heavy plugin embedding `serde_json` and `regex` uses about thirty. 256 pages is roughly 8× headroom; if a plugin needs more, we want to *know about it* so we can decide whether to raise the cap or reject the plugin.

---

## 11.5 The Rust SDK

A bare WASM module is a hostile development environment. Plugin authors should write Rust, not `extern "C"` declarations. The `maw-plugin-sdk` crate (`src/wasm/maw-plugin-sdk/`) wraps the host functions in idiomatic Rust:

```rust
// maw-js/src/wasm/maw-plugin-sdk/src/lib.rs:28-53 (condensed)
extern "C" {
    fn maw_print(ptr: *const u8, len: usize);
    fn maw_print_err(ptr: *const u8, len: usize);
    fn maw_log(level: i32, ptr: *const u8, len: usize);
    fn maw_identity() -> *const u8;
    fn maw_federation() -> *const u8;
    fn maw_send(t_ptr: *const u8, t_len: usize, m_ptr: *const u8, m_len: usize) -> i32;
    fn maw_fetch(url_ptr: *const u8, url_len: usize) -> i32;
    fn maw_async_result(id: i32) -> *const u8;
}

pub fn print(msg: &str) { unsafe { maw_print(msg.as_ptr(), msg.len()) } }
pub fn eprint(msg: &str) { unsafe { maw_print_err(msg.as_ptr(), msg.len()) } }
pub fn debug(msg: &str) { log(0, msg); }
pub fn info(msg: &str) { log(1, msg); }
pub fn warn(msg: &str) { log(2, msg); }
pub fn error(msg: &str) { log(3, msg); }

pub fn identity() -> Identity {
    let ptr = unsafe { maw_identity() };
    let json = read_host_string(ptr);
    serde_json::from_str(&json).unwrap_or_else(|e| {
        eprint(&format!("[maw-sdk] failed to parse identity: {e}\n"));
        Identity::default()
    })
}

pub fn send(target: &str, message: &str) -> bool {
    let result = unsafe {
        maw_send(target.as_ptr(), target.len(), message.as_ptr(), message.len())
    };
    result == 1
}
```

The struct definitions are deserialized straight off the JSON the host emits, with `serde(rename_all = "camelCase")` so that the Rust idioms (`reachable_peers`) match TypeScript's (`reachablePeers`):

```rust
// maw-js/src/wasm/maw-plugin-sdk/src/lib.rs:194-220
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub node: String,
    pub version: String,
    #[serde(default)] pub agents: Vec<String>,
    #[serde(default)] pub clock_utc: String,
    #[serde(default)] pub uptime: u64,
}
```

The shape is exactly what `Static<typeof IdentitySchema>` produces in TypeScript (Chapter 10.2). The TypeBox schema is the source of truth on both sides of the WASM boundary. If we ever add a field to `Identity`, we add it to `schemas.ts` first; the Rust side picks it up via `#[serde(default)]` until the Rust SDK is republished. No silent drift.

---

## 11.6 Case Study: hello-rust → 81.6KB WASM

The full hello-world plugin in Rust is twenty-eight lines, including the allocator re-export:

```rust
// maw-js/src/wasm/examples/hello-rust/src/lib.rs
use maw_plugin_sdk as maw;

#[no_mangle]
pub extern "C" fn handle(ptr: *const u8, len: usize) -> i32 {
    let args = maw::read_args(ptr, len);

    let id = maw::identity();
    maw::print(&format!("Hello from Rust WASM!\n"));
    maw::print(&format!("  node:    {}\n", id.node));
    maw::print(&format!("  version: {}\n", id.version));
    maw::print(&format!("  agents:  {}\n", id.agents.join(", ")));

    if !args.is_empty() {
        maw::print(&format!("  args:    {}\n", args.join(" ")));
    }

    let fed = maw::federation();
    maw::print(&format!("  peers:   {}/{}\n", fed.reachable_peers, fed.total_peers));

    0
}

pub use maw_plugin_sdk::maw_alloc;
```

Compiled with `cargo build --release --target wasm32-unknown-unknown`, this produces an 81.6KB `.wasm` file. Most of that is `serde_json` parsing the identity payload. Stripped with `wasm-strip` and optimized with `wasm-opt -Oz`, it shrinks to 47KB. We don't ship the optimization in the example — readers running `cargo build` get the unoptimized 81.6KB and that's the number they should expect.

To install the plugin:

```bash
cp target/wasm32-unknown-unknown/release/hello_rust.wasm \
   ~/.oracle/commands/hello-rust.wasm
maw hello-rust planet
```

Output:

```
Hello from Rust WASM!
  node:    mawjs
  version: 2.0.0-alpha.2
  agents:  oracle, maw, neo
  args:    planet
  peers:   3/4
```

The first run cost ~30ms — `WebAssembly.Module(bytes)` compilation plus instantiation plus the pre-cache. Subsequent runs cost ~8ms because the registry caches the instance in `wasmInstances` (`command-registry.ts:42-47`) and only invalidates it on a trap. Compared to a TypeScript plugin's ~120ms cold start (Bun loading the SDK module), WASM is faster. Compared to a native binary, it is slower — but it is sandboxed, portable, and the same `.wasm` runs on linux/x64, macOS/arm64, and inside a browser if we ever want to run plugins client-side.

The **case study commit** (`f0d3b9a`) shows what happens when a community-submitted Rust plugin tries to misbehave. The plugin called `std::fs::read_to_string("/etc/passwd")`. Compilation succeeded — `std::fs` exists in `wasm32-unknown-unknown`'s std. Instantiation failed:

```
[commands] wasm instantiation failed: bad-rust.wasm:
  Import #4 module="wasi_snapshot_preview1" function="fd_read" not found
```

The `wasm32-unknown-unknown` target stubs out `std::fs` to call WASI imports. We don't provide WASI. The module won't instantiate. The plugin is rejected before its first byte of code runs. This is what "capability-restricted by construction" means at the operational level: a plugin author cannot accidentally expand the trust boundary. They can only call into host functions we ship.

---

## 11.7 What We Deliberately Skipped

Three pieces of graph-node's runtime we did not implement, and the reasons are worth saying out loud.

**Gas metering.** Graph-node instruments every WASM function call with a gas cost and aborts if the trigger exceeds a budget. We have a 5-second wall-clock deadline instead. Wall-clock is coarser — a plugin can spin a tight CPU loop for 4.9 seconds and we won't notice — but our threat model is "honest plugins with bugs," not "adversarial plugins paid by gas." If maw-js plugins ever run untrusted code on shared infrastructure, we will revisit.

**Per-trigger fresh instances.** Graph-node creates a new WASM instance for *every* blockchain event. We cache and reuse. This means a plugin's `static mut` state survives across calls, which is occasionally surprising. We accepted this trade for the ~22ms-per-call savings. If a plugin's behaviour depends on fresh state, it must zero its globals at the top of `handle()`.

**Determinism guarantees.** Graph-node distinguishes "deterministic failure" (skip the trigger, advance the cursor) from "non-deterministic failure" (retry, eventually crash). We log everything as a generic error and invalidate the instance. This is appropriate for CLI commands; it would be wrong for a stateful indexer.

These omissions are noted in `ψ/learn/graphprotocol/graph-node/2026-04-13/1144_ARCHITECTURE.md` under "Pattern Analysis." Skipping a pattern only works when you have written down *why* and what would change your mind.

---

## Takeaways

- **Pick a single memory protocol and stick to it.** Length-prefixed UTF-8 covers every cross-boundary string in maw-js. The protocol is one sentence; the implementation is two helpers.
- **Late-bind memory and allocator.** The WASM Instance doesn't exist when you build the importObject. Pass getters that close over mutable refs and patch them after instantiation.
- **Async via polling, not promises.** WASM MVP can't await. Stash async results host-side; let the guest poll an ID. Pre-cache anything that *can* be made synchronous before the call begins.
- **Three-line sandbox.** A memory cap, a wall-clock deadline, and `Promise.race`. The instance-invalidation rule on trap is the hidden fourth line — it is what keeps a corrupted module from poisoning subsequent calls.
- **Skip what you don't need, on purpose.** Gas metering, per-trigger isolation, and determinism scaffolding are graph-node features that solve graph-node problems. Lift the patterns; do not cargo-cult the implementation. Document the skip.

## Next Chapter

Chapter 12 shifts from infrastructure-we-built to infrastructure-we-replaced. The Hono → Elysia migration touched 21 files and 76 routes. We did it in three phases — schema first, then dependency injection, then the framework swap — and we used a team of agents to bulk-transform routes in parallel. The chapter includes the `error()` import war story: how testing one route saved us from breaking forty-seven others.
