# Brainstorm-a-New-Project Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CLI-spawning, JSON-scraping brainstorm flow with an SDK-backed conversation that builds a project brief via a validated `update_brief` MCP tool, shown in a full-window two-pane takeover, with deterministic Create and auto-kickoff of the first dev session.

**Architecture:** The brief is built *during* conversation: an in-process SDK MCP server exposes `update_brief`; every accepted call merges into a brief object in the main process and streams to the renderer over IPC. Create reads the brief — no model call, no parsing. The old `NewProjectModal` (tabs, synthesize, replace-prompt) is replaced by a takeover surface: chat left, live click-to-edit brief right.

**Tech Stack:** Electron (main + preload IPC), `@anthropic-ai/claude-agent-sdk` (`query`, `createSdkMcpServer`, `tool`), zod, React 18 (inline-style idiom), vitest (+ @testing-library/react), Playwright e2e via `tests/e2e/test.ts` harness.

**Spec:** `docs/superpowers/specs/2026-07-18-brainstorm-overhaul-design.md`

## Global Constraints

- `projectName`: kebab-case (`/^[a-z][a-z0-9-]*$/`), ≤ 40 chars. Required for Create along with non-empty `summary`.
- Question budget: one question per turn, at most 5 total; after name + summary + goals are covered the model presents the draft, sets `ready: true`, and stops asking.
- Brief edit conflicts: last-writer-wins; user edits are injected into the model's context on the next turn.
- No cross-restart persistence of brainstorms; closing with a non-empty brief asks for confirmation.
- Vitest: never exceed `--maxWorkers=2` (repo `vitest.config.ts` already pins forks to 2 — do not override upward).
- Run unit tests as: `npx vitest run --project unit <file>` (integration: `--project integration`).
- Commit after every task (steps include the exact commands).
- Electron modules must not be touched at module scope in `electron/services/**` (unit tests import these files outside Electron).
- New-code visual idiom: inline styles + CSS vars from `src/styles/globals.css` (`--surface-1/2/3`, `--border-subtle`, `--accent`, `--accent-dim`, `--text`, `--text-secondary`, `--text-muted`), 120ms ease transitions, JetBrains Mono for mono accents. Approved mockup: `/tmp/sai-brainstorm-mockup.html` (also reproduced in the spec's UI section).

## File Structure

| Path | Role |
|---|---|
| `electron/services/brainstorm/brief.ts` | **Create.** Pure brief domain: types, validation+merge, creatability, seed/CLAUDE.md rendering |
| `electron/services/brainstorm/prompts.ts` | **Create.** The convergence system prompt |
| `electron/services/brainstorm/briefMcpServer.ts` | **Create.** In-process SDK MCP server exposing `update_brief` |
| `electron/services/brainstorm/index.ts` | **Create.** Session store, SDK turn runner, IPC handlers (replaces old service; keeps `registerBrainstormHandlers` name so `electron/main.ts` import path `./services/brainstorm` is unchanged) |
| `electron/services/brainstorm.ts` | **Delete** (Task 4) |
| `electron/preload.ts` | **Modify.** Brief IPC surface; drop `brainstormSynthesize` |
| `electron/services/scaffold.ts` | **Modify.** Brief-aware CLAUDE.md/README/seed |
| `src/components/NewProjectTakeover/useBrainstormBrief.ts` | **Create.** Renderer hook: messages, streaming, brief, edits |
| `src/components/NewProjectTakeover/ConversationPane.tsx` | **Create.** Left pane |
| `src/components/NewProjectTakeover/BriefPane.tsx` | **Create.** Right pane incl. setup disclosure + Create button |
| `src/components/NewProjectTakeover/NewProjectTakeover.tsx` | **Create.** Container + create flow |
| `src/components/NewProjectModal.tsx`, `src/components/NewProjectModal/` | **Delete** (Task 8) |
| `src/App.tsx:5554-5562` | **Modify.** Render takeover instead of modal |
| `src/components/Chat/ChatPanel.tsx` | **No change** — seed auto-send already exists (`ChatPanel.tsx:713-741`) |

Tests: create `tests/unit/brief.test.ts`, `tests/unit/briefMcpServer.test.ts`, `tests/unit/brainstorm.service.test.ts`, `tests/unit/useBrainstormBrief.test.tsx`, `tests/unit/NewProjectTakeover.test.tsx`, `tests/e2e/new-project-takeover.spec.ts`. Modify `tests/unit/preload.test.ts`, `tests/integration/scaffold.brainstorm.test.ts`. Delete `tests/unit/brainstorm.args.test.ts`, `tests/unit/brainstorm.stream.test.ts`, `tests/unit/brainstorm.synthesize.test.ts`, `tests/unit/brainstorm.session.test.ts` (session tests are re-homed into `brainstorm.service.test.ts`), `tests/unit/NewProjectModal.brainstorm.test.tsx`.

---

### Task 1: Brief domain logic

**Files:**
- Create: `electron/services/brainstorm/brief.ts`
- Test: `tests/unit/brief.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (used by Tasks 2–8):
  - `interface StackItem { name: string; rationale: string }`
  - `interface ProjectBrief { projectName: string | null; summary: string | null; goals: string[]; nonGoals: string[]; stack: StackItem[]; openQuestions: string[]; ready: boolean }`
  - `createEmptyBrief(): ProjectBrief`
  - `type BriefUpdateResult = { ok: true; brief: ProjectBrief } | { ok: false; errors: string[] }`
  - `applyBriefUpdate(current: ProjectBrief, patch: unknown): BriefUpdateResult` — all-or-nothing validated merge; provided fields replace, absent fields keep current; unknown keys ignored.
  - `briefIsCreatable(brief: ProjectBrief): boolean` — non-null `projectName` + `summary`.
  - `renderSeedMarkdown(brief: ProjectBrief, transcript: string): string`
  - `renderClaudeMdContext(brief: ProjectBrief): string`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/brief.test.ts
import { describe, it, expect } from 'vitest';
import {
  createEmptyBrief, applyBriefUpdate, briefIsCreatable,
  renderSeedMarkdown, renderClaudeMdContext, type ProjectBrief,
} from '../../electron/services/brainstorm/brief';

const full = (): ProjectBrief => ({
  projectName: 'folder-janitor',
  summary: 'A tray app that sorts downloads by rules.',
  goals: ['Watch Downloads', 'Editable rules'],
  nonGoals: ['Cloud sync'],
  stack: [{ name: 'Tauri', rationale: 'tiny footprint' }],
  openQuestions: ['Conflict behavior?'],
  ready: true,
});

describe('createEmptyBrief', () => {
  it('starts null/empty/not-ready', () => {
    expect(createEmptyBrief()).toEqual({
      projectName: null, summary: null, goals: [], nonGoals: [],
      stack: [], openQuestions: [], ready: false,
    });
  });
});

describe('applyBriefUpdate', () => {
  it('merges provided fields and keeps the rest', () => {
    const r = applyBriefUpdate(full(), { summary: 'New summary.', ready: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.brief.summary).toBe('New summary.');
    expect(r.brief.ready).toBe(false);
    expect(r.brief.projectName).toBe('folder-janitor');
    expect(r.brief.goals).toEqual(['Watch Downloads', 'Editable rules']);
  });

  it('does not mutate the input brief', () => {
    const cur = full();
    applyBriefUpdate(cur, { summary: 'changed' });
    expect(cur.summary).toBe('A tray app that sorts downloads by rules.');
  });

  it('replaces arrays wholesale (no append)', () => {
    const r = applyBriefUpdate(full(), { goals: ['Only goal'] });
    expect(r.ok && r.brief.goals).toEqual(['Only goal']);
  });

  it('ignores unknown keys', () => {
    const r = applyBriefUpdate(full(), { bogus: 1, summary: 'ok then' });
    expect(r.ok && r.brief.summary).toBe('ok then');
    expect(r.ok && (r.brief as any).bogus).toBeUndefined();
  });

  it.each([
    ['UpperCase', { projectName: 'FolderJanitor' }],
    ['spaces', { projectName: 'folder janitor' }],
    ['leading digit', { projectName: '1janitor' }],
    ['too long', { projectName: 'a'.repeat(41) }],
    ['empty', { projectName: '' }],
  ])('rejects bad projectName (%s)', (_label, patch) => {
    const r = applyBriefUpdate(createEmptyBrief(), patch);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(' ')).toMatch(/projectName/);
  });

  it('rejects non-string summary and empty-string array entries, listing every error', () => {
    const r = applyBriefUpdate(createEmptyBrief(), { summary: 42, goals: ['ok', ''] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBe(2);
  });

  it('rejects malformed stack entries', () => {
    const r = applyBriefUpdate(createEmptyBrief(), { stack: [{ name: 'Tauri' }] });
    expect(r.ok).toBe(false);
  });

  it('rejects non-object patches', () => {
    expect(applyBriefUpdate(createEmptyBrief(), 'nope').ok).toBe(false);
    expect(applyBriefUpdate(createEmptyBrief(), null).ok).toBe(false);
  });

  it('accepts a valid full patch onto an empty brief', () => {
    const r = applyBriefUpdate(createEmptyBrief(), full());
    expect(r.ok && r.brief).toEqual(full());
  });
});

describe('briefIsCreatable', () => {
  it('requires projectName and summary', () => {
    expect(briefIsCreatable(createEmptyBrief())).toBe(false);
    expect(briefIsCreatable({ ...createEmptyBrief(), projectName: 'x' })).toBe(false);
    expect(briefIsCreatable({ ...createEmptyBrief(), projectName: 'x', summary: 's' })).toBe(true);
  });
});

describe('renderSeedMarkdown', () => {
  it('contains kickoff instruction, brief sections, open questions, and transcript', () => {
    const md = renderSeedMarkdown(full(), '**User:** hi\n\n**Assistant:** hello');
    expect(md).toMatch(/propose an implementation plan/i);
    expect(md).toContain('# Project brief: folder-janitor');
    expect(md).toContain('A tray app that sorts downloads by rules.');
    expect(md).toContain('- Watch Downloads');
    expect(md).toContain('## Out of scope');
    expect(md).toContain('**Tauri** — tiny footprint');
    expect(md).toContain('## Open questions');
    expect(md).toContain('Conflict behavior?');
    expect(md).toContain('## Brainstorm transcript');
    expect(md).toContain('**User:** hi');
  });

  it('omits empty sections and the transcript when blank', () => {
    const md = renderSeedMarkdown(
      { ...createEmptyBrief(), projectName: 'x', summary: 'S.' }, '');
    expect(md).not.toContain('## Out of scope');
    expect(md).not.toContain('## Open questions');
    expect(md).not.toContain('## Brainstorm transcript');
  });
});

describe('renderClaudeMdContext', () => {
  it('renders Project Context plus brief sections', () => {
    const md = renderClaudeMdContext(full());
    expect(md).toContain('## Project Context');
    expect(md).toContain('A tray app that sorts downloads by rules.');
    expect(md).toContain('## Goals');
    expect(md).toContain('## Out of scope');
    expect(md).toContain('## Suggested stack');
    expect(md).not.toContain('## Open questions'); // open questions live in the seed, not CLAUDE.md
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/unit/brief.test.ts`
Expected: FAIL — cannot resolve `../../electron/services/brainstorm/brief`

- [ ] **Step 3: Implement**

```ts
// electron/services/brainstorm/brief.ts
export interface StackItem { name: string; rationale: string }

export interface ProjectBrief {
  projectName: string | null;
  summary: string | null;
  goals: string[];
  nonGoals: string[];
  stack: StackItem[];
  openQuestions: string[];
  ready: boolean;
}

export function createEmptyBrief(): ProjectBrief {
  return { projectName: null, summary: null, goals: [], nonGoals: [], stack: [], openQuestions: [], ready: false };
}

export type BriefUpdateResult =
  | { ok: true; brief: ProjectBrief }
  | { ok: false; errors: string[] };

const KEBAB = /^[a-z][a-z0-9-]*$/;

function validStringArray(v: unknown, field: string, errors: string[]): v is string[] {
  if (!Array.isArray(v) || v.some(s => typeof s !== 'string' || !s.trim())) {
    errors.push(`${field} must be an array of non-empty strings`);
    return false;
  }
  return true;
}

/**
 * All-or-nothing validated merge. Fields present in the patch replace the
 * current value (arrays wholesale); absent fields are kept; unknown keys are
 * ignored. Any invalid field fails the whole patch — the error strings go
 * back to the model through the tool result so it can correct itself.
 */
export function applyBriefUpdate(current: ProjectBrief, patch: unknown): BriefUpdateResult {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    return { ok: false, errors: ['patch must be an object'] };
  }
  const p = patch as Record<string, unknown>;
  const errors: string[] = [];
  const next: ProjectBrief = {
    ...current,
    goals: [...current.goals],
    nonGoals: [...current.nonGoals],
    stack: current.stack.map(s => ({ ...s })),
    openQuestions: [...current.openQuestions],
  };

  if ('projectName' in p) {
    const v = p.projectName;
    if (typeof v !== 'string' || !KEBAB.test(v) || v.length > 40) {
      errors.push('projectName must be kebab-case (/^[a-z][a-z0-9-]*$/) and at most 40 characters');
    } else next.projectName = v;
  }
  if ('summary' in p) {
    if (typeof p.summary !== 'string' || !p.summary.trim()) {
      errors.push('summary must be a non-empty string');
    } else next.summary = p.summary.trim();
  }
  for (const field of ['goals', 'nonGoals', 'openQuestions'] as const) {
    if (field in p && validStringArray(p[field], field, errors)) {
      next[field] = (p[field] as string[]).map(s => s.trim());
    }
  }
  if ('stack' in p) {
    const v = p.stack;
    const valid = Array.isArray(v) && v.every(item =>
      typeof item === 'object' && item !== null &&
      typeof (item as any).name === 'string' && (item as any).name.trim() &&
      typeof (item as any).rationale === 'string' && (item as any).rationale.trim());
    if (!valid) errors.push('stack must be an array of { name, rationale } with non-empty strings');
    else next.stack = (v as StackItem[]).map(s => ({ name: s.name.trim(), rationale: s.rationale.trim() }));
  }
  if ('ready' in p) {
    if (typeof p.ready !== 'boolean') errors.push('ready must be a boolean');
    else next.ready = p.ready;
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, brief: next };
}

export function briefIsCreatable(brief: ProjectBrief): boolean {
  return !!(brief.projectName && brief.summary);
}

function bullets(items: string[]): string {
  return items.map(i => `- ${i}`).join('\n');
}

function section(title: string, body: string): string {
  return body ? `## ${title}\n\n${body}\n\n` : '';
}

