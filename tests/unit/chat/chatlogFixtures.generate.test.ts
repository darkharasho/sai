// @vitest-environment node
/**
 * Generator for the golden chat-log fixtures in tests/fixtures/chatlog/.
 * Skipped unless SAI_REGEN_CHATLOG_FIXTURES=1:
 *
 *   SAI_REGEN_CHATLOG_FIXTURES=1 npx vitest run --project unit tests/unit/chat/chatlogFixtures.generate.test.ts
 *
 * Each scenario drives the REAL production path with a recorded provider
 * stream: ChatCommands.run (desktop send/stop) → createProviderDispatch →
 * SdkBackend (Claude, fake SDK query) / SdkCodexBackend (Codex, fake SDK
 * thread) → backend emit → ChatLogService.record → ChatLogStore. The store's
 * `<chatId>.jsonl` is then copied (home paths scrubbed) into the fixture dir,
 * so the event structure is exactly what production logs.
 *
 * One shortcut: the backends' emit goes straight to ChatLogService.record.
 * In the app it goes through emitChatMessage (electron/services/claude.ts),
 * which only adds tool-result image externalization (no images here), the v1
 * IPC send and the v1 bus publish before/around the same record() call.
 *
 * The provider frames use the Claude Agent SDK / Codex SDK shapes as seen in
 * real sessions (ids, envelopes, usage, stream_event partials, task frames);
 * their text is authored and contains no user data. Replace these fixtures
 * with real userData/chatlog captures once the release has produced some.
 *
 * The store clock is synthetic (advance() + 1ms per read), so regenerating is
 * deterministic as long as the backends emit in the same order.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const h = vi.hoisted(() => ({
  claude: null as any,
  codex: null as any,
}));

vi.mock('../../../electron/services/claude', () => ({
  approveImpl: vi.fn().mockResolvedValue(undefined),
  answerQuestionImpl: vi.fn().mockResolvedValue(true),
  answerPlanReviewImpl: vi.fn().mockResolvedValue(true),
  alwaysAllowImpl: vi.fn().mockResolvedValue(true),
  generateCommitMessageImpl: vi.fn().mockResolvedValue('msg'),
  generateTitleImpl: vi.fn().mockResolvedValue('title'),
  getAvailableClaudeModels: vi.fn().mockReturnValue({ models: [], detected: false }),
  readCachedSlashCommands: vi.fn().mockReturnValue([]),
  writeCachedSlashCommands: vi.fn(),
  readSaiSetting: vi.fn().mockReturnValue(undefined),
  getRemoteCeiling: vi.fn().mockReturnValue(null),
  getMainWin: () => null,
  emitBackgroundTasks: () => {},
  spawnEnv: vi.fn().mockReturnValue({ PATH: '/usr/bin' }),
  getOrCreateWorkspace: vi.fn(),
}));
vi.mock('../../../electron/services/notify', () => ({
  notifyCompletion: vi.fn(), notifyApproval: vi.fn(), notifyQuestion: vi.fn(), notifyPlanReview: vi.fn(),
}));
vi.mock('../../../electron/services/claudeBackend/externalMcp', () => ({
  loadExternalMcpForSdk: () => ({ servers: {}, plugins: [] }),
}));
// createProviderDispatch's registry lookups resolve to this scenario's backends.
vi.mock('../../../electron/services/claudeBackend', () => ({
  getClaudeBackend: () => h.claude ?? { isScopeBusy: () => false },
  getClaudeBackendSetting: () => 'sdk',
}));
vi.mock('../../../electron/services/codexBackend', () => ({
  getCodexBackend: () => h.codex ?? { isScopeBusy: () => false },
}));
vi.mock('../../../electron/services/gemini', () => ({ getGeminiCommands: () => null }));
vi.mock('../../../electron/services/acpProvider', () => ({ getAcpCommands: () => null }));
vi.mock('../../../electron/services/workspace', () => ({ get: () => undefined, getOrCreate: () => undefined }));
vi.mock('../../../electron/services/loadGuard', () => ({ getLoadGuard: () => null }));

import { SdkBackend } from '../../../electron/services/claudeBackend/sdkBackend';
import { SdkCodexBackend, type CodexSdkClient, type CodexSdkThread } from '../../../electron/services/codexBackend/sdkBackend';
import { createProviderDispatch } from '../../../electron/services/chatlog/providerDispatch';
import { ChatLogStore } from '../../../electron/services/chatlog/store';
import { ChatLogService } from '../../../electron/services/chatlog/service';
import { ChatCommands } from '../../../electron/services/chatlog/commands';
import type { ChatSettings } from '../../../src/lib/chat/types';

const REGEN = process.env.SAI_REGEN_CHATLOG_FIXTURES === '1';
const OUT_DIR = path.resolve(__dirname, '../../fixtures/chatlog');
const PROJECT = '/home/user/project';
const MODEL = 'claude-opus-5-5';
const T0 = Date.UTC(2026, 10, 19, 9, 0, 0);

// ─── harness ─────────────────────────────────────────────────────────────────

const tick = (ms = 15) => new Promise<void>((r) => setTimeout(r, ms));

interface Rig {
  store: ChatLogStore;
  log: ChatLogService;
  cmds: { run(cmd: Parameters<ChatCommands['run']>[0]): ReturnType<ChatCommands['run']> };
  dir: string;
  /** Moves the synthetic store clock forward. */
  advance(ms: number): void;
  /** Resolves once the log holds `n` dones in total. */
  dones(n: number): Promise<void>;
  finish(name: string): void;
}

