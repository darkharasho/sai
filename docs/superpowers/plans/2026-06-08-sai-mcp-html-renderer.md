# SAI MCP + In-App HTML/Component Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the in-app chat agent render model-authored HTML mocks (sandboxed) or registered project components, see a faithful screenshot of the result, and iterate live in the chat card / a pop-out preview panel.

**Architecture:** Add a `SaiToolRegistry` (shared schema module) and generalize the existing swarm MCP server to expose registry tools filtered by a toolset env var. The chat session is launched with this MCP config. Tool calls flow over the existing host socket → main → renderer; a renderer-side `saiToolDispatcher` updates a `renderStore`, React renders into the tool-call card and a preview panel, then main captures the render region with `webContents.capturePage()` and the PNG is returned to the agent as an MCP image content block.

**Tech Stack:** TypeScript, React, Electron, `@modelcontextprotocol/sdk` (stdio JSON-RPC), Vitest (unit/integration), Playwright (e2e via `/test-harness`).

**Spec:** `docs/superpowers/specs/2026-06-08-sai-mcp-html-renderer-design.md`

---

## File Structure

**New files**
- `src/lib/saiTools.ts` — `SAI_TOOL_SCHEMA` registry (name, description, input_schema, toolset). Importable by both the MCP server (Node) and the renderer.
- `src/render/componentRegistry.ts` — prod-safe allow-list `key → { component }`. Consumed by both the renderer dispatcher and the test-harness.
- `src/render/renderStore.ts` — tiny subscribe/snapshot store keyed by `renderId`.
- `src/render/saiToolDispatcher.ts` — pure routing of a SAI tool request → render store mutation + capture request descriptor.
- `src/components/Chat/RenderToolCard.tsx` — inline live render (iframe or component) + "Pop out" button.
- `src/components/Chat/RenderPreviewPanel.tsx` — roomy panel mirroring the active render.
- `src/test-harness/stories/sai-render.tsx` — harness story driving `RenderToolCard`.
- `tests/e2e/sai-render.spec.ts` — e2e for the render surface.

**Modified files**
- `electron/swarm-mcp-server.ts` — list/dispatch SAI tools (toolset-filtered) alongside swarm tools; support image content results.
- `electron/services/swarmMcpConfig.ts` — add a `toolset` env var to the generated config.
- `electron/services/claude.ts` — attach the MCP config to `kind: 'chat'` sessions with toolset `chat`.
- `electron/main.ts` — `capturePage` IPC + route `sai_*` tool requests to the renderer.
- `src/test-harness/stories.ts` — register the new story.

**Toolset model:** `SAI_TOOL_SCHEMA` entries carry `toolset: 'chat' | 'orchestrator' | 'both'`. The MCP server reads `SAI_MCP_TOOLSET` (default `orchestrator` to preserve current behavior) and lists only matching tools. Swarm tools are `orchestrator`; render tools are `chat`.

---

## Phase 1 — Tool registry framework

### Task 1: SAI tool registry module

**Files:**
- Create: `src/lib/saiTools.ts`
- Test: `src/lib/saiTools.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/saiTools.test.ts
import { describe, it, expect } from 'vitest';
import { SAI_TOOL_SCHEMA, toolsForToolset, SAI_TOOL_NAMES } from './saiTools';

describe('saiTools registry', () => {
  it('includes render_html and render_component in the chat toolset', () => {
    const names = toolsForToolset('chat').map((t) => t.name);
    expect(names).toContain('render_html');
    expect(names).toContain('render_component');
  });

  it('excludes chat-only tools from the orchestrator toolset', () => {
    const names = toolsForToolset('orchestrator').map((t) => t.name);
    expect(names).not.toContain('render_html');
  });

  it('every tool declares an object input_schema and a toolset', () => {
    for (const t of SAI_TOOL_SCHEMA) {
      expect(t.input_schema.type).toBe('object');
      expect(['chat', 'orchestrator', 'both']).toContain(t.toolset);
    }
  });

  it('SAI_TOOL_NAMES is the set of all tool names', () => {
    expect(SAI_TOOL_NAMES.has('render_html')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/saiTools.test.ts --maxWorkers=2`
Expected: FAIL — `Cannot find module './saiTools'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/saiTools.ts
export type SaiToolset = 'chat' | 'orchestrator' | 'both';

export interface SaiToolDef {
  name: string;
  description: string;
  toolset: SaiToolset;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

export const SAI_TOOL_SCHEMA: SaiToolDef[] = [
  {
    name: 'render_html',
    description:
      'Render a self-contained HTML/CSS/JS mock inside SAI and return a screenshot. Use for sketching UI. The mock runs sandboxed and cannot access the app.',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        html: { type: 'string', description: 'Full snippet; may include <style> and <script>.' },
        title: { type: 'string', description: 'Label shown on the card/panel.' },
        width: { type: 'number', description: 'Viewport width in px (default 360).' },
        background: { type: 'string', description: 'Canvas background behind the mock.' },
      },
      required: ['html'],
    },
  },
  {
    name: 'render_component',
    description:
      'Mount a registered SAI project component with props and return a screenshot. Use to iterate on real components. Only allow-listed components can be mounted.',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        component: { type: 'string', description: "Registry key, e.g. 'WorkspaceSquircle'." },
        props: { type: 'object', description: 'JSON props passed to the component.' },
        width: { type: 'number' },
        background: { type: 'string' },
      },
      required: ['component'],
    },
  },
];

export const SAI_TOOL_NAMES = new Set(SAI_TOOL_SCHEMA.map((t) => t.name));

export function toolsForToolset(toolset: SaiToolset): SaiToolDef[] {
  return SAI_TOOL_SCHEMA.filter((t) => t.toolset === toolset || t.toolset === 'both');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/saiTools.test.ts --maxWorkers=2`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/saiTools.ts src/lib/saiTools.test.ts