/**
 * The seed becomes the FIRST USER MESSAGE of the new project's chat
 * (auto-sent by ChatPanel's one-shot seed consumption), so it opens with the
 * kickoff instruction and reads as a request, not a document dump.
 */
export function renderSeedMarkdown(brief: ProjectBrief, transcript: string): string {
  let md = 'This project was just created from a brainstorm. Read the brief below, ' +
    'propose an implementation plan, and flag the open questions before writing code.\n\n';
  md += `# Project brief: ${brief.projectName ?? 'untitled'}\n\n`;
  if (brief.summary) md += `${brief.summary}\n\n`;
  md += section('Goals', bullets(brief.goals));
  md += section('Out of scope', bullets(brief.nonGoals));
  md += section('Suggested stack', brief.stack.map(s => `- **${s.name}** — ${s.rationale}`).join('\n'));
  md += section('Open questions', bullets(brief.openQuestions));
  md += section('Brainstorm transcript', transcript.trim());
  return md.trimEnd() + '\n';
}

export function renderClaudeMdContext(brief: ProjectBrief): string {
  let md = `## Project Context\n\n${brief.summary ?? '_No context provided._'}\n\n`;
  md += section('Goals', bullets(brief.goals));
  md += section('Out of scope', bullets(brief.nonGoals));
  md += section('Suggested stack', brief.stack.map(s => `- **${s.name}** — ${s.rationale}`).join('\n'));
  return md.trimEnd() + '\n';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit tests/unit/brief.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add electron/services/brainstorm/brief.ts tests/unit/brief.test.ts
git commit -m "feat(brainstorm): brief domain model with validated merge and rendering"
```

---

### Task 2: `update_brief` MCP server + convergence prompt

**Files:**
- Create: `electron/services/brainstorm/briefMcpServer.ts`
- Create: `electron/services/brainstorm/prompts.ts`
- Test: `tests/unit/briefMcpServer.test.ts`

**Interfaces:**
- Consumes: `applyBriefUpdate`, `ProjectBrief` from Task 1.
- Produces (used by Task 3):
  - `BRIEF_MCP_SERVER_NAME = 'brief'` (model sees the tool as `mcp__brief__update_brief`)
  - `interface BriefMcpDeps { getBrief(): ProjectBrief; setBrief(brief: ProjectBrief): void }`
  - `buildBriefMcpServer(deps: BriefMcpDeps): McpSdkServerConfigWithInstance` — with the same non-enumerable `__handlersForTest: Map<string, (args) => Promise<unknown>>` seam as `saiMcpServer.ts`.
  - `BRAINSTORM_SYSTEM_PROMPT: string` from `prompts.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/briefMcpServer.test.ts
import { describe, it, expect } from 'vitest';
import { buildBriefMcpServer } from '../../electron/services/brainstorm/briefMcpServer';
import { createEmptyBrief, type ProjectBrief } from '../../electron/services/brainstorm/brief';
import { BRAINSTORM_SYSTEM_PROMPT } from '../../electron/services/brainstorm/prompts';

function makeServer() {
  let brief = createEmptyBrief();
  const server = buildBriefMcpServer({
    getBrief: () => brief,
    setBrief: (b: ProjectBrief) => { brief = b; },
  });
  const handler = (server as any).__handlersForTest.get('update_brief');
  return { handler, getBrief: () => brief };
}

describe('buildBriefMcpServer', () => {
  it('exposes exactly the update_brief handler seam', () => {
    const server = buildBriefMcpServer({ getBrief: createEmptyBrief, setBrief: () => {} });
    expect([...(server as any).__handlersForTest.keys()]).toEqual(['update_brief']);
  });

  it('applies a valid patch and returns the merged brief as text content', async () => {
    const { handler, getBrief } = makeServer();
    const res = await handler({ projectName: 'folder-janitor', summary: 'Sorts downloads.' });
    expect(getBrief().projectName).toBe('folder-janitor');
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text).projectName).toBe('folder-janitor');
  });

  it('returns isError with the validation messages and leaves the brief unchanged', async () => {
    const { handler, getBrief } = makeServer();
    const res = await handler({ projectName: 'Bad Name' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/kebab-case/);
    expect(getBrief().projectName).toBeNull();
  });
});

