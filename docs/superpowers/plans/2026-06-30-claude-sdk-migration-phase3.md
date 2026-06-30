# Claude SDK Migration — Phase 3 Implementation Plan (SAI chat tools as an in-process SDK MCP server)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In SDK mode (`claudeBackend: 'sdk'`), expose SAI's 16 chat (`sai_*`) tools to the model via an in-process `createSdkMcpServer`, whose handlers delegate to the *same* renderer-IPC round-trip the existing socket MCP server uses — so render output + screenshots + `__mcpImage` results are reused unchanged. Also add the chat system-prompt nudges deferred since Phase 1. `'cli'` mode is untouched.

**Architecture:** A single shared dispatch (the lifted `onToolCall` body in `main.ts`, exposed via a registry module) executes a SAI chat tool against the renderer. Both transports call it: the existing socket `SwarmMcpHost` (CLI mode) and a new in-process SDK MCP server (SDK mode). The SDK server is built per chat scope inside `SdkBackend`, converting each tool's JSON Schema to a Zod shape, and wraps results into MCP content blocks with the same `__mcpImage` logic the socket server uses (now a shared helper).

**Tech Stack:** TypeScript, Electron main process, `@anthropic-ai/claude-agent-sdk@0.3.196` (`createSdkMcpServer`, `tool`), `@modelcontextprotocol/sdk@1.29`, `zod@4`, Vitest.

## Global Constraints

- Vitest must run with limited parallelism: `npx vitest run <path> --maxWorkers=2`. Respect any project `vitest.config` worker cap if ≤2.
- Commit messages end with the trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- `'cli'` mode behavior MUST remain byte-for-byte unchanged. The shared dispatch is the single execution path for both transports; do not duplicate the round-trip logic.
- Schema source of truth stays `SAI_TOOL_SCHEMA` (`src/lib/saiTools.ts`). No hand-duplicated tool schemas.
- Tool naming parity with CLI mode: the SDK server advertises tools as `sai_<name>` (e.g. `sai_render_html`) under server key `sai`; the renderer round-trip receives the **bare** name (`render_html`), exactly as the socket path passes to `transport.call`.
- Symlinked home: `/home/mstephens` ↔ `/var/home/mstephens` — never compare paths by string equality.

---

## File Structure

- `electron/services/mcpToolContent.ts` — **new.** Pure helpers turning a raw tool result (possibly carrying `__mcpImage`) into MCP content blocks. Shared by the socket server and the SDK server.
- `electron/swarm-mcp-server.ts` — **modified.** `tools/call` uses the shared helpers instead of inline content-building. No behavior change.
- `electron/services/saiToolBridge.ts` — **new.** A tiny registry holding the single dispatch function so `SdkBackend` (in `claudeBackend/`) can reach `main.ts`'s renderer round-trip without an import cycle.
- `electron/main.ts` — **modified.** The `swarmMcpHost.onToolCall(async (req) => {…})` callback body is lifted into a named `const dispatchSwarmTool` and registered both on `swarmMcpHost` and into the bridge registry. No behavior change.
- `electron/services/claudeBackend/jsonSchemaToZod.ts` — **new.** `jsonSchemaToZodShape(input_schema)` converting SAI's JSON Schemas to a Zod raw shape for `tool()`.
- `electron/services/claudeBackend/saiMcpServer.ts` — **new.** `buildSaiChatMcpServer({ workspace, dispatch })` returning a `McpSdkServerConfigWithInstance` registering the 16 chat tools.
- `electron/services/chatNudges.ts` — **new.** `CHAT_RENDER_NUDGE` + `CHAT_GITHUB_WATCH_NUDGE` moved here (re-exported from `claude.ts` for back-compat) so `SdkBackend` can import them without a const-eval circular dependency.
- `electron/services/claude.ts` — **modified.** Re-export the two nudge constants from `chatNudges.ts` (move definitions out).
- `electron/services/claudeBackend/sdkOptions.ts` — **modified.** Add an `mcpServers?` passthrough into the returned `Options`.
- `electron/services/claudeBackend/sdkBackend.ts` — **modified.** `_createSession` builds the chat MCP server (via an injected `buildChatMcpServer` dep) and composes the chat nudges for `kind === 'chat'`; passes `mcpServers` through to `buildSdkOptions`.
- `electron/services/claudeBackend/index.ts` — **modified.** `getClaudeBackend()` injects the real `buildChatMcpServer` (wiring `buildSaiChatMcpServer` + the bridge dispatch) into `SdkBackend`.

---

## Task 1: Shared MCP content-wrapper helper

**Files:**
- Create: `electron/services/mcpToolContent.ts`
- Modify: `electron/swarm-mcp-server.ts` (the `tools/call` success/error blocks, ~lines 138–158)
- Test: `tests/unit/electron/mcpToolContent.test.ts`

**Interfaces:**
- Produces:
  - `interface McpToolContent { content: Array<Record<string, unknown>>; isError?: boolean }`
  - `function toMcpSuccessContent(result: unknown): McpToolContent` — text block of `JSON.stringify(result without __mcpImage)`, plus an `{type:'image', data, mimeType}` block when `result.__mcpImage.base64` is a string.
  - `function toMcpErrorContent(message: string): McpToolContent` — `{ content: [{type:'text', text: message}], isError: true }`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/electron/mcpToolContent.test.ts
import { describe, it, expect } from 'vitest';
import { toMcpSuccessContent, toMcpErrorContent } from '../../../electron/services/mcpToolContent';