git commit -m "feat(sai-tools): add SAI tool registry with toolset filtering"
```

---

### Task 2: Component registry (allow-list)

**Files:**
- Create: `src/render/componentRegistry.ts`
- Test: `src/render/componentRegistry.test.ts`
- Modify: `src/test-harness/stories.ts` (consume the registry — see Task 11)

- [ ] **Step 1: Write the failing test**

```typescript
// src/render/componentRegistry.test.ts
import { describe, it, expect } from 'vitest';
import { componentRegistry, getRegisteredComponent, registeredComponentKeys } from './componentRegistry';

describe('componentRegistry', () => {
  it('registers WorkspaceSquircle', () => {
    expect(getRegisteredComponent('WorkspaceSquircle')).toBeTruthy();
  });

  it('returns null for unknown keys', () => {
    expect(getRegisteredComponent('Nope')).toBeNull();
  });

  it('exposes the list of keys', () => {
    expect(registeredComponentKeys()).toContain('WorkspaceSquircle');
    expect(registeredComponentKeys()).toEqual(Object.keys(componentRegistry));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/render/componentRegistry.test.ts --maxWorkers=2`
Expected: FAIL — `Cannot find module './componentRegistry'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/render/componentRegistry.ts
import type React from 'react';
import { WorkspaceSquircle } from '../components/shared/WorkspaceSquircle';

export interface RegisteredComponent {
  component: React.ComponentType<any>;
}

export const componentRegistry: Record<string, RegisteredComponent> = {
  WorkspaceSquircle: { component: WorkspaceSquircle },
};

export function getRegisteredComponent(key: string): RegisteredComponent | null {
  return componentRegistry[key] ?? null;
}

export function registeredComponentKeys(): string[] {
  return Object.keys(componentRegistry);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/render/componentRegistry.test.ts --maxWorkers=2`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/componentRegistry.ts src/render/componentRegistry.test.ts
git commit -m "feat(render): add allow-list component registry"
```

---

## Phase 2 — Renderer-side dispatch + store

### Task 3: Render store

**Files:**
- Create: `src/render/renderStore.ts`
- Test: `src/render/renderStore.test.ts`

The store follows the subscribe/getSnapshot shape used by `src/renderer-remote/lib/workspaceStatusStore.ts` so it can back a `useSyncExternalStore` hook later.

- [ ] **Step 1: Write the failing test**

```typescript
// src/render/renderStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderStore, type RenderEntry } from './renderStore';

beforeEach(() => renderStore._resetForTests());

describe('renderStore', () => {
  it('upserts an entry and exposes it by id', () => {
    const entry: RenderEntry = { renderId: 'r1', kind: 'html', payload: { html: '<b>hi</b>' }, title: 'T', width: 360, status: 'rendering' };
    renderStore.upsert(entry);
    expect(renderStore.get('r1')).toEqual(entry);
  });

  it('merges status updates onto an existing entry', () => {
    renderStore.upsert({ renderId: 'r1', kind: 'html', payload: { html: 'x' }, title: 'T', width: 360, status: 'rendering' });
    renderStore.patch('r1', { status: 'ready' });
    expect(renderStore.get('r1')?.status).toBe('ready');
    expect(renderStore.get('r1')?.payload).toEqual({ html: 'x' });
  });

  it('notifies subscribers on change', () => {
    let count = 0;
    const unsub = renderStore.subscribe(() => { count++; });
    renderStore.upsert({ renderId: 'r1', kind: 'html', payload: { html: 'x' }, title: 'T', width: 360, status: 'rendering' });
    expect(count).toBe(1);
    unsub();
    renderStore.patch('r1', { status: 'ready' });
    expect(count).toBe(1);
  });

  it('tracks the active (most recently upserted) render id', () => {
    renderStore.upsert({ renderId: 'a', kind: 'html', payload: { html: '' }, title: '', width: 360, status: 'ready' });
    renderStore.upsert({ renderId: 'b', kind: 'html', payload: { html: '' }, title: '', width: 360, status: 'ready' });
    expect(renderStore.activeId()).toBe('b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/render/renderStore.test.ts --maxWorkers=2`
Expected: FAIL — `Cannot find module './renderStore'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/render/renderStore.ts
export type RenderKind = 'html' | 'component';
export type RenderStatus = 'rendering' | 'ready' | 'error';

export interface RenderEntry {
  renderId: string;
  kind: RenderKind;
  /** For html: { html }. For component: { component, props }. */
  payload: Record<string, unknown>;
  title: string;
  width: number;
  background?: string;
  status: RenderStatus;
  error?: string;
}

type Listener = () => void;

const entries = new Map<string, RenderEntry>();
const listeners = new Set<Listener>();
let active: string | null = null;

function emit(): void {
  for (const l of listeners) l();
}

export const renderStore = {
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get(id: string): RenderEntry | undefined {
    return entries.get(id);
  },
  activeId(): string | null {
    return active;
  },
  upsert(entry: RenderEntry): void {
    entries.set(entry.renderId, entry);
    active = entry.renderId;
    emit();
  },
  patch(id: string, partial: Partial<RenderEntry>): void {
    const cur = entries.get(id);
    if (!cur) return;
    entries.set(id, { ...cur, ...partial });
    emit();
  },
  _resetForTests(): void {
    entries.clear();
    listeners.clear();
    active = null;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/render/renderStore.test.ts --maxWorkers=2`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/renderStore.ts src/render/renderStore.test.ts
git commit -m "feat(render): add render store keyed by renderId"
```

---

### Task 4: SAI tool dispatcher (pure routing)

**Files:**
- Create: `src/render/saiToolDispatcher.ts`
- Test: `src/render/saiToolDispatcher.test.ts`

This function validates input and produces a `RenderEntry` (pushed into the store by the caller) plus a normalized `{ ok, error? }`. It does NOT capture — capture is requested by the wiring layer (Task 7) after React paints. Unknown components return an error listing valid keys.

- [ ] **Step 1: Write the failing test**

```typescript
// src/render/saiToolDispatcher.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderStore } from './renderStore';
import { dispatchSaiRenderTool } from './saiToolDispatcher';

beforeEach(() => renderStore._resetForTests());

describe('dispatchSaiRenderTool', () => {
  it('render_html upserts an html entry and returns ok with the renderId', () => {
    const res = dispatchSaiRenderTool('render_html', { html: '<b>hi</b>', title: 'T' }, 'rid-1');
    expect(res.ok).toBe(true);
    const e = renderStore.get('rid-1');
    expect(e?.kind).toBe('html');
    expect(e?.payload).toEqual({ html: '<b>hi</b>' });
    expect(e?.width).toBe(360); // default
  });

  it('render_html rejects missing html', () => {
    const res = dispatchSaiRenderTool('render_html', {}, 'rid-2');
    expect(res).toEqual({ ok: false, error: 'render_html requires a non-empty "html" string' });
    expect(renderStore.get('rid-2')).toBeUndefined();
  });

  it('render_component upserts a component entry for a known key', () => {
    const res = dispatchSaiRenderTool('render_component', { component: 'WorkspaceSquircle', props: { state: 'busy-done' } }, 'rid-3');
    expect(res.ok).toBe(true);
    expect(renderStore.get('rid-3')?.payload).toEqual({ component: 'WorkspaceSquircle', props: { state: 'busy-done' } });
  });

  it('render_component rejects unknown component and lists valid keys', () => {
    const res = dispatchSaiRenderTool('render_component', { component: 'Nope' }, 'rid-4');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('unknown component: Nope');
    expect(res.error).toContain('WorkspaceSquircle');
  });

  it('rejects an unknown tool name', () => {
    const res = dispatchSaiRenderTool('render_potato', {}, 'rid-5');
    expect(res).toEqual({ ok: false, error: 'unknown tool: render_potato' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/render/saiToolDispatcher.test.ts --maxWorkers=2`
Expected: FAIL — `Cannot find module './saiToolDispatcher'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/render/saiToolDispatcher.ts
import { renderStore } from './renderStore';
import { getRegisteredComponent, registeredComponentKeys } from './componentRegistry';

export interface DispatchResult {
  ok: boolean;
  error?: string;
}

const DEFAULT_WIDTH = 360;

export function dispatchSaiRenderTool(name: string, input: any, renderId: string): DispatchResult {
  const inp = input ?? {};
  const width = typeof inp.width === 'number' && inp.width > 0 ? inp.width : DEFAULT_WIDTH;
  const background = typeof inp.background === 'string' ? inp.background : undefined;
  const title = typeof inp.title === 'string' ? inp.title : '';

  switch (name) {
    case 'render_html': {
      if (typeof inp.html !== 'string' || inp.html.length === 0) {
        return { ok: false, error: 'render_html requires a non-empty "html" string' };
      }
      renderStore.upsert({ renderId, kind: 'html', payload: { html: inp.html }, title, width, background, status: 'rendering' });
      return { ok: true };
    }
    case 'render_component': {
      if (typeof inp.component !== 'string' || inp.component.length === 0) {
        return { ok: false, error: 'render_component requires a "component" string' };
      }
      if (!getRegisteredComponent(inp.component)) {
        return { ok: false, error: `unknown component: ${inp.component}. Available: ${registeredComponentKeys().join(', ')}` };
      }
      const props = inp.props && typeof inp.props === 'object' ? inp.props : {};
      renderStore.upsert({ renderId, kind: 'component', payload: { component: inp.component, props }, title, width, background, status: 'rendering' });
      return { ok: true };
    }
    default:
      return { ok: false, error: `unknown tool: ${name}` };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/render/saiToolDispatcher.test.ts --maxWorkers=2`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/saiToolDispatcher.ts src/render/saiToolDispatcher.test.ts
git commit -m "feat(render): add pure SAI render-tool dispatcher"
```

---

## Phase 3 — MCP server + session wiring

### Task 5: Serve SAI tools from the MCP server (toolset-filtered)

**Files:**
- Modify: `electron/swarm-mcp-server.ts`
- Test: `electron/swarm-mcp-server.test.ts` (add cases; create the file if absent)

The server already serves `swarm_*` tools. Add `sai_*` tools from `toolsForToolset(env)`, dispatched through the same `transport`. Also: when a dispatched result carries `__mcpImage`, append an MCP image content block so the agent sees the screenshot.

- [ ] **Step 1: Write the failing test**

```typescript
// electron/swarm-mcp-server.test.ts  (add these; keep any existing tests)
import { describe, it, expect } from 'vitest';
import { handleRequest, setToolset } from './swarm-mcp-server';

const noopTransport = { call: async () => ({ ok: true }) };

describe('sai tools over MCP', () => {
  it('lists sai_render_html when toolset=chat', async () => {
    setToolset('chat');
    const res: any = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, noopTransport);
    const names = res.result.tools.map((t: any) => t.name);
    expect(names).toContain('sai_render_html');
    expect(names).not.toContain('swarm_spawn_task');
  });

  it('lists swarm tools when toolset=orchestrator', async () => {
    setToolset('orchestrator');
    const res: any = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, noopTransport);
    const names = res.result.tools.map((t: any) => t.name);
    expect(names).toContain('swarm_spawn_task');
    expect(names).not.toContain('sai_render_html');
  });

  it('dispatches a sai_ tool call through the transport', async () => {
    setToolset('chat');
    const calls: Array<{ tool: string; input: unknown }> = [];
    const transport = { call: async (tool: string, input: unknown) => { calls.push({ tool, input }); return { ok: true }; } };
    const res: any = await handleRequest(
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'sai_render_html', arguments: { html: '<b>x</b>' } } },
      transport,
    );
    expect(calls).toEqual([{ tool: 'render_html', input: { html: '<b>x</b>' } }]);
    expect(res.result.content[0].type).toBe('text');
  });

  it('appends an image content block when the result carries __mcpImage', async () => {
    setToolset('chat');
    const transport = { call: async () => ({ renderId: 'r', __mcpImage: { base64: 'AAAA', mimeType: 'image/png' } }) };
    const res: any = await handleRequest(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'sai_render_component', arguments: { component: 'WorkspaceSquircle' } } },
      transport,
    );
    const img = res.result.content.find((c: any) => c.type === 'image');
    expect(img).toEqual({ type: 'image', data: 'AAAA', mimeType: 'image/png' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/swarm-mcp-server.test.ts --maxWorkers=2`
Expected: FAIL — `setToolset` not exported / `sai_render_html` not listed.

- [ ] **Step 3: Write minimal implementation**

In `electron/swarm-mcp-server.ts`, add the import and a toolset state near the top:

```typescript
import { toolsForToolset, SAI_TOOL_NAMES, type SaiToolset } from '../src/lib/saiTools';

let toolset: SaiToolset = (process.env.SAI_MCP_TOOLSET as SaiToolset) || 'orchestrator';
export function setToolset(t: SaiToolset): void { toolset = t; }
```

Replace `listTools()` so it emits swarm tools only for the orchestrator toolset and sai tools per the registry:

```typescript
function listTools() {
  const tools: Array<{ name: string; description: string; inputSchema: unknown }> = [];
  if (toolset === 'orchestrator') {
    for (const tool of SWARM_TOOL_SCHEMA) {
      tools.push({ name: `swarm_${tool.name}`, description: tool.description, inputSchema: tool.input_schema });
    }
  }
  for (const tool of toolsForToolset(toolset)) {
    tools.push({ name: `sai_${tool.name}`, description: tool.description, inputSchema: tool.input_schema });
  }
  return { tools };
}
```

In the `tools/call` case, accept the `sai_` prefix in addition to `swarm_`, and build content from the result (with optional image block). Replace the call body:

```typescript
case 'tools/call': {
  if (isNotification) return null;
  const params = (req.params ?? {}) as { name?: unknown; arguments?: unknown };
  const fullName = typeof params.name === 'string' ? params.name : '';
  const input = (params.arguments ?? {}) as unknown;

  let toolName: string | null = null;
  if (fullName.startsWith('swarm_') && SWARM_TOOL_NAMES.has(fullName.slice(6))) {
    toolName = fullName.slice(6);
  } else if (fullName.startsWith('sai_') && SAI_TOOL_NAMES.has(fullName.slice(4))) {
    toolName = fullName.slice(4);
  }
  if (!toolName) {
    return { jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool: ${fullName}` } };
  }

  try {
    const result = (await transport.call(toolName, input)) as any;
    const content: Array<Record<string, unknown>> = [];
    const image = result && typeof result === 'object' ? result.__mcpImage : undefined;
    const textPayload = image ? { ...result, __mcpImage: undefined } : result;
    content.push({ type: 'text', text: JSON.stringify(textPayload) });
    if (image && typeof image.base64 === 'string') {
      content.push({ type: 'image', data: image.base64, mimeType: image.mimeType ?? 'image/png' });
    }
    return { jsonrpc: '2.0', id, result: { content } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: msg }], isError: true } };
  }
}
```

In `main()`, set the toolset from env before the stdio loop (after `setEnv(env)`):

```typescript
  setToolset((process.env.SAI_MCP_TOOLSET as SaiToolset) || 'orchestrator');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/swarm-mcp-server.test.ts --maxWorkers=2`
Expected: PASS (existing tests + 4 new).

- [ ] **Step 5: Commit**

```bash
git add electron/swarm-mcp-server.ts electron/swarm-mcp-server.test.ts
git commit -m "feat(mcp): serve toolset-filtered SAI tools with image content support"
```

---

### Task 6: Pass a toolset to the generated MCP config + attach to chat sessions

**Files:**
- Modify: `electron/services/swarmMcpConfig.ts`
- Modify: `electron/services/claude.ts:130-200` (`buildArgs`)
- Test: `electron/services/swarmMcpConfig.test.ts` (add a case; create if absent), `electron/services/claude.buildArgs.test.ts` (add a case if a buildArgs test exists; otherwise create)

- [ ] **Step 1: Write the failing test**

```typescript
// electron/services/swarmMcpConfig.test.ts (add)
import { describe, it, expect } from 'vitest';
import { buildSwarmMcpConfig } from './swarmMcpConfig';

describe('buildSwarmMcpConfig toolset', () => {
  it('writes SAI_MCP_TOOLSET into the server env', () => {
    const cfg = buildSwarmMcpConfig({
      socketPath: '/tmp/s.sock', secret: 'sec', workspace: '/w',
      mcpServerScriptPath: '/app/swarm-mcp-server.js', electronExecPath: '/elec',
      toolset: 'chat',
    });
    expect(cfg.mcpServers.swarm.env.SAI_MCP_TOOLSET).toBe('chat');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/services/swarmMcpConfig.test.ts --maxWorkers=2`
Expected: FAIL — `toolset` not accepted / env missing.

- [ ] **Step 3: Write minimal implementation**

In `electron/services/swarmMcpConfig.ts`, extend the input and env:

```typescript
export interface SwarmMcpConfigInput {
  socketPath: string;
  secret: string;
  workspace: string;
  mcpServerScriptPath: string;
  electronExecPath: string;
  /** Which tool set the spawned server exposes. Defaults to 'orchestrator'. */
  toolset?: 'chat' | 'orchestrator' | 'both';
}

export function buildSwarmMcpConfig(input: SwarmMcpConfigInput) {
  return {
    mcpServers: {
      swarm: {
        command: input.electronExecPath,
        args: [input.mcpServerScriptPath],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          SAI_SWARM_SOCKET_PATH: input.socketPath,
          SAI_SWARM_SECRET: input.secret,
          SAI_SWARM_WORKSPACE: input.workspace,
          SAI_MCP_TOOLSET: input.toolset ?? 'orchestrator',
        },
      },
    },
  };
}
```

Then in `electron/services/claude.ts` `buildArgs`, attach the MCP config for chat sessions (the orchestrator branch already does this for its kind). Locate where `kind === 'orchestrator'` builds `--mcp-config`; add a sibling for `kind === 'chat'` that passes `toolset: 'chat'` and does NOT pass `--strict-mcp-config`/`--tools ''` (chat keeps its built-in tools). Concretely, after the existing orchestrator mcp-config block, add:

```typescript
  // Chat sessions get SAI-native tools (render_html / render_component) via an
  // MCP config, but keep all built-in tools (no --strict-mcp-config).
  if (kind === 'chat' && workspace) {
    const handle = getMcpHandle();
    const cfgPath = writeMcpConfig({
      socketPath: handle.socketPath,
      secret: handle.secret,
      workspace,
      mcpServerScriptPath: resolveMcpServerScriptPath(),
      electronExecPath: resolveElectronExecPath(),
      toolset: 'chat',
    });
    args.push('--mcp-config', cfgPath);
  }
```

(If `writeMcpConfig`'s type does not yet allow `toolset`, it now does after the change above.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/services/swarmMcpConfig.test.ts --maxWorkers=2`
Expected: PASS.

Also run any existing buildArgs tests to confirm no regression:
Run: `npx vitest run electron/services/ --maxWorkers=2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/swarmMcpConfig.ts electron/services/claude.ts electron/services/swarmMcpConfig.test.ts
git commit -m "feat(mcp): attach SAI chat toolset MCP config to chat sessions"
```

---

### Task 7: `capturePage` IPC + route `sai_*` tool requests to the renderer

**Files:**
- Modify: `electron/main.ts:459-498` (the `onToolCall` handler) and add a `capturePage` IPC handler.
- Modify: `electron/preload.ts` (expose `sai.captureRegion` and the render request channel)
- Test: `electron/capturePage.test.ts` (unit test the rect-clamping helper)

Main already forwards swarm tool calls to the renderer via `swarm:tool-request` and resolves on `swarm:tool-response`. SAI render tools ride the **same** channel — the renderer's existing `swarm:tool-request` listener will be extended in Task 8 to recognize `render_*` tools. The only new main-side piece is a `capturePage(rect)` IPC the renderer calls after paint.

- [ ] **Step 1: Write the failing test**

```typescript
// electron/capturePage.test.ts
import { describe, it, expect } from 'vitest';
import { clampRect } from './capturePage';

describe('clampRect', () => {
  it('rounds and clamps a rect to the page bounds', () => {
    expect(clampRect({ x: 10.4, y: 20.6, width: 100.2, height: 50.9 }, { width: 800, height: 600 }))
      .toEqual({ x: 10, y: 21, width: 100, height: 51 });
  });

  it('never returns negative origin or zero size', () => {
    expect(clampRect({ x: -5, y: -5, width: 0, height: 0 }, { width: 800, height: 600 }))
      .toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('clamps width/height to remain inside the page', () => {
    expect(clampRect({ x: 790, y: 0, width: 100, height: 10 }, { width: 800, height: 600 }))
      .toEqual({ x: 790, y: 0, width: 10, height: 10 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/capturePage.test.ts --maxWorkers=2`
Expected: FAIL — `Cannot find module './capturePage'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// electron/capturePage.ts
export interface Rect { x: number; y: number; width: number; height: number; }

export function clampRect(rect: Rect, page: { width: number; height: number }): Rect {
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  const maxW = Math.max(1, page.width - x);
  const maxH = Math.max(1, page.height - y);
  const width = Math.min(maxW, Math.max(1, Math.round(rect.width)));
  const height = Math.min(maxH, Math.max(1, Math.round(rect.height)));
  return { x, y, width, height };
}
```

Then wire the IPC in `electron/main.ts` (near the other `ipcMain.handle` registrations, where `mainWindow` is in scope):

```typescript
import { clampRect, type Rect } from './capturePage';

ipcMain.handle('sai:capture-region', async (_evt, rect: Rect): Promise<string | null> => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const bounds = mainWindow.getContentBounds();
  const clamped = clampRect(rect, { width: bounds.width, height: bounds.height });
  const image = await mainWindow.webContents.capturePage(clamped);
  return image.toPNG().toString('base64'); // bare base64, no data: prefix
});
```

Expose it in `electron/preload.ts` alongside the other `sai.*` methods:

```typescript
  captureRegion: (rect: { x: number; y: number; width: number; height: number }): Promise<string | null> =>
    ipcRenderer.invoke('sai:capture-region', rect),
```

(Add the matching method signature to the `Sai` interface / `window.sai` typing wherever the preload type lives.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/capturePage.test.ts --maxWorkers=2`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/capturePage.ts electron/capturePage.test.ts electron/main.ts electron/preload.ts
git commit -m "feat(capture): add clamped capture-region IPC for render screenshots"
```

---

## Phase 4 — Renderer integration + UI

### Task 8: Renderer handler that dispatches render tools and captures

**Files:**
- Create: `src/render/handleRenderToolRequest.ts`
- Test: `src/render/handleRenderToolRequest.test.ts`

This bridges the incoming `swarm:tool-request` for `render_*` tools to the store + capture. The capture function and a "wait for render region" function are injected so the unit test needs no DOM.

- [ ] **Step 1: Write the failing test**

```typescript
// src/render/handleRenderToolRequest.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderStore } from './renderStore';
import { handleRenderToolRequest } from './handleRenderToolRequest';

beforeEach(() => renderStore._resetForTests());

describe('handleRenderToolRequest', () => {
  const deps = {
    captureRenderRegion: async (_id: string) => ({ base64: 'PNGDATA', mimeType: 'image/png' as const }),
  };

  it('returns ok + __mcpImage and marks the entry ready', async () => {
    const res: any = await handleRenderToolRequest({ tool: 'render_html', input: { html: '<b>x</b>' }, renderId: 'r1' }, deps);
    expect(res.ok).toBe(true);
    expect(res.renderId).toBe('r1');
    expect(res.__mcpImage).toEqual({ base64: 'PNGDATA', mimeType: 'image/png' });
    expect(renderStore.get('r1')?.status).toBe('ready');
  });

  it('returns the validation error and does not capture for bad input', async () => {
    const res: any = await handleRenderToolRequest({ tool: 'render_html', input: {}, renderId: 'r2' }, deps);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('requires a non-empty');
    expect(res.__mcpImage).toBeUndefined();
  });

  it('marks the entry error and returns the message if capture throws', async () => {
    const res: any = await handleRenderToolRequest(
      { tool: 'render_component', input: { component: 'WorkspaceSquircle' }, renderId: 'r3' },
      { captureRenderRegion: async () => { throw new Error('capture failed'); } },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe('capture failed');
    expect(renderStore.get('r3')?.status).toBe('error');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/render/handleRenderToolRequest.test.ts --maxWorkers=2`
Expected: FAIL — `Cannot find module './handleRenderToolRequest'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/render/handleRenderToolRequest.ts
import { renderStore } from './renderStore';
import { dispatchSaiRenderTool } from './saiToolDispatcher';

export interface CapturedImage { base64: string; mimeType: 'image/png'; }

export interface RenderToolDeps {
  /** Waits for the render region to paint, then returns its screenshot. */
  captureRenderRegion: (renderId: string) => Promise<CapturedImage>;
}

export interface RenderToolRequest { tool: string; input: any; renderId: string; }

export async function handleRenderToolRequest(req: RenderToolRequest, deps: RenderToolDeps) {
  const dispatch = dispatchSaiRenderTool(req.tool, req.input, req.renderId);
  if (!dispatch.ok) {
    return { ok: false, error: dispatch.error };
  }
  try {
    const image = await deps.captureRenderRegion(req.renderId);
    renderStore.patch(req.renderId, { status: 'ready' });
    return { ok: true, renderId: req.renderId, __mcpImage: image };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    renderStore.patch(req.renderId, { status: 'error', error: msg });
    return { ok: false, error: msg };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/render/handleRenderToolRequest.test.ts --maxWorkers=2`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/handleRenderToolRequest.ts src/render/handleRenderToolRequest.test.ts
git commit -m "feat(render): bridge render tool requests to store + capture"
```

---

### Task 9: `RenderToolCard` — live inline render + capture region

**Files:**
- Create: `src/components/Chat/RenderToolCard.tsx`
- Test: covered by the e2e harness in Task 12 (this is a DOM/visual component).

This component reads a `RenderEntry` from the store (via `useSyncExternalStore`) and renders either a sandboxed iframe (html) or the registered component. It exposes a stable `data-render-region` element whose bounding rect the capture path measures.

- [ ] **Step 1: Implement the component**

```tsx
// src/components/Chat/RenderToolCard.tsx
import { useSyncExternalStore } from 'react';
import { renderStore, type RenderEntry } from '../../render/renderStore';
import { getRegisteredComponent } from '../../render/componentRegistry';

const SANDBOX_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:;";

function useRenderEntry(renderId: string): RenderEntry | undefined {
  return useSyncExternalStore(renderStore.subscribe, () => renderStore.get(renderId));
}

export function RenderToolCard({ renderId, onPopOut }: { renderId: string; onPopOut?: (id: string) => void }) {
  const entry = useRenderEntry(renderId);
  if (!entry) return null;

  return (
    <div className="sai-render-card" data-testid="render-tool-card">
      <div className="sai-render-card__bar">
        <span className="sai-render-card__title">{entry.title || entry.kind}</span>
        {entry.status === 'error' && <span className="sai-render-card__err">{entry.error}</span>}
        {onPopOut && (
          <button type="button" onClick={() => onPopOut(renderId)} aria-label="Pop out render">Pop out ↗</button>
        )}
      </div>
      <RenderRegion entry={entry} />
    </div>
  );
}

export function RenderRegion({ entry }: { entry: RenderEntry }) {
  const style: React.CSSProperties = {
    width: entry.width,
    background: entry.background ?? 'var(--sai-surface, #1a1a1a)',
    display: 'inline-block',
  };
  return (
    <div data-render-region={entry.renderId} data-testid="render-region" style={style}>
      {entry.kind === 'html' ? (
        <iframe
          title={entry.title || 'render'}
          sandbox="allow-scripts"
          csp={SANDBOX_CSP as unknown as string}
          style={{ width: '100%', border: 0 }}
          srcDoc={String((entry.payload as { html: string }).html)}
        />
      ) : (
        <MountComponent payload={entry.payload as { component: string; props: Record<string, unknown> }} />
      )}
    </div>
  );
}

function MountComponent({ payload }: { payload: { component: string; props: Record<string, unknown> } }) {
  const reg = getRegisteredComponent(payload.component);
  if (!reg) return <div className="sai-render-card__err">unknown component: {payload.component}</div>;
  const Cmp = reg.component;
  return <Cmp {...payload.props} />;
}
```

- [ ] **Step 2: Add minimal styles**

Create `src/components/Chat/RenderToolCard.css` and import it at the top of `RenderToolCard.tsx` (`import './RenderToolCard.css';`):

```css
.sai-render-card { border: 1px solid var(--sai-border, #333); border-radius: 8px; overflow: hidden; }
.sai-render-card__bar { display: flex; align-items: center; gap: 8px; padding: 4px 8px; font-size: 12px; background: var(--sai-surface-2, #222); }
.sai-render-card__title { font-weight: 600; }
.sai-render-card__err { color: #f87171; }
.sai-render-card__bar button { margin-left: auto; font-size: 12px; cursor: pointer; }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors). If `csp` is rejected on `iframe`, change the prop to be applied via a ref/`setAttribute` in a `useEffect` instead.

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat/RenderToolCard.tsx src/components/Chat/RenderToolCard.css
git commit -m "feat(render): RenderToolCard live inline render surface"
```

---

### Task 10: Capture-region implementation (DOM → main IPC) + wiring into the swarm tool listener

**Files:**
- Create: `src/render/captureRenderRegion.ts`
- Modify: the renderer module that handles `swarm:tool-request` (the existing swarm dispatcher wiring — find it via `grep -rn "swarm:tool-request" src/`). Add a branch: if `tool` starts with `render_`, call `handleRenderToolRequest` with the real capture dep and respond on `swarm:tool-response`.

- [ ] **Step 1: Implement captureRenderRegion**

```typescript
// src/render/captureRenderRegion.ts
import type { CapturedImage } from './handleRenderToolRequest';

const PAINT_SETTLE_MS = 120;

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

/** Waits for paint + fonts, measures the render region, asks main to capture it. */
export async function captureRenderRegion(renderId: string): Promise<CapturedImage> {
  await nextFrame();
  await nextFrame();
  if (document.fonts?.ready) { try { await document.fonts.ready; } catch { /* noop */ } }
  await new Promise((r) => setTimeout(r, PAINT_SETTLE_MS));

  const el = document.querySelector(`[data-render-region="${renderId}"]`) as HTMLElement | null;
  if (!el) throw new Error(`render region ${renderId} not found in DOM`);
  const r = el.getBoundingClientRect();
  const base64 = await window.sai.captureRegion({ x: r.x, y: r.y, width: r.width, height: r.height });
  if (!base64) throw new Error('capture returned no image');
  return { base64, mimeType: 'image/png' };
}
```

- [ ] **Step 2: Wire into the swarm tool-request listener**

In the renderer module that currently listens for `swarm:tool-request` and calls `handleSwarmToolRequest`, add a guard BEFORE the swarm path:

```typescript
import { handleRenderToolRequest } from '../render/handleRenderToolRequest';
import { captureRenderRegion } from '../render/captureRenderRegion';

// inside the swarm:tool-request handler, given { id, tool, input }:
if (typeof tool === 'string' && tool.startsWith('render_')) {
  const result = await handleRenderToolRequest({ tool, input, renderId: id }, { captureRenderRegion });
  window.sai.swarmToolResponse(id, result); // same channel swarm uses to respond
  return;
}
```

(Use the existing response method name found in the swarm wiring; the swarm path already calls something equivalent to `swarm:tool-response`. Reuse it verbatim.)

- [ ] **Step 3: Typecheck + run the full unit suite**

Run: `npx tsc --noEmit && npx vitest run --maxWorkers=2`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/render/captureRenderRegion.ts src/<renderer-swarm-wiring-file>
git commit -m "feat(render): capture render region and route render_* tool calls"
```

---

### Task 11: Preview panel + pop-out, and harness consumes the component registry

**Files:**
- Create: `src/components/Chat/RenderPreviewPanel.tsx`
- Modify: `src/test-harness/stories.ts` (and `src/test-harness/index.tsx` only if needed) to source components from `componentRegistry` so harness + agent share one list.
- Modify: wherever app panels are registered (find via `grep -rn "terminal" src/App.tsx` and the panel layout) to add the preview panel + a pop-out action that sets the panel's active render id.

- [ ] **Step 1: Implement RenderPreviewPanel**

```tsx
// src/components/Chat/RenderPreviewPanel.tsx
import { useSyncExternalStore } from 'react';
import { renderStore } from '../../render/renderStore';
import { RenderRegion } from './RenderToolCard';

export function RenderPreviewPanel({ renderId }: { renderId?: string }) {
  const activeId = useSyncExternalStore(renderStore.subscribe, () => renderStore.activeId());
  const id = renderId ?? activeId ?? undefined;
  const entry = id ? renderStore.get(id) : undefined;
  if (!entry) {
    return <div style={{ padding: 16, opacity: 0.6 }}>No render yet. Ask the agent to render something.</div>;
  }
  return (
    <div data-testid="render-preview-panel" style={{ padding: 16, overflow: 'auto' }}>
      <RenderRegion entry={entry} />
    </div>
  );
}
```

- [ ] **Step 2: Make the harness consume the registry**

Update `src/test-harness/stories.ts` so component-only stories pull from `componentRegistry`. Keep `parseProps` wrappers where stories need URL→props parsing. Minimum change — add a generic registry-backed story:

```typescript
import { componentRegistry } from '../render/componentRegistry';
// ...existing imports/stories...

// Generic registry-backed story: /test-harness?story=registry&component=WorkspaceSquircle&props={...}
const registryStory: Story = {
  component: ({ component, props }: { component: string; props: Record<string, unknown> }) => {
    const reg = componentRegistry[component];
    if (!reg) return null;
    const Cmp = reg.component;
    return <Cmp {...props} />;
  },
  parseProps: (params) => ({
    component: params.get('component') ?? '',
    props: JSON.parse(params.get('props') ?? '{}'),
  }),
};

export const stories: Record<string, Story> = {
  'workspace-squircle': workspaceSquircleStory,
  'tool-result-image': toolResultImageStory,
  registry: registryStory,
};
```

(Convert `stories.ts` to `stories.tsx` since it now contains JSX, and update its import in `index.tsx`/`main.tsx` if the extension changes.)

- [ ] **Step 3: Register the panel + pop-out**

In the app shell where code/terminal panels are declared, add a "Preview" panel that renders `<RenderPreviewPanel />`. Wire `RenderToolCard`'s `onPopOut` (Task 9) to open/focus that panel. Follow the existing panel registration pattern exactly (do not invent a new layout system).

- [ ] **Step 4: Typecheck + run unit suite + build**

Run: `npx tsc --noEmit && npx vitest run --maxWorkers=2 && npm run build`
Expected: PASS (build must succeed since the harness/registry are now in the prod graph).

- [ ] **Step 5: Commit**

```bash
git add src/components/Chat/RenderPreviewPanel.tsx src/test-harness/ src/App.tsx
git commit -m "feat(render): preview panel, pop-out, and harness/registry sharing"
```

---

### Task 12: E2e — render surface mounts and panel mirrors

**Files:**
- Create: `src/test-harness/stories/sai-render.tsx`
- Create: `tests/e2e/sai-render.spec.ts`
- Modify: `src/test-harness/stories.tsx` (register `sai-render`)

The story seeds the store with one html render and one component render and shows the card; the spec asserts iframe + component mount and that the preview panel mirrors the active render. (Capture/IPC is not exercised here — it needs Electron; covered conceptually by the unit tests in Tasks 7–8.)

- [ ] **Step 1: Write the story**

```tsx
// src/test-harness/stories/sai-render.tsx
import { useEffect, useState } from 'react';
import { renderStore } from '../../render/renderStore';
import { RenderToolCard } from '../../components/Chat/RenderToolCard';
import { RenderPreviewPanel } from '../../components/Chat/RenderPreviewPanel';

function SaiRenderHarness({ kind }: { kind: 'html' | 'component' }) {
  const [id] = useState(() => `story-${kind}`);
  useEffect(() => {
    renderStore._resetForTests();
    if (kind === 'html') {
      renderStore.upsert({ renderId: id, kind: 'html', payload: { html: '<b id="mock">hello mock</b>' }, title: 'HTML', width: 320, status: 'ready' });
    } else {
      renderStore.upsert({ renderId: id, kind: 'component', payload: { component: 'WorkspaceSquircle', props: { state: 'busy-done' } }, title: 'Component', width: 320, status: 'ready' });
    }
  }, [id, kind]);
  return (
    <div style={{ display: 'flex', gap: 24 }}>
      <RenderToolCard renderId={id} onPopOut={() => {}} />
      <RenderPreviewPanel />
    </div>
  );
}

export const saiRenderStory = {
  component: SaiRenderHarness,
  parseProps: (params: URLSearchParams) => ({ kind: (params.get('kind') ?? 'html') as 'html' | 'component' }),
};
```

Register it in `src/test-harness/stories.tsx`: add `import { saiRenderStory } from './stories/sai-render';` and `'sai-render': saiRenderStory,`.

- [ ] **Step 2: Write the failing e2e spec**

```typescript
// tests/e2e/sai-render.spec.ts
import { test, expect } from './test';

test('html mock renders in card and mirrors in panel', async ({ harness }) => {
  const el = await harness.render('sai-render', { kind: 'html' });
  const card = el.locator('[data-testid="render-tool-card"]');
  await expect(card).toBeVisible();
  // iframe present with the mock content
  const iframe = card.locator('iframe');
  await expect(iframe).toHaveCount(1);
  await expect(iframe.contentFrame().locator('#mock')).toHaveText('hello mock');
  // panel mirrors the active render
  await expect(el.locator('[data-testid="render-preview-panel"]')).toBeVisible();
});

test('component mock mounts WorkspaceSquircle busy-done', async ({ harness }) => {
  const el = await harness.render('sai-render', { kind: 'component' });
  await expect(el.locator('[data-testid="render-tool-card"] .ws-sq-busy-done-wrap')).toBeVisible();
});
```

- [ ] **Step 3: Run the e2e to verify it passes**

Run: `npx playwright test sai-render --reporter=line`
Expected: PASS (2 tests). If the harness `stories.ts`→`stories.tsx` rename broke the import in `main.tsx`, fix the import path and re-run.

- [ ] **Step 4: Run the full e2e suite for regressions**

Run: `npx playwright test workspace-squircle sai-render --reporter=line`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/test-harness/stories/sai-render.tsx src/test-harness/stories.tsx tests/e2e/sai-render.spec.ts
git commit -m "test(e2e): render surface mounts html mock + component and mirrors in panel"
```

---

## Final verification

- [ ] Run the whole suite: `npx tsc --noEmit && npx vitest run --maxWorkers=2 && npx playwright test --reporter=line`
- [ ] Manual smoke (optional, real Electron): launch the app, ask the chat agent to "render an HTML mock of a yellow card", confirm it appears in the tool-call card, pops out to the panel, and the agent receives a screenshot in its tool result.

---

## Self-Review

**Spec coverage:**
- SAI tool-registration layer → Task 1 (`saiTools.ts`) + Task 5 (server lists registry, toolset-filtered). ✓
- Generalize swarm MCP server → Task 5. ✓
- Attach MCP config to the chat session → Task 6. ✓
- `render_html` (sandboxed iframe, JS allowed, CSP) → Task 4 (validation/store), Task 9 (`sandbox="allow-scripts"` + CSP). ✓
- `render_component` (allow-list registry, props) → Task 2 + Task 4 + Task 9. ✓
- Component registry shared with harness → Task 2 + Task 11. ✓
- Live inline card + pop-out → Task 9 + Task 11. ✓
- Preview panel mirroring active render → Task 11. ✓
- Real-pixel `capturePage` screenshot back to agent as image → Task 7 (IPC), Task 8 (bridge), Task 5 (MCP image content block). ✓
- Error handling (validation, capture failure, unknown component) → Tasks 4, 8. ✓
- Testing (unit/integration/e2e) → Tasks 1–8 unit/integration, Task 12 e2e. ✓
- Non-goals (offscreen process, freezeAtMs, arbitrary paths) → not implemented, as intended. ✓

**Placeholder scan:** Two tasks reference "the existing swarm tool-request wiring file" (Task 10) and "where panels are registered" (Task 11) by `grep` rather than a fixed path — these are repo-specific locations the implementer must confirm; the grep command is given so it is actionable, not a vague TODO. All code blocks are complete.

**Type consistency:** `RenderEntry`, `CapturedImage`, `dispatchSaiRenderTool`, `handleRenderToolRequest`, `renderStore.{upsert,patch,get,activeId,subscribe}`, `captureRegion`/`captureRenderRegion`, and the `__mcpImage: { base64, mimeType }` shape are used identically across Tasks 3–10 and the MCP server in Task 5. `toolset` values `'chat' | 'orchestrator' | 'both'` match between `saiTools.ts`, `swarmMcpConfig.ts`, and the server.