describe('BRAINSTORM_SYSTEM_PROMPT', () => {
  it('encodes the convergence contract', () => {
    expect(BRAINSTORM_SYSTEM_PROMPT).toMatch(/update_brief/);
    expect(BRAINSTORM_SYSTEM_PROMPT).toMatch(/one question per turn/i);
    expect(BRAINSTORM_SYSTEM_PROMPT).toMatch(/at most (5|five)/i);
    expect(BRAINSTORM_SYSTEM_PROMPT).toMatch(/ready/);
    expect(BRAINSTORM_SYSTEM_PROMPT).toMatch(/blockquote/i);
    expect(BRAINSTORM_SYSTEM_PROMPT).not.toMatch(/do not emit JSON/i); // the old self-defeating rule must not return
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/unit/briefMcpServer.test.ts`
Expected: FAIL — cannot resolve `briefMcpServer` / `prompts`

- [ ] **Step 3: Implement both modules**

```ts
// electron/services/brainstorm/prompts.ts
export const BRAINSTORM_SYSTEM_PROMPT = [
  'You are helping the user shape a brand-new software project before its folder is created.',
  'You are building a PROJECT BRIEF as you go, using the mcp__brief__update_brief tool.',
  '',
  'Rules:',
  '- After EVERY user message, call update_brief with everything you have learned or revised',
  '  (projectName kebab-case ≤40 chars, summary 2–4 sentences, goals, nonGoals,',
  '  stack as {name, rationale}, openQuestions).',
  '- Ask at most one question per turn, and at most 5 questions in the whole conversation.',
  '  Prioritize whatever the brief is missing most: purpose → users → scope → stack.',
  '  Format the question as a markdown blockquote (a line starting with "> ") at the end of your reply.',
  '- Once projectName, summary, and goals are covered, STOP asking questions: present the draft',
  '  brief conversationally in one short paragraph, call update_brief with ready: true, and invite',
  '  the user to refine or hit Create. Further turns only refine the brief.',
  '- Record genuinely undecided points in openQuestions instead of asking about everything —',
  '  they are handed to the first dev session, so leaving 1–3 is good, not a failure.',
  '- Never block creation. Never ask permission to update the brief.',
  '- Keep replies concise and conversational: plain prose, no code, no file trees, no lists of options',
  '  longer than 3 items.',
  '- The user may edit the brief directly in the UI; edits appear as [User edited the brief: ...] notes.',
  '  Build on their edits — never revert them.',
].join('\n');
```

```ts
// electron/services/brainstorm/briefMcpServer.ts
import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { applyBriefUpdate, type ProjectBrief } from './brief';

export const BRIEF_MCP_SERVER_NAME = 'brief';

export interface BriefMcpDeps {
  getBrief(): ProjectBrief;
  setBrief(brief: ProjectBrief): void;
}

const UPDATE_BRIEF_SHAPE = {
  projectName: z.string().optional().describe('kebab-case, ≤ 40 chars'),
  summary: z.string().optional().describe('2–4 sentences, CLAUDE.md-ready'),
  goals: z.array(z.string()).optional(),
  nonGoals: z.array(z.string()).optional().describe('explicitly out of scope'),
  stack: z.array(z.object({ name: z.string(), rationale: z.string() })).optional(),
  openQuestions: z.array(z.string()).optional(),
  ready: z.boolean().optional().describe('set true once the brief is complete'),
};

/**
 * In-process MCP server exposing `update_brief`. Fields are merged into the
 * session's brief via applyBriefUpdate; validation failures come back as tool
 * errors so the model self-corrects. `setBrief` is the single write path —
 * the service layer wraps it to emit the IPC brief event.
 */
export function buildBriefMcpServer(deps: BriefMcpDeps): McpSdkServerConfigWithInstance {
  const handlersForTest = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();

  const handler = async (args: Record<string, unknown>) => {
    const result = applyBriefUpdate(deps.getBrief(), args);
    if (!result.ok) {
      return { content: [{ type: 'text', text: `Invalid update_brief call: ${result.errors.join('; ')}` }], isError: true };
    }
    deps.setBrief(result.brief);
    return { content: [{ type: 'text', text: JSON.stringify(result.brief) }] };
  };
  handlersForTest.set('update_brief', handler);

  const tools = [tool(
    'update_brief',
    'Update the project brief with everything learned so far. Call after every user message. Provided fields replace existing values; omitted fields are kept.',
    UPDATE_BRIEF_SHAPE,
    handler as Parameters<typeof tool>[3],
  )];

  const server = createSdkMcpServer({ name: BRIEF_MCP_SERVER_NAME, version: '1.0.0', tools });
  Object.defineProperty(server, '__handlersForTest', { value: handlersForTest, enumerable: false });
  return server;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit tests/unit/briefMcpServer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/services/brainstorm/briefMcpServer.ts electron/services/brainstorm/prompts.ts tests/unit/briefMcpServer.test.ts
git commit -m "feat(brainstorm): update_brief MCP tool and convergence system prompt"
```

---

### Task 3: Brainstorm service rewrite (SDK turn runner + IPC)

**Files:**
- Create: `electron/services/brainstorm/index.ts`
- Test: `tests/unit/brainstorm.service.test.ts`

**Interfaces:**
- Consumes: Task 1 (`ProjectBrief`, `createEmptyBrief`, `applyBriefUpdate`), Task 2 (`buildBriefMcpServer`, `BRIEF_MCP_SERVER_NAME`, `BRAINSTORM_SYSTEM_PROMPT`), `enrichedEnv` from `electron/services/shellEnv`.
- Produces:
  - `interface TranscriptTurn { role: 'user' | 'assistant'; content: string }`
  - `interface BrainstormSession { sessionId: string; transcript: TranscriptTurn[]; brief: ProjectBrief; pendingEdits: string[]; createdAt: number }`
  - `createSession(): { sessionId: string }`, `getSession(id)`, `deleteSession(id)`, `__resetSessions()`
  - `composeTurnPrompt(session: BrainstormSession, userMessage: string): string` — transcript replay + `[User edited the brief: ...]` notes (drains `pendingEdits`).
  - `runTurn(args: { sessionId: string; userMessage: string; onChunk(text: string): void; onBrief(brief: ProjectBrief): void }): Promise<{ ok: true; text: string } | { ok: false; error: string }>`
  - `serializeTranscript(session): string` (same format as before: `**User:** ...` / `**Assistant:** ...`)
  - `__setQueryFnForTest(fn: QueryFn | null)` where `type QueryFn = (args: { prompt: string; options: Record<string, unknown> }) => AsyncIterable<any>`
  - `registerBrainstormHandlers(win: BrowserWindow): void` — channels: `brainstorm:start`, `brainstorm:send`, `brainstorm:getBrief`, `brainstorm:editBrief`, `brainstorm:end`, `brainstorm:consumeSeed`; renderer events `brainstorm:chunk:<sid>`, `brainstorm:done:<sid>`, `brainstorm:error:<sid>`, `brainstorm:brief:<sid>`. **`brainstorm:synthesize` no longer exists.**
- **Electron rule:** import `ipcMain`/`BrowserWindow` only inside `registerBrainstormHandlers` scope usage, exactly as the old file did (top-level `import { ipcMain, BrowserWindow } from 'electron'` is fine — it was already imported at top level and unit tests pass because nothing is *called* at module scope; keep that pattern).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/brainstorm.service.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  __resetSessions, __setQueryFnForTest, createSession, getSession, deleteSession,
  composeTurnPrompt, runTurn, serializeTranscript,
} from '../../electron/services/brainstorm';
import { type ProjectBrief } from '../../electron/services/brainstorm/brief';

afterEach(() => { __setQueryFnForTest(null); __resetSessions(); });
beforeEach(() => __resetSessions());

describe('session store', () => {
  it('creates sessions with empty transcript and empty brief', () => {
    const { sessionId } = createSession();
    const s = getSession(sessionId)!;
    expect(s.transcript).toEqual([]);
    expect(s.brief.projectName).toBeNull();
    expect(s.pendingEdits).toEqual([]);
  });
  it('deleteSession removes the session', () => {
    const { sessionId } = createSession();
    deleteSession(sessionId);
    expect(getSession(sessionId)).toBeUndefined();
  });
});

describe('composeTurnPrompt', () => {
  it('is just the message for a fresh session', () => {
    const { sessionId } = createSession();
    expect(composeTurnPrompt(getSession(sessionId)!, 'hello')).toBe('hello');
  });
  it('replays transcript and drains pending user edits', () => {
    const { sessionId } = createSession();
    const s = getSession(sessionId)!;
    s.transcript.push({ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' });
    s.pendingEdits.push('projectName → "my-tool"');
    const p = composeTurnPrompt(s, 'next');
    expect(p).toContain('User: hi');
    expect(p).toContain('You: yo');
    expect(p).toContain('[User edited the brief: projectName → "my-tool"]');
    expect(p).toContain("User's next message: next");
    expect(s.pendingEdits).toEqual([]);
  });
});

// Fake SDK query(): yields an assistant text message, then invokes the
// update_brief MCP handler the service wired into options.mcpServers, then a result.
function fakeQuery(opts: { text?: string; briefPatch?: Record<string, unknown>; fail?: boolean }) {
  return function query({ options }: { prompt: string; options: any }) {
    return (async function* () {
      if (opts.fail) throw new Error('boom');
      if (opts.briefPatch) {
        const server = options.mcpServers.brief;
        const handler = server.__handlersForTest.get('update_brief');
        await handler(opts.briefPatch);
      }
      if (opts.text) {
        yield { type: 'assistant', message: { content: [{ type: 'text', text: opts.text }] } };
      }
      yield { type: 'result', subtype: 'success' };
    })();
  };
}

describe('runTurn', () => {
  it('streams text, applies brief updates, and appends the transcript', async () => {
    __setQueryFnForTest(fakeQuery({ text: 'Sounds fun!', briefPatch: { projectName: 'toy', summary: 'A toy.' } }) as any);
    const { sessionId } = createSession();
    const chunks: string[] = [];
    const briefs: ProjectBrief[] = [];
    const r = await runTurn({ sessionId, userMessage: 'make a toy', onChunk: c => chunks.push(c), onBrief: b => briefs.push(b) });
    expect(r).toEqual({ ok: true, text: 'Sounds fun!' });
    expect(chunks).toEqual(['Sounds fun!']);
    expect(briefs.length).toBe(1);
    expect(briefs[0].projectName).toBe('toy');
    const s = getSession(sessionId)!;
    expect(s.brief.projectName).toBe('toy');
    expect(s.transcript).toEqual([
      { role: 'user', content: 'make a toy' },
      { role: 'assistant', content: 'Sounds fun!' },
    ]);
  });

  it('reports errors without touching transcript or brief', async () => {
    __setQueryFnForTest(fakeQuery({ fail: true }) as any);
    const { sessionId } = createSession();
    const r = await runTurn({ sessionId, userMessage: 'x', onChunk: () => {}, onBrief: () => {} });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/boom/);
    expect(getSession(sessionId)!.transcript).toEqual([]);
  });

  it('returns an error for unknown sessions', async () => {
    const r = await runTurn({ sessionId: 'nope', userMessage: 'x', onChunk: () => {}, onBrief: () => {} });
    expect(r.ok).toBe(false);
  });
});

describe('serializeTranscript', () => {
  it('formats turns as bold-role markdown', () => {
    const { sessionId } = createSession();
    const s = getSession(sessionId)!;
    s.transcript.push({ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' });
    expect(serializeTranscript(s)).toBe('**User:** a\n\n**Assistant:** b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/unit/brainstorm.service.test.ts`
Expected: FAIL — cannot resolve `../../electron/services/brainstorm` as a module directory with these exports (old `brainstorm.ts` file still shadows; the new `index.ts` doesn't exist yet)

- [ ] **Step 3: Implement the service**

Delete the old file first so `electron/services/brainstorm` resolves to the directory:

```bash
git rm electron/services/brainstorm.ts
git rm tests/unit/brainstorm.args.test.ts tests/unit/brainstorm.stream.test.ts tests/unit/brainstorm.synthesize.test.ts tests/unit/brainstorm.session.test.ts
```

```ts
// electron/services/brainstorm/index.ts
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { ipcMain, BrowserWindow } from 'electron';
import { enrichedEnv } from '../shellEnv';
import { createEmptyBrief, applyBriefUpdate, type ProjectBrief } from './brief';
import { buildBriefMcpServer, BRIEF_MCP_SERVER_NAME } from './briefMcpServer';
import { BRAINSTORM_SYSTEM_PROMPT } from './prompts';

export { type ProjectBrief } from './brief';

export interface TranscriptTurn { role: 'user' | 'assistant'; content: string }

export interface BrainstormSession {
  sessionId: string;
  transcript: TranscriptTurn[];
  brief: ProjectBrief;
  /** Human-readable notes of direct UI edits, injected into the next turn's prompt. */
  pendingEdits: string[];
  createdAt: number;
}

const sessions = new Map<string, BrainstormSession>();

export function createSession(): { sessionId: string } {
  const sessionId = randomUUID();
  sessions.set(sessionId, {
    sessionId, transcript: [], brief: createEmptyBrief(), pendingEdits: [], createdAt: Date.now(),
  });
  return { sessionId };
}

export function getSession(sessionId: string): BrainstormSession | undefined {
  return sessions.get(sessionId);
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
}

/** Test-only — clears in-memory state between tests. */
export function __resetSessions(): void {
  sessions.clear();
}

// Stateless transcript replay (same rationale as the old CLI flow: no reliance
// on cross-process session resume). Pending UI edits are drained into the
// prompt so the model builds on them instead of reverting them.
export function composeTurnPrompt(session: BrainstormSession, userMessage: string): string {
  const edits = session.pendingEdits.splice(0);
  if (session.transcript.length === 0 && edits.length === 0) return userMessage;
  const lines: string[] = ['Conversation so far:', ''];
  for (const turn of session.transcript) {
    lines.push(turn.role === 'user' ? `User: ${turn.content}` : `You: ${turn.content}`);
    lines.push('');
  }
  for (const edit of edits) {
    lines.push(`[User edited the brief: ${edit}]`);
    lines.push('');
  }
  lines.push(`User's next message: ${userMessage}`);
  return lines.join('\n');
}

export function serializeTranscript(session: BrainstormSession): string {
  return session.transcript
    .map(t => `**${t.role === 'user' ? 'User' : 'Assistant'}:** ${t.content}`)
    .join('\n\n');
}

type QueryFn = (args: { prompt: string; options: Record<string, unknown> }) => AsyncIterable<any>;

let queryFnOverride: QueryFn | null = null;
export function __setQueryFnForTest(fn: QueryFn | null): void { queryFnOverride = fn; }

function resolveQueryFn(): QueryFn {
  if (queryFnOverride) return queryFnOverride;
  // Lazy require: keeps unit tests (and app startup) from paying SDK load cost
  // until the first brainstorm turn. Same pattern as sdkBackend.ts.
  return require('@anthropic-ai/claude-agent-sdk').query;
}

interface RunTurnArgs {
  sessionId: string;
  userMessage: string;
  onChunk: (text: string) => void;
  onBrief: (brief: ProjectBrief) => void;
}

type RunTurnResult = { ok: true; text: string } | { ok: false; error: string };

export async function runTurn(args: RunTurnArgs): Promise<RunTurnResult> {
  const session = getSession(args.sessionId);
  if (!session) return { ok: false, error: 'Session not found' };

  const briefServer = buildBriefMcpServer({
    getBrief: () => session.brief,
    setBrief: (b) => { session.brief = b; args.onBrief(b); },
  });

  const prompt = composeTurnPrompt(session, args.userMessage);
  const options = {
    // Full-replacement system prompt: brainstorming is a conversation, not a
    // coding session — no claude_code preset, no project settings, no plugins
    // (mirrors the old --setting-sources '' rationale: SessionStart hooks like
    // superpowers would hijack the turn).
    systemPrompt: BRAINSTORM_SYSTEM_PROMPT,
    settingSources: [] as string[],
    permissionMode: 'bypassPermissions',   // safe: no built-in tools are exposed
    tools: [] as string[],                 // update_brief (MCP) is the only tool
    mcpServers: { [BRIEF_MCP_SERVER_NAME]: briefServer },
    maxTurns: 8,                            // text + a few update_brief calls
    cwd: os.tmpdir(),
    env: enrichedEnv(),
  };

  let fullText = '';
  try {
    const q = resolveQueryFn()({ prompt, options });
    for await (const msg of q) {
      if (msg?.type === 'assistant' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            fullText += block.text;
            args.onChunk(block.text);
          }
        }
      }
    }
  } catch (e: any) {
    console.error('[brainstorm] SDK turn failed:', e);
    return { ok: false, error: e?.message || 'brainstorm turn failed' };
  }

  session.transcript.push({ role: 'user', content: args.userMessage });
  session.transcript.push({ role: 'assistant', content: fullText });
  return { ok: true, text: fullText };
}

export function registerBrainstormHandlers(win: BrowserWindow): void {
  ipcMain.handle('brainstorm:start', () => createSession());

  ipcMain.handle('brainstorm:send', async (_e, sessionId: string, message: string) => {
    const send = (channel: string, payload: unknown) => {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    };
    const result = await runTurn({
      sessionId,
      userMessage: message,
      onChunk: (text) => send(`brainstorm:chunk:${sessionId}`, text),
      onBrief: (brief) => send(`brainstorm:brief:${sessionId}`, brief),
    });
    if (result.ok) send(`brainstorm:done:${sessionId}`, result.text);
    else send(`brainstorm:error:${sessionId}`, result.error);
    return result;
  });

  ipcMain.handle('brainstorm:getBrief', (_e, sessionId: string) => {
    const session = getSession(sessionId);
    if (!session) return { ok: false, error: 'Session not found' };
    return { ok: true, brief: session.brief, transcript: serializeTranscript(session) };
  });

  // Direct UI edit: validated through the same merge as the model's tool calls.
  // Last-writer-wins; a human-readable note is queued for the next turn's prompt.
  ipcMain.handle('brainstorm:editBrief', (_e, sessionId: string, patch: Record<string, unknown>) => {
    const session = getSession(sessionId);
    if (!session) return { ok: false, error: 'Session not found' };
    const result = applyBriefUpdate(session.brief, patch);
    if (!result.ok) return { ok: false, error: result.errors.join('; ') };
    session.brief = result.brief;
    for (const [key, value] of Object.entries(patch)) {
      session.pendingEdits.push(`${key} → ${JSON.stringify(value)}`);
    }
    if (!win.isDestroyed()) win.webContents.send(`brainstorm:brief:${sessionId}`, session.brief);
    return { ok: true, brief: session.brief };
  });

  ipcMain.handle('brainstorm:end', (_e, sessionId: string) => {
    deleteSession(sessionId);
    return { ok: true };
  });

  // Read-and-delete a project's brainstorm-seed.md if present. Unchanged from
  // the old service: ChatPanel's one-shot seed consumption depends on it.
  ipcMain.handle('brainstorm:consumeSeed', async (_e, projectPath: string) => {
    if (!projectPath) return { ok: false };
    const seedPath = path.join(projectPath.replace(/[/\\]+$/, ''), '.sai', 'brainstorm-seed.md');
    let content: string;
    try {
      content = await fs.promises.readFile(seedPath, 'utf8');
    } catch {
      return { ok: false };
    }
    try {
      await fs.promises.unlink(seedPath);
    } catch {
      // ignore — content was read, that's what matters
    }
    return { ok: true, content };
  });
}
```

- [ ] **Step 4: Run the new test and the full unit suite (old brainstorm tests are deleted; nothing else may break)**

Run: `npx vitest run --project unit tests/unit/brainstorm.service.test.ts`
Expected: PASS
Run: `npx vitest run --project unit`
Expected: PASS except `tests/unit/NewProjectModal.brainstorm.test.tsx` and `tests/unit/preload.test.ts` MAY fail if they reference `brainstormSynthesize` — if `NewProjectModal.brainstorm.test.tsx` fails, that is expected debt paid in Task 7/8 (it still compiles against the untouched modal; if it fails now, STOP and check you didn't change exports it uses). `preload.test.ts` is untouched until Task 4.

- [ ] **Step 5: Commit**

```bash
git add -A electron/services/brainstorm tests/unit/brainstorm.service.test.ts
git commit -m "feat(brainstorm): SDK-backed turn runner with live brief IPC; delete CLI synthesize flow"
```

---

### Task 4: Preload surface

**Files:**
- Modify: `electron/preload.ts:298-322`
- Test: modify `tests/unit/preload.test.ts`

**Interfaces:**
- Produces (renderer-visible, used by Tasks 6–9):
  - `brainstormStart(): Promise<{ sessionId: string }>`
  - `brainstormSend(sessionId, message): Promise<{ok, ...}>`
  - `brainstormGetBrief(sessionId): Promise<{ ok: boolean; brief?: ProjectBrief; transcript?: string; error?: string }>`
  - `brainstormEditBrief(sessionId, patch): Promise<{ ok: boolean; brief?: ProjectBrief; error?: string }>`
  - `brainstormEnd(sessionId)`, `brainstormConsumeSeed(projectPath)` — unchanged
  - `brainstormOnChunk/OnDone/OnError(sessionId, cb)` — unchanged
  - `brainstormOnBrief(sessionId, cb: (brief) => void): () => void` — new listener on `brainstorm:brief:<sessionId>`
  - `brainstormSynthesize` — **removed**

- [ ] **Step 1: Extend the failing test**

Open `tests/unit/preload.test.ts`, find how it asserts existing `brainstorm*` API entries (it stubs `ipcRenderer` and checks channel names), and add — following the file's existing assertion style — cases asserting:

```ts
// Add to the existing brainstorm describe block in tests/unit/preload.test.ts,
// matching the file's existing helper/stub names:
it('brainstormGetBrief invokes brainstorm:getBrief', async () => {
  await api.brainstormGetBrief('sid-1');
  expect(invokeMock).toHaveBeenCalledWith('brainstorm:getBrief', 'sid-1');
});
it('brainstormEditBrief invokes brainstorm:editBrief with the patch', async () => {
  await api.brainstormEditBrief('sid-1', { projectName: 'x' });
  expect(invokeMock).toHaveBeenCalledWith('brainstorm:editBrief', 'sid-1', { projectName: 'x' });
});
it('brainstormOnBrief subscribes and unsubscribes brainstorm:brief:<sid>', () => {
  const un = api.brainstormOnBrief('sid-1', () => {});
  expect(onMock).toHaveBeenCalledWith('brainstorm:brief:sid-1', expect.any(Function));
  un();
  expect(removeListenerMock).toHaveBeenCalledWith('brainstorm:brief:sid-1', expect.any(Function));
});
it('brainstormSynthesize is gone', () => {
  expect((api as any).brainstormSynthesize).toBeUndefined();
});
```

(If the file's mocks are named differently, keep its names — the four behaviors above are what must be asserted.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/unit/preload.test.ts`
Expected: FAIL on the four new cases

- [ ] **Step 3: Implement in `electron/preload.ts`**

Replace the `brainstormSynthesize` entry (lines 301-302) and add the new entries next to the existing brainstorm block:

```ts
  brainstormGetBrief: (sessionId: string) => ipcRenderer.invoke('brainstorm:getBrief', sessionId),
  brainstormEditBrief: (sessionId: string, patch: Record<string, unknown>) =>
    ipcRenderer.invoke('brainstorm:editBrief', sessionId, patch),
  brainstormOnBrief: (sessionId: string, callback: (brief: any) => void) => {
    const channel = `brainstorm:brief:${sessionId}`;
    const listener = (_e: Electron.IpcRendererEvent, brief: any) => callback(brief);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
```

Delete the `brainstormSynthesize:` lines entirely.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit tests/unit/preload.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/preload.ts tests/unit/preload.test.ts
git commit -m "feat(brainstorm): preload brief API (getBrief/editBrief/onBrief), drop synthesize"
```

---

### Task 5: Brief-aware scaffold

**Files:**
- Modify: `electron/services/scaffold.ts`
- Test: modify `tests/integration/scaffold.brainstorm.test.ts`

**Interfaces:**
- Consumes: `ProjectBrief`, `renderSeedMarkdown`, `renderClaudeMdContext` from Task 1.
- Produces: `ScaffoldOptions` gains `brief?: ProjectBrief` (keeps `brainstormTranscript?: string`). Behavior:
  - `brief` present → CLAUDE.md content = `renderClaudeMdContext(brief)`; seed file = `renderSeedMarkdown(brief, brainstormTranscript ?? '')`; README description = `brief.summary`.
  - `brief` absent → behavior identical to today (manual creation path).
  - Seed file is written when `brief` OR `brainstormTranscript` is set.

- [ ] **Step 1: Write the failing test**

Open `tests/integration/scaffold.brainstorm.test.ts` and read its existing setup (tmp-dir creation, `scaffoldProject(options, getToken)` call shape). Keeping its helpers, add:

```ts
// Add to tests/integration/scaffold.brainstorm.test.ts
import { createEmptyBrief } from '../../electron/services/brainstorm/brief';

const brief = {
  ...createEmptyBrief(),
  projectName: 'seed-proj',
  summary: 'A test project.',
  goals: ['Do a thing'],
  openQuestions: ['Which thing?'],
  ready: true,
};

it('writes a full-brief seed and brief-derived CLAUDE.md when brief is provided', async () => {
  const dir = path.join(tmpRoot, 'seed-proj');           // reuse the file's tmpRoot helper
  const r = await scaffoldProject({
    path: dir,
    context: 'A test project.',
    helpers: { claudeMd: true, gitInit: false, gitignore: true, readme: true, claudeSettings: false, githubRepo: false },
    brief,
    brainstormTranscript: '**User:** hi',
  }, () => null);
  expect(r.ok).toBe(true);
  const seed = fs.readFileSync(path.join(dir, '.sai', 'brainstorm-seed.md'), 'utf8');
  expect(seed).toMatch(/propose an implementation plan/i);
  expect(seed).toContain('# Project brief: seed-proj');
  expect(seed).toContain('Which thing?');
  expect(seed).toContain('**User:** hi');
  const claudeMd = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  expect(claudeMd).toContain('## Project Context');
  expect(claudeMd).toContain('## Goals');
  expect(claudeMd).not.toContain('## Open questions');
});

it('keeps the legacy plain-context path when no brief is provided', async () => {
  const dir = path.join(tmpRoot, 'plain-proj');
  await scaffoldProject({
    path: dir,
    context: 'Plain context.',
    helpers: { claudeMd: true, gitInit: false, gitignore: false, readme: false, claudeSettings: false, githubRepo: false },
  }, () => null);
  const claudeMd = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  expect(claudeMd).toBe('## Project Context\n\nPlain context.\n');
  expect(fs.existsSync(path.join(dir, '.sai'))).toBe(false);
});
```

(Adapt `tmpRoot`/imports to the file's existing fixtures; do not change its existing tests except where they assert the old seed content — the old test asserting "seed = context only" must be updated to the new full-brief expectation or removed in favor of the first test above.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project integration tests/integration/scaffold.brainstorm.test.ts`
Expected: FAIL — `brief` unknown option / seed content mismatch

- [ ] **Step 3: Implement in `electron/services/scaffold.ts`**

Add the import and option:

```ts
import { renderSeedMarkdown, renderClaudeMdContext, type ProjectBrief } from './brainstorm/brief';

export interface ScaffoldOptions {
  path: string;
  context: string;
  helpers: { /* unchanged */ };
  github?: { repoName: string; visibility: 'private' | 'public' };
  brainstormTranscript?: string;
  brief?: ProjectBrief;
}
```

Step 2 (CLAUDE.md) becomes:

```ts
  if (options.helpers.claudeMd) {
    try {
      const content = options.brief
        ? renderClaudeMdContext(options.brief)
        : options.context
          ? `## Project Context\n\n${options.context}\n`
          : `## Project Context\n\n_No context provided._\n`;
      fs.writeFileSync(path.join(resolved, 'CLAUDE.md'), content, 'utf8');
    } catch (e: any) {
      warnings.push(`CLAUDE.md: ${e.message}`);
    }
  }
```

In Step 4 (.gitignore) change the condition to `if (options.brainstormTranscript || options.brief) ignores.push('.sai/');`.

Step 8 (seed) becomes:

```ts
  if (options.brainstormTranscript || options.brief) {
    try {
      const saiDir = path.join(resolved, '.sai');
      fs.mkdirSync(saiDir, { recursive: true });
      // The seed is auto-sent as the new project's first chat message
      // (ChatPanel one-shot consumption) — it opens with the kickoff
      // instruction so the first session starts planning immediately.
      const seed = options.brief
        ? renderSeedMarkdown(options.brief, options.brainstormTranscript ?? '')
        : (options.context || '').trim() + '\n';
      fs.writeFileSync(path.join(saiDir, 'brainstorm-seed.md'), seed, 'utf8');
      // (existing .gitignore append block unchanged)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project integration tests/integration/scaffold.brainstorm.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/services/scaffold.ts tests/integration/scaffold.brainstorm.test.ts
git commit -m "feat(scaffold): brief-aware CLAUDE.md and kickoff seed"
```

---

### Task 6: Renderer hook `useBrainstormBrief`

**Files:**
- Create: `src/components/NewProjectTakeover/useBrainstormBrief.ts`
- Test: `tests/unit/useBrainstormBrief.test.tsx`

**Interfaces:**
- Consumes: preload API from Task 4 (via `window.sai`).
- Produces (used by Tasks 7–8):

```ts
export interface BrainstormMessage { role: 'user' | 'assistant'; content: string }
export interface UseBrainstormBrief {
  messages: BrainstormMessage[];
  streamingText: string;
  isStreaming: boolean;
  error: string | null;
  brief: ProjectBriefView;            // renderer-side mirror of ProjectBrief
  questionCount: number;              // assistant turns sent while brief not ready (max display 5)
  send(message: string): Promise<void>;
  editBrief(patch: Partial<ProjectBriefView>): Promise<{ ok: boolean; error?: string }>;
  end(): Promise<void>;
  transcriptDirty: boolean;           // true once any message or brief content exists (close-confirm gate)
}
export function useBrainstormBrief(): UseBrainstormBrief
```

`ProjectBriefView` is a local type identical in shape to `ProjectBrief` (renderer must not import from `electron/`):

```ts
export interface StackItemView { name: string; rationale: string }
export interface ProjectBriefView {
  projectName: string | null; summary: string | null;
  goals: string[]; nonGoals: string[]; stack: StackItemView[];
  openQuestions: string[]; ready: boolean;
}
export const EMPTY_BRIEF: ProjectBriefView = { projectName: null, summary: null, goals: [], nonGoals: [], stack: [], openQuestions: [], ready: false };
```

Behavior contract: session lazily created on first `send` (like the old hook); subscribes `brainstormOnBrief` for the session lifetime (not per-send); `brainstormEnd` on unmount; `questionCount` = number of assistant messages received while `brief.ready` was false at the time they arrived.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/useBrainstormBrief.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useBrainstormBrief, EMPTY_BRIEF } from '../../src/components/NewProjectTakeover/useBrainstormBrief';

type Cb = (payload: any) => void;
const listeners: Record<string, Cb> = {};

beforeEach(() => {
  for (const k of Object.keys(listeners)) delete listeners[k];
  (window as any).sai = {
    brainstormStart: vi.fn().mockResolvedValue({ sessionId: 'sid-1' }),
    brainstormSend: vi.fn().mockResolvedValue({ ok: true }),
    brainstormEditBrief: vi.fn().mockResolvedValue({ ok: true, brief: { ...EMPTY_BRIEF, projectName: 'edited' } }),
    brainstormEnd: vi.fn().mockResolvedValue({ ok: true }),
    brainstormOnChunk: vi.fn((sid: string, cb: Cb) => { listeners[`chunk:${sid}`] = cb; return () => {}; }),
    brainstormOnDone: vi.fn((sid: string, cb: Cb) => { listeners[`done:${sid}`] = cb; return () => {}; }),
    brainstormOnError: vi.fn((sid: string, cb: Cb) => { listeners[`error:${sid}`] = cb; return () => {}; }),
    brainstormOnBrief: vi.fn((sid: string, cb: Cb) => { listeners[`brief:${sid}`] = cb; return () => {}; }),
  };
});

describe('useBrainstormBrief', () => {
  it('sends a message, streams, and finalizes the assistant reply', async () => {
    const { result } = renderHook(() => useBrainstormBrief());
    await act(() => result.current.send('hello'));
    expect(result.current.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(result.current.isStreaming).toBe(true);
    act(() => listeners['chunk:sid-1']('Hi '));
    expect(result.current.streamingText).toBe('Hi ');
    act(() => listeners['done:sid-1']('Hi there'));
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.messages[1]).toEqual({ role: 'assistant', content: 'Hi there' });
  });

  it('tracks live brief updates and questionCount stops at ready', async () => {
    const { result } = renderHook(() => useBrainstormBrief());
    await act(() => result.current.send('q1'));
    act(() => listeners['done:sid-1']('first reply?'));
    expect(result.current.questionCount).toBe(1);
    act(() => listeners['brief:sid-1']({ ...EMPTY_BRIEF, projectName: 'x', summary: 's', ready: true }));
    expect(result.current.brief.ready).toBe(true);
    await act(() => result.current.send('q2'));
    act(() => listeners['done:sid-1']('refined.'));
    expect(result.current.questionCount).toBe(1); // ready → no longer counted
  });

  it('editBrief applies the returned brief and reports validation errors', async () => {
    const { result } = renderHook(() => useBrainstormBrief());
    await act(() => result.current.send('x'));
    await act(async () => {
      const r = await result.current.editBrief({ projectName: 'edited' });
      expect(r.ok).toBe(true);
    });
    expect(result.current.brief.projectName).toBe('edited');
    (window as any).sai.brainstormEditBrief.mockResolvedValueOnce({ ok: false, error: 'projectName must be kebab-case' });
    await act(async () => {
      const r = await result.current.editBrief({ projectName: 'Bad' });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/kebab/);
    });
  });

  it('surfaces stream errors and clears streaming state', async () => {
    const { result } = renderHook(() => useBrainstormBrief());
    await act(() => result.current.send('x'));
    act(() => listeners['error:sid-1']('auth failed'));
    expect(result.current.error).toBe('auth failed');
    expect(result.current.isStreaming).toBe(false);
  });

  it('transcriptDirty flips once content exists; ends the session on unmount', async () => {
    const { result, unmount } = renderHook(() => useBrainstormBrief());
    expect(result.current.transcriptDirty).toBe(false);
    await act(() => result.current.send('x'));
    expect(result.current.transcriptDirty).toBe(true);
    unmount();
    await waitFor(() => expect((window as any).sai.brainstormEnd).toHaveBeenCalledWith('sid-1'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/unit/useBrainstormBrief.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the hook**

```ts
// src/components/NewProjectTakeover/useBrainstormBrief.ts
import { useState, useRef, useCallback, useEffect } from 'react';

export interface BrainstormMessage { role: 'user' | 'assistant'; content: string }
export interface StackItemView { name: string; rationale: string }
export interface ProjectBriefView {
  projectName: string | null; summary: string | null;
  goals: string[]; nonGoals: string[]; stack: StackItemView[];
  openQuestions: string[]; ready: boolean;
}
export const EMPTY_BRIEF: ProjectBriefView = {
  projectName: null, summary: null, goals: [], nonGoals: [], stack: [], openQuestions: [], ready: false,
};

export interface UseBrainstormBrief {
  messages: BrainstormMessage[];
  streamingText: string;
  isStreaming: boolean;
  error: string | null;
  brief: ProjectBriefView;
  questionCount: number;
  send(message: string): Promise<void>;
  editBrief(patch: Partial<ProjectBriefView>): Promise<{ ok: boolean; error?: string }>;
  end(): Promise<void>;
  transcriptDirty: boolean;
}

export function useBrainstormBrief(): UseBrainstormBrief {
  const [messages, setMessages] = useState<BrainstormMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState<ProjectBriefView>(EMPTY_BRIEF);
  const [questionCount, setQuestionCount] = useState(0);

  const sessionIdRef = useRef<string | null>(null);
  const briefRef = useRef(brief);
  briefRef.current = brief;
  const unsubsRef = useRef<Array<() => void>>([]);

  const ensureSession = useCallback(async (): Promise<string> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    const { sessionId } = await (window.sai as any).brainstormStart();
    sessionIdRef.current = sessionId;
    // Session-lifetime brief subscription: fires for model tool calls AND
    // editBrief round-trips (both emit brainstorm:brief:<sid>).
    unsubsRef.current.push(
      (window.sai as any).brainstormOnBrief(sessionId, (b: ProjectBriefView) => setBrief(b)),
    );
    return sessionId;
  }, []);

  useEffect(() => () => {
    unsubsRef.current.forEach(u => u());
    unsubsRef.current = [];
    const sid = sessionIdRef.current;
    if (sid) (window.sai as any).brainstormEnd(sid).catch(() => {});
  }, []);

  const send = useCallback(async (message: string) => {
    setError(null);
    setIsStreaming(true);
    setStreamingText('');
    setMessages(prev => [...prev, { role: 'user', content: message }]);

    let sid: string;
    try {
      sid = await ensureSession();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to start brainstorm');
      setIsStreaming(false);
      return;
    }

    let buffered = '';
    const unsubChunk = (window.sai as any).brainstormOnChunk(sid, (text: string) => {
      buffered += text;
      setStreamingText(buffered);
    });
    const finish = () => { unsubChunk(); unsubDone(); unsubError(); };
    const unsubDone = (window.sai as any).brainstormOnDone(sid, (text: string) => {
      setMessages(prev => [...prev, { role: 'assistant', content: text }]);
      if (!briefRef.current.ready) setQuestionCount(c => c + 1);
      setStreamingText('');
      setIsStreaming(false);
      finish();
    });
    const unsubError = (window.sai as any).brainstormOnError(sid, (err: string) => {
      setError(err);
      setStreamingText('');
      setIsStreaming(false);
      finish();
    });
    unsubsRef.current.push(unsubChunk, unsubDone, unsubError);

    try {
      await (window.sai as any).brainstormSend(sid, message);
    } catch (e: any) {
      setError(e?.message ?? 'Send failed');
      setIsStreaming(false);
    }
  }, [ensureSession]);

  const editBrief = useCallback(async (patch: Partial<ProjectBriefView>) => {
    const sid = await ensureSession();
    const r = await (window.sai as any).brainstormEditBrief(sid, patch);
    if (r.ok && r.brief) setBrief(r.brief);
    return r.ok ? { ok: true as const } : { ok: false as const, error: r.error };
  }, [ensureSession]);

  const end = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (sid) {
      await (window.sai as any).brainstormEnd(sid).catch(() => {});
      sessionIdRef.current = null;
    }
  }, []);

  const transcriptDirty = messages.length > 0 ||
    brief.projectName !== null || brief.summary !== null || brief.goals.length > 0;

  return { messages, streamingText, isStreaming, error, brief, questionCount, send, editBrief, end, transcriptDirty };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit tests/unit/useBrainstormBrief.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/NewProjectTakeover/useBrainstormBrief.ts tests/unit/useBrainstormBrief.test.tsx
git commit -m "feat(new-project): useBrainstormBrief hook with live brief state"
```

---

### Task 7: BriefPane component

**Files:**
- Create: `src/components/NewProjectTakeover/BriefPane.tsx`
- Test: `tests/unit/NewProjectTakeover.test.tsx` (started here, extended in Task 8)

**Interfaces:**
- Consumes: `ProjectBriefView`, `EMPTY_BRIEF` from Task 6.
- Produces:

```ts
export interface SetupState {
  parentDir: string;
  helpers: { claudeMd: boolean; gitInit: boolean; gitignore: boolean; readme: boolean; claudeSettings: boolean; githubRepo: boolean };
  repoName: string;
  visibility: 'private' | 'public';
  githubUser: { login: string } | null;
}
export interface BriefPaneProps {
  brief: ProjectBriefView;
  onEditBrief(patch: Partial<ProjectBriefView>): Promise<{ ok: boolean; error?: string }>;
  setup: SetupState;
  onSetupChange(next: Partial<SetupState>): void;
  onBrowseParent(): void;
  onConnectGitHub(): void;
  onCreate(): void;
  creating: boolean;
  createError: string;
  warnings: string[];
  createdPath: string;
  onOpenProject(): void;
}
export default function BriefPane(props: BriefPaneProps): JSX.Element
```

Visual/behavior contract (from the approved mockup):
- Header row: `PROJECT BRIEF` label (11px uppercase, letter-spacing 1.2px, `--text-secondary`) + `Ready` pill (accent-dim bg, accent text, dot) shown only when `brief.ready`.
- Sections in order: Name, Summary, Goals, Out of scope, Suggested stack (tag chips), Open questions (dashed-border card). Empty sections render a muted placeholder card (`—`) rather than disappearing, EXCEPT Open questions which is hidden when empty.
- **Click-to-edit:** Name and Summary render as text; clicking swaps to an inline `<input>`/`<textarea>` (mono for name) with commit-on-blur and on-Enter (Escape cancels). Commit calls `onEditBrief({ projectName })` / `({ summary })`; on `{ ok: false, error }` show the error in 11px red under the field and keep editing. Goals / Out of scope / Open questions: clicking the card swaps to a textarea (one item per line) committed the same way (`goals: lines.filter(Boolean)`). Stack is not editable in v1 (chips display only).
- Footer: "Setup options" disclosure (collapsed = one-line mono summary `dir · git ✓/✗ · CLAUDE.md ✓/✗ · README ✓/✗ · GitHub ✓/✗`; expanded = parent-dir field + Browse button + the six checkboxes + repo name/visibility + GitHub connect, all ported straight from the old `SetupTab.tsx` field markup), then Create button, then hint line "Creates the folder, seeds the first chat with this brief, and starts building".
- Create button: `disabled` unless `brief.projectName && brief.summary && setup.parentDir && !creating`; when `brief.ready` also add gold glow (`boxShadow: '0 0 18px rgba(212,160,23,.25)'`) and solid accent background; label `Creating…` while `creating`. When `createdPath` is set, render an "Open project" button (calls `onOpenProject`) in its place. `createError` renders red above the button; `warnings` render in the gold warning style from the old SetupTab.
- Test ids (used by unit + e2e tests): `data-testid` = `brief-pane`, `brief-name`, `brief-summary`, `brief-goals`, `brief-ready-pill`, `brief-open-questions`, `setup-disclosure`, `create-project-btn`, `open-project-btn`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/NewProjectTakeover.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BriefPane, { type SetupState } from '../../src/components/NewProjectTakeover/BriefPane';
import { EMPTY_BRIEF } from '../../src/components/NewProjectTakeover/useBrainstormBrief';

const setup: SetupState = {
  parentDir: '/tmp/projects',
  helpers: { claudeMd: true, gitInit: true, gitignore: true, readme: true, claudeSettings: false, githubRepo: false },
  repoName: '', visibility: 'private', githubUser: null,
};

const baseProps = () => ({
  brief: { ...EMPTY_BRIEF, projectName: 'toy', summary: 'A toy.', goals: ['g1'], ready: false },
  onEditBrief: vi.fn().mockResolvedValue({ ok: true }),
  setup, onSetupChange: vi.fn(), onBrowseParent: vi.fn(), onConnectGitHub: vi.fn(),
  onCreate: vi.fn(), creating: false, createError: '', warnings: [], createdPath: '', onOpenProject: vi.fn(),
});

describe('BriefPane', () => {
  it('renders brief fields and hides the Ready pill until ready', () => {
    const { rerender } = render(<BriefPane {...baseProps()} />);
    expect(screen.getByTestId('brief-name')).toHaveTextContent('toy');
    expect(screen.getByTestId('brief-summary')).toHaveTextContent('A toy.');
    expect(screen.queryByTestId('brief-ready-pill')).toBeNull();
    rerender(<BriefPane {...baseProps()} brief={{ ...EMPTY_BRIEF, projectName: 'toy', summary: 'A toy.', ready: true }} />);
    expect(screen.getByTestId('brief-ready-pill')).toBeInTheDocument();
  });

  it('hides Open questions when empty and shows it dashed when present', () => {
    const props = baseProps();
    const { rerender } = render(<BriefPane {...props} />);
    expect(screen.queryByTestId('brief-open-questions')).toBeNull();
    rerender(<BriefPane {...props} brief={{ ...props.brief, openQuestions: ['Q?'] }} />);
    expect(screen.getByTestId('brief-open-questions')).toHaveTextContent('Q?');
  });

  it('click-to-edit name commits on Enter via onEditBrief', async () => {
    const props = baseProps();
    render(<BriefPane {...props} />);
    fireEvent.click(screen.getByTestId('brief-name'));
    const input = screen.getByDisplayValue('toy');
    fireEvent.change(input, { target: { value: 'toy-two' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(props.onEditBrief).toHaveBeenCalledWith({ projectName: 'toy-two' }));
  });

  it('shows the validation error and stays in edit mode on rejection', async () => {
    const props = baseProps();
    props.onEditBrief = vi.fn().mockResolvedValue({ ok: false, error: 'projectName must be kebab-case' });
    render(<BriefPane {...props} />);
    fireEvent.click(screen.getByTestId('brief-name'));
    const input = screen.getByDisplayValue('toy');
    fireEvent.change(input, { target: { value: 'Bad Name' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/kebab-case/)).toBeInTheDocument());
    expect(screen.getByDisplayValue('Bad Name')).toBeInTheDocument();
  });

  it('gates Create on name+summary+parentDir and swaps to Open project after creation', () => {
    const props = baseProps();
    const { rerender } = render(<BriefPane {...props} brief={{ ...EMPTY_BRIEF }} />);
    expect(screen.getByTestId('create-project-btn')).toBeDisabled();
    rerender(<BriefPane {...props} />);
    expect(screen.getByTestId('create-project-btn')).toBeEnabled();
    fireEvent.click(screen.getByTestId('create-project-btn'));
    expect(props.onCreate).toHaveBeenCalled();
    rerender(<BriefPane {...props} createdPath="/tmp/projects/toy" />);
    expect(screen.getByTestId('open-project-btn')).toBeInTheDocument();
  });

  it('expands the setup disclosure to reveal parent dir and helper toggles', () => {
    render(<BriefPane {...baseProps()} />);
    fireEvent.click(screen.getByTestId('setup-disclosure'));
    expect(screen.getByDisplayValue('/tmp/projects')).toBeInTheDocument();
    expect(screen.getByLabelText('CLAUDE.md')).toBeChecked();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/unit/NewProjectTakeover.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `BriefPane.tsx`**

Implement per the interface/visual contract above. Structural skeleton (fill the styling from the contract; port field markup for the expanded disclosure from `SetupTab.tsx` before deleting it in Task 8):

```tsx
// src/components/NewProjectTakeover/BriefPane.tsx
import { useState } from 'react';
import { Sparkles, FolderPlus, ChevronRight, ChevronDown } from 'lucide-react';
import type { ProjectBriefView } from './useBrainstormBrief';

export interface SetupState { /* as in Interfaces block */ }
export interface BriefPaneProps { /* as in Interfaces block */ }

const label: React.CSSProperties = { fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 5, display: 'block' };
const card: React.CSSProperties = { background: 'var(--surface-3)', border: '1px solid var(--border-subtle)', borderRadius: 9, padding: '10px 12px', cursor: 'pointer' };

function EditableText(props: {
  testId: string; value: string; placeholder: string; mono?: boolean; multiline?: boolean;
  commit(v: string): Promise<{ ok: boolean; error?: string }>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState('');
  const start = () => { setDraft(props.value); setErr(''); setEditing(true); };
  const commit = async () => {
    const r = await props.commit(draft);
    if (r.ok) setEditing(false);
    else setErr(r.error ?? 'Invalid value');
  };
  if (!editing) {
    return (
      <div data-testid={props.testId} style={{ ...card, fontFamily: props.mono ? "'JetBrains Mono', monospace" : undefined, color: props.value ? (props.mono ? 'var(--accent)' : 'var(--text)') : 'var(--text-muted)' }} onClick={start}>
        {props.value || props.placeholder}
      </div>
    );
  }
  const shared = {
    value: draft, autoFocus: true,
    onChange: (e: any) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !props.multiline) { e.preventDefault(); void commit(); }
      if (e.key === 'Escape') setEditing(false);
    },
    style: { ...card, cursor: 'text', width: '100%', boxSizing: 'border-box' as const, font: 'inherit', color: 'var(--text)' },
  };
  return (
    <div>
      {props.multiline ? <textarea rows={3} {...shared} /> : <input {...shared} />}
      {err && <div style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>{err}</div>}
    </div>
  );
}
```

Then the default export composes: header (+`brief-ready-pill`), `EditableText` for name (`brief-name`, mono) and summary (`brief-summary`, multiline), list-editing variants for goals (`brief-goals`) / nonGoals / openQuestions (`brief-open-questions`, dashed border, hidden when empty — commit maps textarea lines to `onEditBrief({ goals: lines })` etc.), stack chips, the setup disclosure (`setup-disclosure` toggles `expanded`; expanded content ports the old `SetupTab` markup wired to `props.setup`/`props.onSetupChange`/`props.onBrowseParent`/`props.onConnectGitHub`), error/warnings blocks, and the Create / Open-project buttons per the contract (`create-project-btn` / `open-project-btn`, `<Sparkles size={13} />` icon, glow when `brief.ready`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit tests/unit/NewProjectTakeover.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/NewProjectTakeover/BriefPane.tsx tests/unit/NewProjectTakeover.test.tsx
git commit -m "feat(new-project): BriefPane with click-to-edit fields and setup disclosure"
```