function rig(chatId: string, provider: ChatSettings['provider']): Rig {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlog-fixture-'));
  const clock = { t: T0 };
  const store = new ChatLogStore({ dir, now: () => (clock.t += 1), compactAfter: 100_000 });
  const log = new ChatLogService({
    store,
    sendToRenderer: () => {},
    bus: () => null,
    liveChats: () => [chatId],
    providerOf: () => provider,
    devlog: () => {},
  });
  const commands = new ChatCommands({ log, store, dispatch: createProviderDispatch() });
  // Every scripted command must succeed; a failed one would silently drop its events.
  const cmds = {
    async run(cmd: Parameters<ChatCommands['run']>[0]) {
      const res = await commands.run(cmd);
      if (!res.ok) throw new Error(`command ${cmd.kind} failed: ${res.error}`);
      return res;
    },
  };
  log.setTurnHooks({
    started: (id) => commands.onTurnStarted(id),
    ended: (id, ev) => commands.onTurnEnded(id, ev),
    idleDone: (id) => commands.onIdleDone(id),
    opened: (id) => commands.onChatOpened(id),
  });
  const countDones = () => store.read(chatId, 0).entries.filter((e) => e.ev.type === 'done').length;
  return {
    store, log, cmds, dir,
    advance: (ms) => { clock.t += ms; },
    async dones(n) {
      for (let i = 0; i < 400 && countDones() < n; i++) await tick(5);
      if (countDones() < n) console.log(store.read(chatId, 0).entries.map((e) => `${e.seq} ${e.ev.type} ${(e.ev as any).subtype ?? ''} ${(e.ev as any).turnSeq ?? ''}`).join('\n'));
      expect(countDones()).toBeGreaterThanOrEqual(n);
    },
    finish(name) {
      store.flush();
      const raw = fs.readFileSync(path.join(dir, `${chatId}.jsonl`), 'utf8');
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(path.join(OUT_DIR, `${name}.jsonl`), scrub(raw));
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Home paths → /home/user (the fixtures are authored, this is belt and braces). */
function scrub(raw: string): string {
  const home = os.homedir();
  const user = path.basename(home);
  let out = raw;
  for (const p of [home, `/var/home/${user}`, `/home/${user}`, os.tmpdir()]) {
    if (p && p !== '/') out = out.split(p).join(p === os.tmpdir() ? '/tmp' : '/home/user');
  }
  return out;
}

/** A live SDK query: frames are pushed by the scenario; `{ action }` items run in-stream. */
function pushQuery() {
  const queue: any[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  async function* gen() {
    while (!closed) {
      if (queue.length === 0) { await new Promise<void>((r) => { wake = r; }); continue; }
      const next = queue.shift();
      if (next && typeof next.action === 'function') { await next.action(); continue; }
      yield next;
    }
  }
  const iterator = gen();
  return {
    push(...frames: any[]) { queue.push(...frames); wake?.(); wake = null; },
    interrupt: vi.fn(async () => {}),
    close() { closed = true; wake?.(); wake = null; },
    [Symbol.asyncIterator]: () => iterator,
  };
}

function claudeBackend(log: ChatLogService) {
  const q = pushQuery();
  let options: any = null;
  const backend = new SdkBackend({
    queryFn: vi.fn((args: { options: any }) => { options = args.options; return q as any; }) as any,
    emit: (p) => { log.record(p); },
    emitTasks: () => {},
    resolveClaudePath: () => undefined,
    notify: { completion: vi.fn(), approval: vi.fn(), question: vi.fn(), planReview: vi.fn() } as any,
    publishUsage: () => {},
    judgeFollowUp: null,
  });
  /** The runtime runs Stop hooks before the result frame; this replays one with a task ledger. */
  const stopHook = (backgroundTasks: unknown[]) => ({
    action: async () => {
      for (const m of options?.hooks?.Stop ?? []) {
        for (const hook of m.hooks) {
          await hook({ hook_event_name: 'Stop', stop_hook_active: false, background_tasks: backgroundTasks }, undefined, { signal: new AbortController().signal });
        }
      }
    },
  });
  return { backend, q, stopHook };
}

// ─── Claude Agent SDK frame builders (shapes from real sessions) ───────────

function claudeFrames(sessionId: string) {
  let n = 0;
  const uuid = () => `9f3c2a10-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const env = { parent_tool_use_id: null, session_id: sessionId };
  const usage = (out: number) => ({
    input_tokens: 4, cache_creation_input_tokens: 1820, cache_read_input_tokens: 15342, output_tokens: out,
    service_tier: 'standard',
  });
  const message = (id: string, content: unknown[], out = 1) => ({
    model: MODEL, id, type: 'message', role: 'assistant', content, stop_reason: null, stop_sequence: null, usage: usage(out),
  });
  const ev = (event: unknown) => ({ type: 'stream_event', event, ...env, uuid: uuid() });
  return {
    init: () => ({
      type: 'system', subtype: 'init', cwd: PROJECT, session_id: sessionId,
      tools: ['Agent', 'Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write'], mcp_servers: [],
      model: MODEL, permissionMode: 'bypassPermissions', slash_commands: ['compact', 'review'],
      apiKeySource: 'none', claude_code_version: '2.1.325', output_style: 'default', agents: ['general-purpose'],
      skills: [], plugins: [], uuid: uuid(),
    }),
    messageStart: (id: string) => ev({ type: 'message_start', message: message(id, []) }),
    blockStart: (index: number, block: unknown) => ev({ type: 'content_block_start', index, content_block: block }),
    thinkingDelta: (index: number, thinking: string) => ev({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking } }),
    textDelta: (index: number, text: string) => ev({ type: 'content_block_delta', index, delta: { type: 'text_delta', text } }),
    jsonDelta: (index: number, partial_json: string) => ev({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json } }),
    blockStop: (index: number) => ev({ type: 'content_block_stop', index }),
    messageDelta: (stop: string, out: number) => ev({ type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: out } }),
    messageStop: () => ev({ type: 'message_stop' }),
    assistant: (id: string, block: unknown, out = 1) => ({ type: 'assistant', message: message(id, [block], out), ...env, uuid: uuid() }),
    toolResult: (toolUseId: string, content: unknown, toolUseResult: unknown) => ({
      type: 'user',
      message: { role: 'user', content: [{ tool_use_id: toolUseId, type: 'tool_result', content, is_error: false }] },
      ...env, uuid: uuid(), tool_use_result: toolUseResult,
    }),
    result: (resultText: string, numTurns: number, extra: Record<string, unknown> = {}) => ({
      type: 'result', subtype: 'success', is_error: false, duration_ms: 18_420, duration_api_ms: 16_903,
      num_turns: numTurns, result: resultText, stop_reason: 'end_turn', session_id: sessionId,
      total_cost_usd: 0.0731, usage: usage(412), modelUsage: {}, permission_denials: [],
      terminal_reason: 'completed', uuid: uuid(), ...extra,
    }),
    task: (subtype: string, fields: Record<string, unknown>) => ({ type: 'system', subtype, ...fields, session_id: sessionId, uuid: uuid() }),
    /** Text streamed as deltas, then the SDK's complete per-block assistant frame. */
    streamedText(id: string, index: number, chunks: string[]) {
      return [
        this.blockStart(index, { type: 'text', text: '' }),
        ...chunks.map((c) => this.textDelta(index, c)),
        this.blockStop(index),
        this.assistant(id, { type: 'text', text: chunks.join('') }, 40),
      ];
    },
    streamedThinking(id: string, index: number, chunks: string[]) {
      return [
        this.blockStart(index, { type: 'thinking', thinking: '', signature: '' }),
        ...chunks.map((c) => this.thinkingDelta(index, c)),
        this.blockStop(index),
        this.assistant(id, { type: 'thinking', thinking: chunks.join(''), signature: 'EqQBCkYIBxgCKkBzaWduYXR1cmUtcmVkYWN0ZWQ=' }),
      ];
    },
    streamedTool(id: string, index: number, toolId: string, name: string, input: Record<string, unknown>) {
      return [
        this.blockStart(index, { type: 'tool_use', id: toolId, name, input: {} }),
        this.jsonDelta(index, JSON.stringify(input)),
        this.blockStop(index),
        this.assistant(id, { type: 'tool_use', id: toolId, name, input, caller: { type: 'direct' } }, 60),
      ];
    },
  };
}

const desktopSettings = (provider: ChatSettings['provider'], extra: Partial<ChatSettings>) => ({
  kind: 'settings' as const, clientId: `settings-${provider}`, origin: 'desktop' as const,
  projectPath: PROJECT, settled: true, settings: { provider, ...extra },
});

// ─── scenarios ───────────────────────────────────────────────────────────────

describe.skipIf(!REGEN)('generate chat-log fixtures', () => {
  it('claude-tools-reasoning: Bash + Read with streamed reasoning', async () => {
    const chatId = 'chat-claude-tools-reasoning';
    const r = rig(chatId, 'claude');
    const { backend, q } = claudeBackend(r.log);
    h.claude = backend;
    const f = claudeFrames('5b1d7c2e-3a41-4f0e-9c55-1e2f3a4b5c6d');

    await r.cmds.run({ ...desktopSettings('claude', { model: MODEL, permMode: 'bypass', effort: 'high' }), chatId });
    r.advance(2_000);
    await r.cmds.run({ kind: 'send', chatId, clientId: 'u-1', origin: 'desktop', projectPath: PROJECT, settled: true, text: 'Which version does package.json declare, and does the lockfile agree?' });
    await tick();

    r.advance(900);
    q.push(f.init(), f.messageStart('msg_01A'));
    await tick();
    r.advance(400);
    q.push(...f.streamedThinking('msg_01A', 0, [
      'The user wants the declared version and whether the lockfile matches. ',
      'I can read the version with a quick node one-liner, ',
      'then read the top of package-lock.json to compare.',
    ]));
    await tick();
    r.advance(1_200);
    q.push(...f.streamedText('msg_01A', 1, ["I'll check the declared version", ' first.']));
    await tick();
    r.advance(600);
    q.push(...f.streamedTool('msg_01A', 2, 'toolu_01Bash', 'Bash', { command: "node -p \"require('./package.json').version\"", description: 'Print the package.json version' }));
    q.push(f.messageDelta('tool_use', 220), f.messageStop());
    await tick();
    r.advance(1_500);
    q.push(f.toolResult('toolu_01Bash', '1.37.1', { stdout: '1.37.1', stderr: '', interrupted: false, isImage: false }));
    await tick();

    r.advance(800);
    q.push(f.messageStart('msg_01B'));
    q.push(...f.streamedThinking('msg_01B', 0, ['Now compare with the lockfile header.']));
    await tick();
    r.advance(500);
    q.push(...f.streamedTool('msg_01B', 1, 'toolu_01Read', 'Read', { file_path: `${PROJECT}/package-lock.json`, limit: 6 }));
    q.push(f.messageDelta('tool_use', 140), f.messageStop());
    await tick();
    r.advance(300);
    const lock = '{\n  "name": "sai",\n  "version": "1.37.1",\n  "lockfileVersion": 3,\n  "requires": true,\n  "packages": {';
    q.push(f.toolResult(
      'toolu_01Read',
      lock.split('\n').map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join('\n'),
      { type: 'text', file: { filePath: `${PROJECT}/package-lock.json`, content: lock, numLines: 6, startLine: 1, totalLines: 14_211 } },
    ));
    await tick();

    r.advance(700);
    const answer = 'Both agree: `package.json` declares **1.37.1** and `package-lock.json` records the same version.';
    q.push(f.messageStart('msg_01C'));
    q.push(...f.streamedText('msg_01C', 0, ['Both agree: `package.json` declares **1.37.1**', ' and `package-lock.json` records the same version.']));
    q.push(f.messageDelta('end_turn', 48), f.messageStop());
    await tick();
    r.advance(200);
    q.push(f.result(answer, 3));
    await r.dones(1);
    await tick(30);

    q.close();
    backend.destroy();
    r.finish('claude-tools-reasoning');
  });

  it('claude-interrupt-superseded: send-now mid-stream stops turn 1, turn 2 runs', async () => {
    const chatId = 'chat-claude-interrupt-superseded';
    const r = rig(chatId, 'claude');
    const { backend, q } = claudeBackend(r.log);
    h.claude = backend;
    const f = claudeFrames('7c9e1f20-5b6a-4d3c-8e2f-0a1b2c3d4e5f');

    await r.cmds.run({ ...desktopSettings('claude', { model: MODEL, permMode: 'bypass', effort: 'high' }), chatId });
    r.advance(1_000);
    await r.cmds.run({ kind: 'send', chatId, clientId: 'u-1', origin: 'desktop', projectPath: PROJECT, settled: true, text: 'Write a long changelog entry for the queue strip.' });
    await tick();
    r.advance(800);
    q.push(f.init(), f.messageStart('msg_02A'));
    q.push(f.blockStart(0, { type: 'text', text: '' }));
    q.push(f.textDelta(0, '### Queue strip\n\n'), f.textDelta(0, '- Queued sends now show in a strip above the composer'));
    await tick();

    // The user changes their mind and hits send-now: ChatCommands stops the
    // live turn (backend interrupt → immediate done) and dispatches turn 2.
    r.advance(1_400);
    await r.cmds.run({ kind: 'send', chatId, clientId: 'u-2', origin: 'desktop', projectPath: PROJECT, now: true, text: 'Actually, keep it to one line.' });
    await tick();

    // The interrupted turn's late result drains from the same query: it is
    // stamped with turn 1's seq and must not end turn 2.
    r.advance(300);
    q.push({
      ...f.result('', 1, { subtype: 'error_during_execution', is_error: true, stop_reason: null, terminal_reason: 'aborted_streaming', errors: [] }),
      result: undefined,
    });
    await r.dones(2);
    await tick();

    r.advance(900);
    q.push(f.messageStart('msg_02B'));
    q.push(...f.streamedText('msg_02B', 0, ['Queued sends now wait in a strip', ' above the composer.']));
    q.push(f.messageDelta('end_turn', 14), f.messageStop());
    await tick();
    r.advance(200);
    q.push(f.result('Queued sends now wait in a strip above the composer.', 1));
    // done(1) from Stop, the late stale done(1), then turn 2's own done. The
    // late result reset the mapper, so turn 2's first frame re-arms as seq 3.
    await r.dones(3);
    await tick(30);

    q.close();
    backend.destroy();
    r.finish('claude-interrupt-superseded');
  });

  it('claude-background-wait: background Agent, wait, task completes, resumed turn', async () => {
    const chatId = 'chat-claude-background-wait';
    const r = rig(chatId, 'claude');
    const { backend, q, stopHook } = claudeBackend(r.log);
    h.claude = backend;
    const f = claudeFrames('2a4b6c8d-1e3f-4a5b-9c7d-8e9f0a1b2c3d');
    const agentInput = {
      description: 'Review parser changes',
      prompt: 'Review the uncommitted changes under src/parser for correctness bugs and report findings.',
      subagent_type: 'general-purpose',
      run_in_background: true,
    };

    await r.cmds.run({ ...desktopSettings('claude', { model: MODEL, permMode: 'bypass', effort: 'high' }), chatId });
    r.advance(1_000);
    await r.cmds.run({ kind: 'send', chatId, clientId: 'u-1', origin: 'desktop', projectPath: PROJECT, settled: true, text: 'Get a reviewer on the parser changes in the background.' });
    await tick();
    r.advance(700);
    q.push(f.init(), f.messageStart('msg_03A'));
    q.push(...f.streamedText('msg_03A', 0, ["I'll launch a reviewer", ' in the background.']));
    q.push(...f.streamedTool('msg_03A', 1, 'toolu_03Agent', 'Agent', agentInput));
    q.push(f.messageDelta('tool_use', 190), f.messageStop());
    await tick();
    r.advance(400);
    q.push(f.task('task_started', { task_id: 'a7f3e91c04b2d6e58', tool_use_id: 'toolu_03Agent', description: 'Review parser changes', subagent_type: 'general-purpose', task_type: 'local_agent', prompt: agentInput.prompt }));
    q.push(f.toolResult(
      'toolu_03Agent',
      [{ type: 'text', text: 'Async agent launched successfully.\nagentId: a7f3e91c04b2d6e58 (internal ID - do not mention to user. Use SendMessage with to: \'a7f3e91c04b2d6e58\' to continue this agent.)\nThe agent is working in the background. You will be notified automatically when it completes.' }],
      { isAsync: true, status: 'async_launched', agentId: 'a7f3e91c04b2d6e58', description: 'Review parser changes', prompt: agentInput.prompt },
    ));
    await tick();
    r.advance(900);
    q.push(f.messageStart('msg_03B'));
    q.push(...f.streamedText('msg_03B', 0, ["The reviewer is running. I'll report", ' its findings when it finishes.']));
    q.push(f.messageDelta('end_turn', 22), f.messageStop());
    await tick();
    q.push(stopHook([{ id: 'a7f3e91c04b2d6e58', type: 'subagent', status: 'running', description: 'Review parser changes' }]));
    r.advance(100);
    q.push(f.result("The reviewer is running. I'll report its findings when it finishes.", 2));
    await r.dones(1);
    await tick();

    // Waiting: the query stays live while the background agent works.
    r.advance(45_000);
    q.push(f.task('task_progress', { task_id: 'a7f3e91c04b2d6e58', tool_use_id: 'toolu_03Agent', description: 'Reading src/parser/tokenize.ts', usage: { total_tokens: 18_204, tool_uses: 6, duration_ms: 44_100 } }));
    await tick();
    r.advance(40_000);
    q.push(f.task('task_notification', {
      task_id: 'a7f3e91c04b2d6e58', tool_use_id: 'toolu_03Agent', status: 'completed',
      output_file: '/tmp/claude-1000/tasks/a7f3e91c04b2d6e58.output',
      summary: 'Agent "Review parser changes" completed',
      usage: { total_tokens: 31_877, tool_uses: 11, duration_ms: 84_950 },
    }));
    await tick();

    // The runtime re-invokes the model with the task result: a resumed turn.
    r.advance(1_100);
    q.push(f.messageStart('msg_03C'));
    await tick();
    r.advance(1_600);
    q.push(...f.streamedText('msg_03C', 0, ['The reviewer found one issue: `tokenize()` drops a trailing', ' escaped quote. Everything else looks correct.']));
    q.push(f.messageDelta('end_turn', 31), f.messageStop());
    await tick();
    q.push(stopHook([]));
    r.advance(100);
    q.push(f.result('The reviewer found one issue: `tokenize()` drops a trailing escaped quote. Everything else looks correct.', 1));
    await r.dones(2);
    await tick(30);

    q.close();
    backend.destroy();
    r.finish('claude-background-wait');
  });

  it('codex-two-turns: the second turn reuses the first turn\'s item ids', async () => {
    const chatId = 'chat-codex-two-turns';
    const r = rig(chatId, 'codex');
    const streams: Array<Array<Record<string, unknown>>> = [];
    let resolveTurn: (() => void) | null = null;
    const thread = (id: string | null): CodexSdkThread => ({
      id,
      runStreamed: vi.fn(async () => {
        const events = streams.shift() ?? [];
        return {
          events: (async function* () {
            for (const ev of events) {
              if ((ev as any).__advance) { r.advance((ev as any).__advance); continue; }
              yield ev as any;
              await tick(2);
            }
            resolveTurn?.();
          })(),
        };
      }) as any,
    });
    const client: CodexSdkClient = {
      startThread: vi.fn(() => thread(null)) as any,
      resumeThread: vi.fn((id: string) => thread(id)) as any,
    };
    const backend = new SdkCodexBackend({
      createClient: () => client,
      emit: (p) => { r.log.record(p); },
      getModels: async () => ({ models: [{ id: 'gpt-5-codex', name: 'GPT-5 Codex' }], defaultModel: 'gpt-5-codex' }),
      getEnv: () => ({ PATH: '/usr/bin' }),
      registerWorkspace: () => {},
      notifyCompletion: () => {},
    });
    h.codex = backend;
    const usage = { input_tokens: 9_812, cached_input_tokens: 7_424, output_tokens: 311, reasoning_output_tokens: 128 };
    const adv = (ms: number) => ({ __advance: ms });

    streams.push([
      { type: 'thread.started', thread_id: '019a8c3e-5f21-7d40-a2b1-3c4d5e6f7a8b' },
      { type: 'turn.started' },
      adv(2_100),
      { type: 'item.completed', item: { id: 'item_0', type: 'reasoning', text: '**Listing scripts**\n\nI can ask npm for the scripts block of package.json.' } },
      adv(300),
      { type: 'item.started', item: { id: 'item_1', type: 'command_execution', command: "bash -lc 'npm pkg get scripts'", aggregated_output: '', status: 'in_progress' } },
      adv(800),
      { type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: "bash -lc 'npm pkg get scripts'", aggregated_output: '{\n  "dev": "vite",\n  "build": "vite build",\n  "test": "vitest",\n  "lint": "eslint ."\n}\n', exit_code: 0, status: 'completed' } },
      adv(1_500),
      { type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'The project defines four scripts: `dev`, `build`, `test` and `lint`.' } },
      adv(100),
      { type: 'turn.completed', usage },
    ]);
    streams.push([
      { type: 'turn.started' },
      adv(1_800),
      { type: 'item.completed', item: { id: 'item_0', type: 'reasoning', text: '**Running lint**\n\nRun the lint script and report the result.' } },
      adv(200),
      { type: 'item.started', item: { id: 'item_1', type: 'command_execution', command: "bash -lc 'npm run lint'", aggregated_output: '', status: 'in_progress' } },
      adv(1_200),
      { type: 'item.updated', item: { id: 'item_1', type: 'command_execution', command: "bash -lc 'npm run lint'", aggregated_output: '\n> project@1.0.0 lint\n> eslint .\n\n', status: 'in_progress' } },
      adv(2_600),
      { type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: "bash -lc 'npm run lint'", aggregated_output: '\n> project@1.0.0 lint\n> eslint .\n\n', exit_code: 0, status: 'completed' } },
      adv(900),
      { type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'Lint passes with no warnings.' } },
      adv(100),
      { type: 'turn.completed', usage },
    ]);

    await r.cmds.run({ ...desktopSettings('codex', { model: 'gpt-5-codex', permMode: 'auto', effort: 'medium' }), chatId });
    r.advance(1_000);
    let ended = new Promise<void>((res) => { resolveTurn = res; });
    await r.cmds.run({ kind: 'send', chatId, clientId: 'u-1', origin: 'desktop', projectPath: PROJECT, settled: true, text: 'What scripts does package.json define?' });
    await ended;
    await r.dones(1);
    await tick();

    r.advance(20_000);
    ended = new Promise<void>((res) => { resolveTurn = res; });
    await r.cmds.run({ kind: 'send', chatId, clientId: 'u-2', origin: 'desktop', projectPath: PROJECT, text: 'Run the lint one.' });
    await ended;
    await r.dones(2);
    await tick(30);

    r.finish('codex-two-turns');
  });
});