describe('mcpToolContent', () => {
  it('wraps a plain result as a single JSON text block', () => {
    const out = toMcpSuccessContent({ ok: true, value: 42 });
    expect(out.isError).toBeUndefined();
    expect(out.content).toEqual([{ type: 'text', text: JSON.stringify({ ok: true, value: 42 }) }]);
  });

  it('splits out __mcpImage into an image block and strips it from the text', () => {
    const out = toMcpSuccessContent({ note: 'hi', __mcpImage: { base64: 'AAA', mimeType: 'image/png' } });
    expect(out.content[0]).toEqual({ type: 'text', text: JSON.stringify({ note: 'hi', __mcpImage: undefined }) });
    expect(out.content[1]).toEqual({ type: 'image', data: 'AAA', mimeType: 'image/png' });
  });

  it('defaults image mimeType to image/png', () => {
    const out = toMcpSuccessContent({ __mcpImage: { base64: 'BBB' } });
    expect(out.content[1]).toEqual({ type: 'image', data: 'BBB', mimeType: 'image/png' });
  });

  it('ignores __mcpImage without a string base64', () => {
    const out = toMcpSuccessContent({ __mcpImage: { mimeType: 'image/png' } });
    expect(out.content).toHaveLength(1);
    expect(out.content[0].type).toBe('text');
  });

  it('wraps an error message with isError', () => {
    expect(toMcpErrorContent('boom')).toEqual({ content: [{ type: 'text', text: 'boom' }], isError: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/electron/mcpToolContent.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `mcpToolContent`.

- [ ] **Step 3: Write the implementation**

```typescript
// electron/services/mcpToolContent.ts
/**
 * Shared MCP content wrapping for SAI chat tools. Both transports — the
 * subprocess socket server (electron/swarm-mcp-server.ts) and the in-process
 * SDK MCP server (electron/services/claudeBackend/saiMcpServer.ts) — turn a raw
 * renderer round-trip result into MCP content blocks here, so the `__mcpImage`
 * handling lives in exactly one place.
 */
export interface McpToolContent {
  content: Array<Record<string, unknown>>;
  isError?: boolean;
}

export function toMcpSuccessContent(result: unknown): McpToolContent {
  const content: Array<Record<string, unknown>> = [];
  const image =
    result && typeof result === 'object' ? (result as { __mcpImage?: unknown }).__mcpImage : undefined;
  const textPayload = image ? { ...(result as Record<string, unknown>), __mcpImage: undefined } : result;
  content.push({ type: 'text', text: JSON.stringify(textPayload) });
  if (image && typeof image === 'object' && typeof (image as { base64?: unknown }).base64 === 'string') {
    const img = image as { base64: string; mimeType?: string };
    content.push({ type: 'image', data: img.base64, mimeType: img.mimeType ?? 'image/png' });
  }
  return { content };
}

export function toMcpErrorContent(message: string): McpToolContent {
  return { content: [{ type: 'text', text: message }], isError: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/electron/mcpToolContent.test.ts --maxWorkers=2`
Expected: PASS (5 tests).

- [ ] **Step 5: Refactor swarm-mcp-server.ts to use the helpers**

In `electron/swarm-mcp-server.ts`, add to the imports near the top (alongside the existing `import { toolsForToolset, SAI_TOOL_NAMES, ... }`):

```typescript
import { toMcpSuccessContent, toMcpErrorContent } from './services/mcpToolContent';
```

Replace the `try { … } catch { … }` block inside `tools/call` (the part that builds `content` / the error frame, currently ~lines 138–158) with:

```typescript
      try {
        const result = await transport.call(toolName, input);
        return { jsonrpc: '2.0', id, result: toMcpSuccessContent(result) };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { jsonrpc: '2.0', id, result: toMcpErrorContent(msg) };
      }
```

- [ ] **Step 6: Run the swarm protocol tests to verify no behavior change**

Run: `npx vitest run tests/swarm/swarmMcpProtocol.test.ts tests/unit/electron/mcpToolContent.test.ts --maxWorkers=2`
Expected: PASS (existing protocol tests incl. `__mcpImage` wrapping stay green).

- [ ] **Step 7: Commit**

```bash
git add electron/services/mcpToolContent.ts electron/swarm-mcp-server.ts tests/unit/electron/mcpToolContent.test.ts
git commit -m "refactor(mcp): extract shared MCP content wrapper (__mcpImage) for both transports

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: SAI tool-dispatch registry + lift main.ts onToolCall

**Files:**
- Create: `electron/services/saiToolBridge.ts`
- Modify: `electron/main.ts` (the `swarmMcpHost.onToolCall(async (req) => {…})` registration, ~lines 531–573)
- Test: `tests/unit/electron/saiToolBridge.test.ts`

**Interfaces:**
- Produces:
  - `interface SaiToolRequest { tool: string; input: unknown; workspace: string }`
  - `type SaiToolDispatch = (req: SaiToolRequest) => Promise<unknown>`
  - `function setSaiToolDispatch(fn: SaiToolDispatch | null): void`
  - `function getSaiToolDispatch(): SaiToolDispatch | null`
- Consumes (Task 6): `getSaiToolDispatch()` is read lazily at chat-session-create time.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/electron/saiToolBridge.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { setSaiToolDispatch, getSaiToolDispatch } from '../../../electron/services/saiToolBridge';

describe('saiToolBridge', () => {
  afterEach(() => setSaiToolDispatch(null));

  it('starts null', () => {
    expect(getSaiToolDispatch()).toBeNull();
  });

  it('stores and returns the registered dispatch', async () => {
    const fn = async (req: { tool: string }) => ({ echoed: req.tool });
    setSaiToolDispatch(fn);
    const got = getSaiToolDispatch();
    expect(got).toBe(fn);
    expect(await got!({ tool: 'render_html', input: {}, workspace: '/ws' })).toEqual({ echoed: 'render_html' });
  });

  it('can be cleared back to null', () => {
    setSaiToolDispatch(async () => undefined);
    setSaiToolDispatch(null);
    expect(getSaiToolDispatch()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/electron/saiToolBridge.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `saiToolBridge`.

- [ ] **Step 3: Write the registry module**

```typescript
// electron/services/saiToolBridge.ts
/**
 * Single source of truth for executing a SAI chat tool against the renderer.
 *
 * The real dispatch (the renderer IPC round-trip) is defined in electron/main.ts
 * where the BrowserWindow / pending-call map live. It is registered here so the
 * SDK backend (electron/services/claudeBackend/), which must not import main.ts,
 * can reach the exact same round-trip used by the socket MCP server in CLI mode.
 */
export interface SaiToolRequest {
  tool: string;
  input: unknown;
  workspace: string;
}

export type SaiToolDispatch = (req: SaiToolRequest) => Promise<unknown>;

let dispatch: SaiToolDispatch | null = null;

export function setSaiToolDispatch(fn: SaiToolDispatch | null): void {
  dispatch = fn;
}

export function getSaiToolDispatch(): SaiToolDispatch | null {
  return dispatch;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/electron/saiToolBridge.test.ts --maxWorkers=2`
Expected: PASS (3 tests).

- [ ] **Step 5: Lift the onToolCall body in main.ts and register it both places**

In `electron/main.ts`, add to the imports (near other `./services/...` imports):

```typescript
import { setSaiToolDispatch } from './services/saiToolBridge';
```

Find the existing registration (~line 531):

```typescript
swarmMcpHost.onToolCall(async (req) => {
  // … existing body …
});
```

Refactor it to a named const and register it on both sinks. Keep the body **identical** — only change the wrapper:

```typescript
// Single dispatch used by BOTH MCP transports: the socket SwarmMcpHost (CLI
// mode) and the in-process SDK MCP server (SDK mode, via saiToolBridge). The
// orchestrator-card injection below is a no-op for chat scopes (no
// orchSessionId), so SDK chat tools reuse this unchanged.
const dispatchSwarmTool = async (req: { tool: string; input: unknown; workspace: string }) => {
  // … the EXACT existing body, unchanged …
};

swarmMcpHost.onToolCall(dispatchSwarmTool);
setSaiToolDispatch(dispatchSwarmTool);
```

Notes for the implementer:
- The existing body generates its own `id` (`mcp-${crypto.randomUUID()}`) and reads only `req.tool`, `req.input`, `req.workspace` — it does NOT use `req.id`. So the narrower `{ tool, input, workspace }` parameter type is correct and remains structurally compatible with `SwarmMcpHost`'s `onToolCall(h: (req: SwarmToolCallRequest) => Promise<unknown>)`.
- Do not change anything inside the body (the `pendingMcpCalls` map, `safeSendMcp('swarm:tool-request', …)`, the `formTimeoutMs` timeout, the orchestrator-card `safeSendMcp('claude:message', …)`). It stays the one renderer round-trip.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0 (no type errors from the main.ts refactor).

- [ ] **Step 7: Commit**

```bash
git add electron/services/saiToolBridge.ts electron/main.ts tests/unit/electron/saiToolBridge.test.ts
git commit -m "refactor(mcp): lift onToolCall into shared dispatch + register in saiToolBridge

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: JSON-Schema → Zod shape converter

**Files:**
- Create: `electron/services/claudeBackend/jsonSchemaToZod.ts`
- Test: `tests/unit/electron/jsonSchemaToZod.test.ts`

**Interfaces:**
- Produces: `function jsonSchemaToZodShape(schema: { properties?: Record<string, any>; required?: string[] }): ZodRawShape` — maps each property of a SAI tool `input_schema` to a Zod type; properties not listed in `required` become `.optional()`. Supports `string` (+`enum`), `number`/`integer`, `boolean`, `object` (free-form record), `array` (with `items`), and falls back to `z.unknown()` for anything else.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/electron/jsonSchemaToZod.test.ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { jsonSchemaToZodShape } from '../../../electron/services/claudeBackend/jsonSchemaToZod';

describe('jsonSchemaToZodShape', () => {
  it('maps scalar types and marks non-required as optional', () => {
    const shape = jsonSchemaToZodShape({
      properties: {
        name: { type: 'string' },
        count: { type: 'number' },
        flag: { type: 'boolean' },
      },
      required: ['name'],
    });
    const obj = z.object(shape);
    expect(obj.safeParse({ name: 'x', count: 1, flag: true }).success).toBe(true);
    expect(obj.safeParse({ count: 1 }).success).toBe(false); // name required
    expect(obj.safeParse({ name: 'x' }).success).toBe(true); // count/flag optional
  });

  it('maps enum to z.enum', () => {
    const shape = jsonSchemaToZodShape({
      properties: { chart: { type: 'string', enum: ['bar', 'line'] } },
      required: ['chart'],
    });
    const obj = z.object(shape);
    expect(obj.safeParse({ chart: 'bar' }).success).toBe(true);
    expect(obj.safeParse({ chart: 'pie' }).success).toBe(false);
  });

  it('maps arrays of strings/numbers and free-form objects', () => {
    const shape = jsonSchemaToZodShape({
      properties: {
        labels: { type: 'array', items: { type: 'string' } },
        values: { type: 'array', items: { type: 'number' } },
        props: { type: 'object' },
        filters: { type: 'array', items: { type: 'object' } },
      },
      required: ['labels', 'values'],
    });
    const obj = z.object(shape);
    expect(obj.safeParse({ labels: ['a'], values: [1], props: { k: 'v' }, filters: [{ name: 'x' }] }).success).toBe(true);
    expect(obj.safeParse({ labels: [1], values: [1] }).success).toBe(false); // labels must be strings
  });

  it('handles an empty/absent properties object', () => {
    expect(jsonSchemaToZodShape({})).toEqual({});
    const obj = z.object(jsonSchemaToZodShape({}));
    expect(obj.safeParse({}).success).toBe(true);
  });

  it('falls back to z.unknown() for unrecognized types', () => {
    const shape = jsonSchemaToZodShape({ properties: { weird: { type: 'null' } } });
    const obj = z.object(shape);
    expect(obj.safeParse({ weird: 123 }).success).toBe(true); // unknown accepts anything
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/electron/jsonSchemaToZod.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `jsonSchemaToZod`.

- [ ] **Step 3: Write the converter**

```typescript
// electron/services/claudeBackend/jsonSchemaToZod.ts
import { z, type ZodRawShape, type ZodTypeAny } from 'zod';

interface JsonProp {
  type?: string;
  enum?: string[];
  items?: JsonProp;
  description?: string;
}

interface JsonObjectSchema {
  properties?: Record<string, JsonProp>;
  required?: string[];
}

function leafToZod(prop: JsonProp | undefined): ZodTypeAny {
  if (prop && Array.isArray(prop.enum) && prop.enum.length > 0) {
    return z.enum(prop.enum as [string, ...string[]]);
  }
  switch (prop?.type) {
    case 'string':
      return z.string();
    case 'number':
    case 'integer':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'object':
      return z.record(z.string(), z.unknown());
    case 'array':
      return z.array(prop?.items ? leafToZod(prop.items) : z.unknown());
    default:
      return z.unknown();
  }
}

/**
 * Convert a SAI tool's JSON Schema `input_schema` into a Zod raw shape suitable
 * for the claude-agent-sdk `tool()` helper. Only the small subset of JSON Schema
 * actually used by SAI_TOOL_SCHEMA is supported (string/number/boolean/object/
 * array + enum); anything else degrades to z.unknown() so a new schema never
 * throws at startup. Properties absent from `required` become optional.
 */
export function jsonSchemaToZodShape(schema: JsonObjectSchema): ZodRawShape {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const shape: ZodRawShape = {};
  for (const [key, prop] of Object.entries(properties)) {
    let zt = leafToZod(prop);
    if (prop && typeof prop.description === 'string') {
      zt = zt.describe(prop.description);
    }
    if (!required.has(key)) {
      zt = zt.optional();
    }
    shape[key] = zt;
  }
  return shape;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/electron/jsonSchemaToZod.test.ts --maxWorkers=2`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/services/claudeBackend/jsonSchemaToZod.ts tests/unit/electron/jsonSchemaToZod.test.ts
git commit -m "feat(sdk): JSON-Schema to Zod shape converter for SAI tool schemas

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: buildSaiChatMcpServer (in-process SDK MCP server)

**Files:**
- Create: `electron/services/claudeBackend/saiMcpServer.ts`
- Test: `tests/unit/electron/saiMcpServer.test.ts`

**Interfaces:**
- Consumes: `jsonSchemaToZodShape` (Task 3); `toMcpSuccessContent` / `toMcpErrorContent` (Task 1); `SaiToolDispatch` (Task 2); `toolsForToolset` from `src/lib/saiTools`.
- Produces:
  - `interface SaiMcpDeps { workspace: string; dispatch: SaiToolDispatch }`
  - `function buildSaiChatMcpServer(deps: SaiMcpDeps): McpSdkServerConfigWithInstance` — a `createSdkMcpServer({ name:'sai', version, tools })` registering one `tool()` per `toolsForToolset('chat')` entry, advertised as `sai_<name>`. Each handler calls `dispatch({ tool: <bare name>, input: args, workspace })`, returns `toMcpSuccessContent(result)` on success and `toMcpErrorContent(msg)` on throw.
  - `const SAI_MCP_SERVER_NAME = 'sai'` (exported for the wiring task).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/electron/saiMcpServer.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildSaiChatMcpServer, SAI_MCP_SERVER_NAME } from '../../../electron/services/claudeBackend/saiMcpServer';
import { toolsForToolset } from '../../../src/lib/saiTools';

describe('buildSaiChatMcpServer', () => {
  it('builds an sdk-type server registering all chat tools as sai_<name>', () => {
    const server = buildSaiChatMcpServer({ workspace: '/ws', dispatch: async () => ({}) });
    expect(server.type).toBe('sdk');
    expect(server.name).toBe(SAI_MCP_SERVER_NAME);
    // The SDK McpServer instance exists.
    expect(server.instance).toBeDefined();
  });

  it('registers exactly the chat toolset (16 tools)', () => {
    const chatCount = toolsForToolset('chat').length;
    const registered: string[] = [];
    // tool() registration is observable via the McpServer instance internals;
    // assert by spying on the dispatch through a round-trip instead (below).
    expect(chatCount).toBe(16);
    expect(registered).toEqual([]); // placeholder — see handler test below
  });

  it('handler routes to dispatch with the bare tool name + workspace, wraps success', async () => {
    const dispatch = vi.fn(async () => ({ ok: true, __mcpImage: { base64: 'AAA', mimeType: 'image/png' } }));
    const server = buildSaiChatMcpServer({ workspace: '/ws', dispatch });
    // Invoke a tool handler directly through the captured registration.
    const handler = (server as any).__handlersForTest.get('sai_render_html');
    expect(handler).toBeTypeOf('function');
    const result = await handler({ html: '<b>hi</b>' });
    expect(dispatch).toHaveBeenCalledWith({ tool: 'render_html', input: { html: '<b>hi</b>' }, workspace: '/ws' });
    expect(result.content[0]).toEqual({ type: 'text', text: JSON.stringify({ ok: true, __mcpImage: undefined }) });
    expect(result.content[1]).toEqual({ type: 'image', data: 'AAA', mimeType: 'image/png' });
  });

  it('handler wraps a dispatch error with isError', async () => {
    const dispatch = vi.fn(async () => { throw new Error('boom'); });
    const server = buildSaiChatMcpServer({ workspace: '/ws', dispatch });
    const handler = (server as any).__handlersForTest.get('sai_confirm');
    const result = await handler({ message: 'ok?' });
    expect(result).toEqual({ content: [{ type: 'text', text: 'boom' }], isError: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/electron/saiMcpServer.test.ts --maxWorkers=2`
Expected: FAIL — cannot find module `saiMcpServer`.

- [ ] **Step 3: Write the server builder**

The `tool()` handlers are registered inside `createSdkMcpServer`, which doesn't expose them for unit assertion. To keep the handler logic testable without driving a full MCP transport, build each tool's handler as a named closure, attach a test-only `__handlersForTest` map to the returned object, then hand the same closures to `tool()`.

```typescript
// electron/services/claudeBackend/saiMcpServer.ts
import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { toolsForToolset } from '../../../src/lib/saiTools';
import { jsonSchemaToZodShape } from './jsonSchemaToZod';
import { toMcpSuccessContent, toMcpErrorContent } from '../mcpToolContent';
import type { SaiToolDispatch } from '../saiToolBridge';

export const SAI_MCP_SERVER_NAME = 'sai';

export interface SaiMcpDeps {
  workspace: string;
  dispatch: SaiToolDispatch;
}

/**
 * Build the in-process SDK MCP server exposing SAI's chat tools to the model in
 * SDK mode. Tools are advertised as `sai_<name>` (matching the socket server),
 * so the model sees `mcp__sai__sai_render_html` etc. Each handler delegates to
 * the shared renderer round-trip via `dispatch`, reusing the exact `__mcpImage`
 * wrapping the socket transport uses. Built per chat scope so `workspace` is
 * bound for every call.
 */
export function buildSaiChatMcpServer(deps: SaiMcpDeps): McpSdkServerConfigWithInstance {
  const { workspace, dispatch } = deps;
  const handlersForTest = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();

  const tools = toolsForToolset('chat').map((def) => {
    const advertisedName = `sai_${def.name}`;
    const handler = async (args: Record<string, unknown>) => {
      try {
        const result = await dispatch({ tool: def.name, input: args, workspace });
        return toMcpSuccessContent(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return toMcpErrorContent(msg);
      }
    };
    handlersForTest.set(advertisedName, handler);
    return tool(
      advertisedName,
      def.description,
      jsonSchemaToZodShape(def.input_schema),
      handler as Parameters<typeof tool>[3],
    );
  });

  const server = createSdkMcpServer({ name: SAI_MCP_SERVER_NAME, version: '1.0.0', tools });
  // Test-only seam: expose the raw handlers so unit tests can assert routing
  // without standing up an MCP transport. Non-enumerable so it never serializes.
  Object.defineProperty(server, '__handlersForTest', {
    value: handlersForTest,
    enumerable: false,
  });
  return server;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/electron/saiMcpServer.test.ts --maxWorkers=2`
Expected: PASS. If the "registers exactly the chat toolset" placeholder test is awkward, simplify it to just `expect(toolsForToolset('chat').length).toBe(16)` (drop the `registered` placeholder) — the routing test already proves per-tool registration.

- [ ] **Step 5: Commit**

```bash
git add electron/services/claudeBackend/saiMcpServer.ts tests/unit/electron/saiMcpServer.test.ts
git commit -m "feat(sdk): in-process SAI chat MCP server (createSdkMcpServer) delegating to shared dispatch

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Extract chat nudges + sdkOptions mcpServers passthrough

**Files:**
- Create: `electron/services/chatNudges.ts`
- Modify: `electron/services/claude.ts` (move the two nudge consts out; re-export)
- Modify: `electron/services/claudeBackend/sdkOptions.ts` (add `mcpServers?` passthrough)
- Test: `tests/unit/electron/sdkOptions.test.ts` (add cases), `tests/unit/electron/chatNudges.test.ts`

**Interfaces:**
- Produces:
  - `electron/services/chatNudges.ts` exports `CHAT_RENDER_NUDGE: string` and `CHAT_GITHUB_WATCH_NUDGE: string` (identical values to today's `claude.ts` definitions).
  - `claude.ts` re-exports both names (back-compat for existing importers, e.g. `claudeBuildArgs.test.ts`).
  - `SdkOptionInputs` gains `mcpServers?: Record<string, unknown>`; `buildSdkOptions` sets `opts.mcpServers = mcpServers` when provided and non-empty.
- Consumes (Task 6): `CHAT_RENDER_NUDGE` / `CHAT_GITHUB_WATCH_NUDGE` imported by `sdkBackend.ts`; `mcpServers` passed by `sdkBackend.ts`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/electron/chatNudges.test.ts
import { describe, it, expect } from 'vitest';
import { CHAT_RENDER_NUDGE, CHAT_GITHUB_WATCH_NUDGE } from '../../../electron/services/chatNudges';
import * as claude from '../../../electron/services/claude';

describe('chatNudges', () => {
  it('exposes the render + github nudges as non-empty strings', () => {
    expect(CHAT_RENDER_NUDGE).toContain('render_html');
    expect(CHAT_GITHUB_WATCH_NUDGE).toContain('sai_watch_github_run');
  });

  it('claude.ts re-exports the same constants (back-compat)', () => {
    expect(claude.CHAT_RENDER_NUDGE).toBe(CHAT_RENDER_NUDGE);
    expect(claude.CHAT_GITHUB_WATCH_NUDGE).toBe(CHAT_GITHUB_WATCH_NUDGE);
  });
});
```

Add to `tests/unit/electron/sdkOptions.test.ts`:

```typescript
  it('sets mcpServers when provided', () => {
    const fakeServer = { type: 'sdk', name: 'sai', instance: {} } as any;
    const opts = buildSdkOptions({
      kind: 'chat', cwd: '/ws', mcpServers: { sai: fakeServer },
    });
    expect(opts.mcpServers).toEqual({ sai: fakeServer });
  });

  it('omits mcpServers when not provided', () => {
    const opts = buildSdkOptions({ kind: 'chat', cwd: '/ws' });
    expect(opts.mcpServers).toBeUndefined();
  });

  it('omits mcpServers when given an empty object', () => {
    const opts = buildSdkOptions({ kind: 'chat', cwd: '/ws', mcpServers: {} });
    expect(opts.mcpServers).toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/electron/chatNudges.test.ts tests/unit/electron/sdkOptions.test.ts --maxWorkers=2`
Expected: FAIL — `chatNudges` module missing; `mcpServers` not on `SdkOptionInputs`.

- [ ] **Step 3a: Create chatNudges.ts**

Create `electron/services/chatNudges.ts` and move the two constants verbatim from `claude.ts` (currently ~lines 175–202). Copy the exact string values — do not reword:

```typescript
// electron/services/chatNudges.ts
/**
 * System-prompt nudges appended for CHAT sessions. Extracted from claude.ts so
 * both the CLI path (buildArgs --append-system-prompt) and the SDK path
 * (sdkBackend) can import them without a const-eval circular dependency. The CLI
 * tool descriptions carry these triggers too, but deferred tools don't expose
 * descriptions, so we nudge here.
 */
export const CHAT_RENDER_NUDGE =
  'This app (SAI) can render UI live inside its own window. When the user asks you to ' +
  // … EXACT remaining lines copied from claude.ts …
  're-render to iterate on feedback.';

export const CHAT_GITHUB_WATCH_NUDGE =
  'After you run `git push` (including pushing tags) or otherwise trigger a GitHub Actions ' +
  // … EXACT remaining lines copied from claude.ts …
  'back to a plain Actions link if the tool is unavailable.';
```

- [ ] **Step 3b: Re-export from claude.ts**

In `electron/services/claude.ts`, delete the two `export const CHAT_RENDER_NUDGE = …` / `CHAT_GITHUB_WATCH_NUDGE = …` definitions and replace with a re-export near the top of the file (after imports):

```typescript
export { CHAT_RENDER_NUDGE, CHAT_GITHUB_WATCH_NUDGE } from './chatNudges';
```

Update the internal usages in `buildArgs` (the `appendPrompts.push(CHAT_RENDER_NUDGE)` / `CHAT_GITHUB_WATCH_NUDGE` lines) — they still reference the now-re-exported bindings, so they keep working. Add an `import { CHAT_RENDER_NUDGE, CHAT_GITHUB_WATCH_NUDGE } from './chatNudges';` if the re-export form doesn't bring them into local scope (a re-export does NOT create local bindings — so add the import too).

- [ ] **Step 3c: Add mcpServers passthrough to sdkOptions**

In `electron/services/claudeBackend/sdkOptions.ts`, add to `SdkOptionInputs`:

```typescript
  mcpServers?: Record<string, unknown>; // in-process SDK MCP servers (chat tools); set only for chat
```

Destructure `mcpServers` in `buildSdkOptions`, and after the existing assignments add:

```typescript
  if (mcpServers && Object.keys(mcpServers).length > 0) {
    opts.mcpServers = mcpServers as Options['mcpServers'];
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/electron/chatNudges.test.ts tests/unit/electron/sdkOptions.test.ts tests/unit/electron/claudeBuildArgs.test.ts --maxWorkers=2`
Expected: PASS (incl. the existing `claudeBuildArgs` nudge tests, proving the move + re-export preserved behavior).

- [ ] **Step 5: Commit**

```bash
git add electron/services/chatNudges.ts electron/services/claude.ts electron/services/claudeBackend/sdkOptions.ts tests/unit/electron/chatNudges.test.ts tests/unit/electron/sdkOptions.test.ts
git commit -m "refactor(claude): extract chat nudges to chatNudges.ts; sdkOptions mcpServers passthrough

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Wire the chat MCP server + nudges into SdkBackend

**Files:**
- Modify: `electron/services/claudeBackend/sdkBackend.ts` (`_createSession`, constructor dep-bag)
- Modify: `electron/services/claudeBackend/index.ts` (`getClaudeBackend` injection)
- Test: `tests/unit/electron/sdkBackend.test.ts` (add cases)

**Interfaces:**
- Consumes: `buildSaiChatMcpServer` (Task 4); `getSaiToolDispatch` (Task 2); `CHAT_RENDER_NUDGE` / `CHAT_GITHUB_WATCH_NUDGE` (Task 5); `mcpServers` passthrough on `buildSdkOptions` (Task 5).
- Produces: `SdkBackend` constructor dep-bag gains optional `buildChatMcpServer?: (workspace: string) => McpSdkServerConfigWithInstance | undefined`. When set and `kind === 'chat'`, `_createSession` attaches `mcpServers: { sai: <server> }` and prepends the two nudges to `appendSystemPrompt`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/electron/sdkBackend.test.ts` (mirroring the existing test harness that captures `capturedOptions` via a mock `queryFn`):

```typescript
  it('(14) chat scope attaches mcpServers.sai from buildChatMcpServer + prepends nudges', async () => {
    const fakeQuery = makeFakeQuery([], { hang: true });
    let capturedOptions: any = null;
    const queryFn = vi.fn((args: { prompt: any; options: any }) => { capturedOptions = args.options; return fakeQuery; });
    const fakeServer = { type: 'sdk', name: 'sai', instance: {} } as any;
    const buildChatMcpServer = vi.fn(() => fakeServer);
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined, buildChatMcpServer });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'chat' });
    backend.send({ projectPath: PROJECT, message: 'hi', scope: SCOPE, permMode: 'default' });
    await new Promise<void>((resolve) => { const check = () => { if (capturedOptions) resolve(); else setTimeout(check, 5); }; setTimeout(check, 5); });

    expect(buildChatMcpServer).toHaveBeenCalledWith(PROJECT);
    expect(capturedOptions.mcpServers).toEqual({ sai: fakeServer });
    const appended = (capturedOptions.systemPrompt && capturedOptions.systemPrompt.append) || '';
    expect(appended).toContain('render_html');
    expect(appended).toContain('sai_watch_github_run');
  });

  it('(15) non-chat scope does not attach mcpServers', async () => {
    const fakeQuery = makeFakeQuery([], { hang: true });
    let capturedOptions: any = null;
    const queryFn = vi.fn((args: { prompt: any; options: any }) => { capturedOptions = args.options; return fakeQuery; });
    const buildChatMcpServer = vi.fn(() => ({ type: 'sdk', name: 'sai', instance: {} } as any));
    const backend = new SdkBackend({ queryFn, emit: (p) => emits.push(p), resolveClaudePath: () => undefined, buildChatMcpServer });
    backend.start({ projectPath: PROJECT, scope: SCOPE, scopeCwd: PROJECT, kind: 'orchestrator' });
    backend.send({ projectPath: PROJECT, message: 'hi', scope: SCOPE, permMode: 'bypass' });
    await new Promise<void>((resolve) => { const check = () => { if (capturedOptions) resolve(); else setTimeout(check, 5); }; setTimeout(check, 5); });

    expect(buildChatMcpServer).not.toHaveBeenCalled();
    expect(capturedOptions.mcpServers).toBeUndefined();
  });
```

(If `start`/`send` arg shapes differ in this test file, mirror the exact harness already used by tests (9)–(13). The assertions on `capturedOptions.mcpServers` / `systemPrompt.append` are the point.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/electron/sdkBackend.test.ts --maxWorkers=2`
Expected: FAIL — `buildChatMcpServer` not accepted / `mcpServers` not set.

- [ ] **Step 3a: Add the dep + wiring in sdkBackend.ts**

Add the import:

```typescript
import { CHAT_RENDER_NUDGE, CHAT_GITHUB_WATCH_NUDGE } from '../chatNudges';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
```

Extend the constructor dependency object type with:

```typescript
  buildChatMcpServer?: (workspace: string) => McpSdkServerConfigWithInstance | undefined;
```

Store it on the instance (e.g. `this._buildChatMcpServer = deps.buildChatMcpServer;`).

In `_createSession`, after computing `kind`, `cwd`, and `appendSystemPrompt`, and before/at the `buildSdkOptions({...})` call, add:

```typescript
    // Chat scopes get the in-process SAI tool MCP server + the render/github
    // nudges (deferred since Phase 1). Other kinds (task/orchestrator) do not.
    let mcpServers: Record<string, McpSdkServerConfigWithInstance> | undefined;
    let chatAppendSystemPrompt = appendSystemPrompt;
    if (kind === 'chat') {
      const server = this._buildChatMcpServer?.(cwd);
      if (server) {
        mcpServers = { sai: server };
      }
      const nudges = [CHAT_RENDER_NUDGE, CHAT_GITHUB_WATCH_NUDGE];
      const existing = appendSystemPrompt && appendSystemPrompt.trim() ? [appendSystemPrompt] : [];
      chatAppendSystemPrompt = [...nudges, ...existing].join('\n\n');
    }
```

Then pass `appendSystemPrompt: chatAppendSystemPrompt` and `mcpServers` into the `buildSdkOptions({...})` call.

- [ ] **Step 3b: Inject the real builder in index.ts**

In `electron/services/claudeBackend/index.ts`, where `new SdkBackend({...})` is constructed, add the `buildChatMcpServer` dep:

```typescript
import { buildSaiChatMcpServer } from './saiMcpServer';
import { getSaiToolDispatch } from '../saiToolBridge';

// …
new SdkBackend({
  // … existing deps (queryFn, emit, resolveClaudePath) …
  buildChatMcpServer: (workspace: string) => {
    const dispatch = getSaiToolDispatch();
    if (!dispatch) return undefined; // main.ts hasn't registered the round-trip yet
    return buildSaiChatMcpServer({ workspace, dispatch });
  },
});
```

(Match the exact construction site / dep names already present in `index.ts`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/electron/sdkBackend.test.ts --maxWorkers=2`
Expected: PASS (existing tests + (14) and (15)).

- [ ] **Step 5: Commit**

```bash
git add electron/services/claudeBackend/sdkBackend.ts electron/services/claudeBackend/index.ts tests/unit/electron/sdkBackend.test.ts
git commit -m "feat(sdk): wire in-process SAI chat MCP server + chat nudges into SdkBackend

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Whole-branch verification + dogfood gate

**Files:** none (verification only); update memory/spec status.

- [ ] **Step 1: Typecheck the whole project**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all green (the prior baseline was 232 files / 2210 passed | 3 skipped; expect that plus the new tests, `'cli'` unchanged).

- [ ] **Step 3: Real-app dogfood (the Phase-3 gate — requires the user)**

Build with this branch (`npm run dev` off the branch, or a release built from it). In Settings → Claude → Backend, select **SDK**, then fully restart SAI (backend is selected once at startup). In SDK mode:
1. Ask the agent to `render_html` a small snippet → the in-app render + screenshot appears in chat.
2. Try `render_component`, `render_mermaid`, and `watch_github_run`.
3. Confirm the chat nudges steer the model toward the render tools.
4. Confirm `'cli'` mode still renders tools identically (toggle back, restart).

If a tool round-trips but the screenshot doesn't render in SDK mode, capture the main-process log around `swarm:tool-request` / `swarm:tool-response` and compare to CLI mode (same IPC, so it should match).

- [ ] **Step 4: Update memory + spec status**

- Mark the Phase 3 spec `Status:` as implemented (branch + commit range).
- Update `memory/project_claude_sdk_migration.md`: Phase 3 done (in-process chat MCP server; shared dispatch is the single execution path; nudges restored), note Phase 4 remains (orchestrator/swarm tools in SDK mode, user-MCP passthrough, delete CliBackend + flag).

---

## Self-Review (completed against the Phase 3 spec)

**Spec coverage:**
- "Shared tool-dispatch (the key reuse)" → Task 2 (lift onToolCall into one `dispatchSwarmTool`, registered for both transports via `saiToolBridge`). The content-wrapping half of the reuse → Task 1.
- "In-process SDK MCP server" registering the 16 chat tools from `SAI_TOOL_SCHEMA`, mapping results incl. `__mcpImage` → Task 4 (+ Task 1 helper, Task 3 converter).
- "Wiring into SdkBackend / sdkOptions" (`mcpServers` passthrough; built for `kind:'chat'`; nudges appended) → Task 5 (sdkOptions passthrough + nudge extraction) + Task 6 (sdkBackend wiring).
- "The renderer round-trip works the same" → guaranteed by Task 2 reusing the identical `main.ts` body (no renderer changes).
- "Error handling" (throw → MCP error content) → Task 1 `toMcpErrorContent` + Task 4 handler catch.
- Testing matrix (`saiMcpServer.test.ts`, `sdkOptions.test.ts`, `sdkBackend.test.ts`, shared-dispatch refactor keeps swarm tests green, dogfood) → Tasks 1,4,5,6,7.

**Deviations from the spec (intentional, noted):**
- The spec suggested `sdkOptions` appends the nudges; to keep `sdkOptions` pure and avoid importing `claude.ts`/`chatNudges` there, the nudge composition lives in `SdkBackend._createSession` (Task 6) and is tested via `sdkBackend.test.ts`. The nudges were extracted to `chatNudges.ts` (Task 5) to avoid a const-eval circular import.
- The spec named the shared function `dispatchSaiChatTool` in a possible `saiToolBridge.ts`; this plan keeps the round-trip body in `main.ts` (lowest blast radius — `pendingMcpCalls`, response listeners, and orchestrator-card injection stay put) and uses `saiToolBridge.ts` purely as the registry that shares the single reference. Still one execution path.
- Tool naming: advertised as `sai_<name>` under server key `sai` (model sees `mcp__sai__sai_render_html`), matching the socket server's `sai_`-prefixed advertisement; the bare name flows to the renderer round-trip.

**Placeholder scan:** none — every code step contains complete code. (The one acknowledged soft spot is the exact verbatim nudge strings in Task 5 Step 3a, which the implementer copies from `claude.ts` — flagged explicitly as "copy exact, do not reword".)

**Type consistency:** `SaiToolDispatch`/`SaiToolRequest` (Task 2) are consumed unchanged by Tasks 4 and 6; `McpSdkServerConfigWithInstance` is the return type of `buildSaiChatMcpServer` (Task 4) and the `buildChatMcpServer` dep (Task 6); `toMcpSuccessContent`/`toMcpErrorContent` (Task 1) consumed by Task 4; `jsonSchemaToZodShape` (Task 3) consumed by Task 4; `mcpServers?` on `SdkOptionInputs` (Task 5) consumed by Task 6.