---

### Task 8: ConversationPane, takeover container, App wiring, old modal deletion

**Files:**
- Create: `src/components/NewProjectTakeover/ConversationPane.tsx`
- Create: `src/components/NewProjectTakeover/NewProjectTakeover.tsx`
- Modify: `src/App.tsx` (import at line 20; render site at lines 5554-5562)
- Delete: `src/components/NewProjectModal.tsx`, `src/components/NewProjectModal/BrainstormTab.tsx`, `src/components/NewProjectModal/SetupTab.tsx`, `src/components/NewProjectModal/useBrainstorm.ts`, `tests/unit/NewProjectModal.brainstorm.test.tsx`
- Test: extend `tests/unit/NewProjectTakeover.test.tsx`

**Interfaces:**
- Consumes: Tasks 6–7; `window.sai.scaffoldProject`, `selectFolder`, `settingsGet`, `githubGetUser`, `githubStartAuth`, `githubOnAuthComplete` (all preexisting).
- Produces:

```tsx
// ConversationPane
export interface ConversationPaneProps {
  messages: BrainstormMessage[];
  streamingText: string;
  isStreaming: boolean;
  error: string | null;
  questionCount: number;   // status line: `question N of 5` while !ready
  briefReady: boolean;     // status line: `brief ready — refine or create`
  onSend(text: string): void;
}
export default function ConversationPane(props: ConversationPaneProps): JSX.Element

// NewProjectTakeover — same public props as the old modal, drop-in at the App call site
export interface NewProjectTakeoverProps { onClose(): void; onCreated(path: string): void }
export default function NewProjectTakeover(props: NewProjectTakeoverProps): JSX.Element
```

Behavior contract:
- **ConversationPane:** empty state (Sparkles icon, "Think it through", sub-line "Describe what you want to build — the brief assembles itself on the right."); message list with the old BrainstormTab's avatar/markdown rendering idiom (ReactMarkdown for assistant — port the markdown component config from `BrainstormTab.tsx` before deletion; assistant blockquotes get the gold-left-border callout styling, which is how the model's per-turn question is highlighted); streaming indicator; status line under the last assistant message (`question {min(questionCount,5)} of 5` when `!briefReady`, `brief ready — refine or create` when ready); composer (textarea 2 rows, Enter sends / Shift+Enter newline, Send button disabled while streaming or empty). Test ids: `conversation-pane`, `brainstorm-composer`, `brainstorm-send-btn`, `brainstorm-status-line`.
- **NewProjectTakeover:** fixed full-window surface — `position: fixed, inset: 0, zIndex: 1000, background: 'var(--surface-1, #0d1117)', display: flex, flexDirection: column` with `className="sai-overlay-in"`; header (glyph + "New Project" + muted "brainstorm → brief → create" + ✕ close); `<main>` flex row = ConversationPane (`flex: 1.4`, right border `--border-subtle`) + BriefPane (`flex: 1, minWidth: 380, maxWidth: 480, background: var(--surface-2)`). Owns: the `useBrainstormBrief()` hook; `SetupState` (parentDir seeded from `settingsGet('defaultProjectDir')`, GitHub user via `githubGetUser`/`githubOnAuthComplete`, `repoName` mirrors `brief.projectName` until manually edited — port that effect from the old modal lines 112-114); create flow; Escape/✕ close with `window.confirm('Discard this brainstorm? The brief and conversation will be lost.')` gate when `transcriptDirty && !createdPath`.
- **Create flow** (replaces old `handleCreate`, no synthesize step):

```ts
const handleCreate = useCallback(async () => {
  const name = bs.brief.projectName;
  if (!name || !setup.parentDir) return;
  const computedPath = setup.parentDir.replace(/\/+$/, '') + '/' + name;
  setCreating(true); setCreateError(''); setWarnings([]);
  let result: any;
  try {
    result = await window.sai.scaffoldProject({
      path: computedPath,
      context: bs.brief.summary ?? '',
      helpers: setup.helpers,
      github: setup.helpers.githubRepo ? { repoName: setup.repoName, visibility: setup.visibility } : undefined,
      brief: bs.brief,
      brainstormTranscript: bs.messages.map(m => `**${m.role === 'user' ? 'User' : 'Assistant'}:** ${m.content}`).join('\n\n') || undefined,
    });
  } catch (e: any) {
    setCreating(false); setCreateError(e?.message ?? 'Unexpected error — please try again'); return;
  }
  setCreating(false);
  if (!result.ok) { setCreateError(result.error || 'Failed to create project'); return; }
  if (result.warnings?.length) { setWarnings(result.warnings); setCreatedPath(computedPath); return; }
  props.onCreated(computedPath);   // App's handleProjectSwitch opens the project; ChatPanel auto-sends the seed
}, [bs.brief, bs.messages, setup, props.onCreated]);
```

- **App.tsx:** replace `import NewProjectModal from './components/NewProjectModal';` with `import NewProjectTakeover from './components/NewProjectTakeover/NewProjectTakeover';` and swap the JSX at the render site (same `onClose`/`onCreated` props — no other App changes).

- [ ] **Step 1: Write the failing tests (extend `tests/unit/NewProjectTakeover.test.tsx`)**

```tsx
// Append to tests/unit/NewProjectTakeover.test.tsx
import NewProjectTakeover from '../../src/components/NewProjectTakeover/NewProjectTakeover';

function mockSai(overrides: Record<string, any> = {}) {
  const listeners: Record<string, (p: any) => void> = {};
  (window as any).sai = {
    brainstormStart: vi.fn().mockResolvedValue({ sessionId: 'sid-1' }),
    brainstormSend: vi.fn().mockResolvedValue({ ok: true }),
    brainstormEditBrief: vi.fn().mockResolvedValue({ ok: true }),
    brainstormEnd: vi.fn().mockResolvedValue({ ok: true }),
    brainstormOnChunk: vi.fn((sid: string, cb: any) => { listeners[`chunk`] = cb; return () => {}; }),
    brainstormOnDone: vi.fn((sid: string, cb: any) => { listeners[`done`] = cb; return () => {}; }),
    brainstormOnError: vi.fn((sid: string, cb: any) => { listeners[`error`] = cb; return () => {}; }),
    brainstormOnBrief: vi.fn((sid: string, cb: any) => { listeners[`brief`] = cb; return () => {}; }),
    scaffoldProject: vi.fn().mockResolvedValue({ ok: true, warnings: [] }),
    selectFolder: vi.fn(), settingsGet: vi.fn().mockResolvedValue('/tmp/projects'),
    githubGetUser: vi.fn().mockResolvedValue(null),
    githubStartAuth: vi.fn(), githubOnAuthComplete: vi.fn(() => () => {}),
    ...overrides,
  };
  return { listeners };
}

describe('NewProjectTakeover', () => {
  it('sends a message and fills the brief live from the brief event', async () => {
    const { listeners } = mockSai();
    render(<NewProjectTakeover onClose={() => {}} onCreated={() => {}} />);
    fireEvent.change(screen.getByTestId('brainstorm-composer'), { target: { value: 'a folder sorter' } });
    fireEvent.click(screen.getByTestId('brainstorm-send-btn'));
    await waitFor(() => expect((window as any).sai.brainstormSend).toHaveBeenCalled());
    await waitFor(() => expect((window as any).sai.brainstormOnBrief).toHaveBeenCalled());
    act(() => listeners['brief']({ ...EMPTY_BRIEF, projectName: 'folder-janitor', summary: 'Sorts.', ready: true }));
    act(() => listeners['done']('Draft is ready.'));
    expect(screen.getByTestId('brief-name')).toHaveTextContent('folder-janitor');
    expect(screen.getByTestId('brief-ready-pill')).toBeInTheDocument();
    expect(screen.getByTestId('brainstorm-status-line')).toHaveTextContent(/brief ready/i);
  });

  it('Create passes the brief and transcript to scaffoldProject and calls onCreated', async () => {
    const { listeners } = mockSai();
    const onCreated = vi.fn();
    render(<NewProjectTakeover onClose={() => {}} onCreated={onCreated} />);
    fireEvent.change(screen.getByTestId('brainstorm-composer'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByTestId('brainstorm-send-btn'));
    await waitFor(() => expect((window as any).sai.brainstormOnBrief).toHaveBeenCalled());
    act(() => listeners['brief']({ ...EMPTY_BRIEF, projectName: 'toy', summary: 'A toy.' }));
    act(() => listeners['done']('ok'));
    await waitFor(() => expect(screen.getByTestId('create-project-btn')).toBeEnabled());
    fireEvent.click(screen.getByTestId('create-project-btn'));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('/tmp/projects/toy'));
    const call = (window as any).sai.scaffoldProject.mock.calls[0][0];
    expect(call.brief.projectName).toBe('toy');
    expect(call.brainstormTranscript).toContain('**User:** hi');
  });

  it('confirms before closing a dirty brainstorm', async () => {
    mockSai();
    const onClose = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<NewProjectTakeover onClose={onClose} onCreated={() => {}} />);
    fireEvent.change(screen.getByTestId('brainstorm-composer'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByTestId('brainstorm-send-btn'));
    await waitFor(() => expect((window as any).sai.brainstormSend).toHaveBeenCalled());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(confirmSpy).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('shows scaffold errors inline and keeps the surface open', async () => {
    const { listeners } = mockSai({ scaffoldProject: vi.fn().mockResolvedValue({ ok: false, error: 'Could not create directory: EACCES' }) });
    render(<NewProjectTakeover onClose={() => {}} onCreated={() => {}} />);
    fireEvent.change(screen.getByTestId('brainstorm-composer'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByTestId('brainstorm-send-btn'));
    await waitFor(() => expect((window as any).sai.brainstormOnBrief).toHaveBeenCalled());
    act(() => listeners['brief']({ ...EMPTY_BRIEF, projectName: 'toy', summary: 'A toy.' }));
    act(() => listeners['done']('ok'));
    fireEvent.click(screen.getByTestId('create-project-btn'));
    await waitFor(() => expect(screen.getByText(/EACCES/)).toBeInTheDocument());
    expect(screen.getByTestId('brief-pane')).toBeInTheDocument();
  });
});
```

(Add `act` to the imports from `@testing-library/react` at the top of the file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/unit/NewProjectTakeover.test.tsx`
Expected: FAIL — `NewProjectTakeover` not found

- [ ] **Step 3: Implement `ConversationPane.tsx` and `NewProjectTakeover.tsx`, wire App, delete the modal**

Implement per the behavior contract (port the ReactMarkdown config and message/avatar styling from `BrainstormTab.tsx` into ConversationPane before deleting; blockquote style override: `borderLeft: '2px solid var(--accent)', background: 'var(--surface-2)', padding: '8px 12px', borderRadius: '0 8px 8px 0'`). Then:

```bash
git rm src/components/NewProjectModal.tsx src/components/NewProjectModal/BrainstormTab.tsx src/components/NewProjectModal/SetupTab.tsx src/components/NewProjectModal/useBrainstorm.ts tests/unit/NewProjectModal.brainstorm.test.tsx
```

In `src/App.tsx`: swap the import (line 20) and the render site (5554-5562) to:

```tsx
      {showNewProject && (
        <NewProjectTakeover
          onClose={() => setShowNewProject(false)}
          onCreated={(path) => {
            setShowNewProject(false);
            handleProjectSwitch(path);
          }}
        />
      )}
```

- [ ] **Step 4: Run the full unit suite**

Run: `npx vitest run --project unit`
Expected: PASS (all — no remaining references to NewProjectModal or brainstormSynthesize; `grep -rn "NewProjectModal\|brainstormSynthesize" src tests electron` must return nothing)

- [ ] **Step 5: Commit**

```bash
git add -A src/components/NewProjectTakeover src/App.tsx tests/unit/NewProjectTakeover.test.tsx
git commit -m "feat(new-project): two-pane takeover replaces the modal"
```

---

### Task 9: E2E flow

**Files:**
- Create: `tests/e2e/new-project-takeover.spec.ts`

**Interfaces:**
- Consumes: the `test`/`expect` harness from `tests/e2e/test.ts`, `saiMock` overrides (`test.use({ saiMock })`, values are stringified — every function must be self-contained), `triggerSaiEvent`/`waitForSaiSubscription` from `tests/e2e/helpers/mock-events.ts`, and the takeover test ids from Tasks 7–8.

- [ ] **Step 1: Write the spec**

First read `tests/e2e/settings.spec.ts` (or `workspace.spec.ts`) for how a spec opens app chrome and uses `saiMock`; mirror its structure. The spec (adapt the "open the New Project surface" step to however the app exposes it — the button that sets `showNewProject`; find it with `grep -n "setShowNewProject(true)" src/App.tsx` and target its rendered control):

```ts
import { test, expect } from './test';
import { triggerSaiEvent, waitForSaiSubscription } from './helpers/mock-events';

test.use({
  saiMock: {
    brainstormStart: () => Promise.resolve({ sessionId: 'e2e-sid' }),
    brainstormSend: () => Promise.resolve({ ok: true }),
    brainstormEnd: () => Promise.resolve({ ok: true }),
    brainstormOnChunk: (sid: string, cb: any) => { (window as any).__saiTriggers['bs-chunk'] = cb; return () => {}; },
    brainstormOnDone: (sid: string, cb: any) => { (window as any).__saiTriggers['bs-done'] = cb; return () => {}; },
    brainstormOnError: (sid: string, cb: any) => { (window as any).__saiTriggers['bs-error'] = cb; return () => {}; },
    brainstormOnBrief: (sid: string, cb: any) => { (window as any).__saiTriggers['bs-brief'] = cb; return () => {}; },
    brainstormEditBrief: () => Promise.resolve({ ok: true }),
    scaffoldProject: (opts: any) => { (window as any).__scaffoldCall = opts; return Promise.resolve({ ok: true, warnings: [] }); },
  },
})

test('brainstorm → live brief → create hands the brief to scaffold', async ({ window: page }) => {
  // Open the New Project surface (adapt selector per App's trigger control).
  await page.getByTestId('new-project-btn').click();
  await expect(page.getByTestId('brief-pane')).toBeVisible();

  await page.getByTestId('brainstorm-composer').fill('a tool that sorts my downloads');
  await page.getByTestId('brainstorm-send-btn').click();
  await waitForSaiSubscription(page, 'bs-brief');

  await triggerSaiEvent(page, 'bs-brief', {
    projectName: 'folder-janitor', summary: 'Sorts downloads by rules.',
    goals: ['Watch Downloads'], nonGoals: [], stack: [], openQuestions: ['Conflicts?'], ready: true,
  });
  await triggerSaiEvent(page, 'bs-done', 'The brief is ready — refine or create.');

  await expect(page.getByTestId('brief-name')).toContainText('folder-janitor');
  await expect(page.getByTestId('brief-ready-pill')).toBeVisible();
  await expect(page.getByTestId('brief-open-questions')).toContainText('Conflicts?');

  await page.getByTestId('create-project-btn').click();
  await expect.poll(() => page.evaluate(() => (window as any).__scaffoldCall?.brief?.projectName)).toBe('folder-janitor');
  const transcript = await page.evaluate(() => (window as any).__scaffoldCall?.brainstormTranscript);
  expect(transcript).toContain('a tool that sorts my downloads');
});
```

- [ ] **Step 2: Run it**

Run: `npx playwright test tests/e2e/new-project-takeover.spec.ts` (use the repo's e2e script if `package.json` defines one — check `npm run` first)
Expected: PASS. If the new-project trigger selector differs, fix the selector, not the app.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/new-project-takeover.spec.ts
git commit -m "test(e2e): new-project takeover brainstorm-to-create flow"
```

---

### Task 10: Full-suite verification + live smoke

- [ ] **Step 1: Full test run**

Run: `npx vitest run` then the e2e suite (repo script).
Expected: all green. Fix regressions before proceeding.

- [ ] **Step 2: Live smoke (dogfood)**

Launch the dev app (`npm run dev` or the repo's script), open New Project, and verify: conversation converges (question callouts, status line), brief fills live, an invalid manual name edit shows the inline error, Create scaffolds and the new project's first chat auto-sends the kickoff seed. NOTE: brainstorm now uses the SDK in-process — new-tool restart caveats don't apply, but a running dev session from before the change must be restarted.

- [ ] **Step 3: Commit any smoke fixes; done**

```bash
git status   # should be clean or contain only deliberate fixes, committed with fix(new-project): ...
```

---

## Self-Review Notes (performed at plan-writing time)

- **Spec coverage:** brief-during-conversation (T1–T3), convergence prompt with budget (T2), deterministic Create (T3/T8), preload surface (T4), CLAUDE.md/seed/auto-kickoff (T5 — ChatPanel rail preexists, verified at `ChatPanel.tsx:713-741`), two-pane takeover + click-to-edit + last-writer-wins edits (T3 editBrief/pendingEdits, T6–T8), close-confirm (T8), error paths (T2 isError, T6 stream error, T8 scaffold error), tests incl. e2e (T1–T9). Open-questions-in-CLAUDE.md: intentionally seed-only, per spec's CLAUDE.md field list.
- **Type consistency:** `ProjectBrief` (main) mirrored by `ProjectBriefView` (renderer) — same shape, duplicated deliberately so the renderer never imports `electron/`. `SetupState.helpers` matches `ScaffoldOptions.helpers` key-for-key. IPC channel names match between service (T3), preload (T4), and hook (T6).
- **Known judgment calls:** streaming granularity is per-assistant-message (no `includePartialMessages`), matching the old CLI behavior; `window.confirm` for the discard gate (native, ugly-but-honest — swap for a styled dialog later if it stings); stack chips not editable in v1.
