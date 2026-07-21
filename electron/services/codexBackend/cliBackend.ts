import { spawn, type ChildProcess } from 'node:child_process';
import type { BrowserWindow } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { notifyCompletion } from '../notify';
import { get, getOrCreate, touchActivity } from '../workspace';
import {
  codexScope,
  type CodexBackend,
  type CodexModelResult,
  type CodexSendArgs,
  type CodexStartArgs,
} from './types';

type LegacyEvent = Record<string, any>;

interface CliRuntime {
  selectedScope: string;
  active?: ActiveCliTurn;
}

interface ActiveCliTurn {
  readonly scope: string;
  readonly turnSeq: number;
  readonly process: ChildProcess;
  doneSent: boolean;
}

/** Build the same desktop-safe environment used by the original Codex service. */
function getEnrichedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (process.platform === 'win32') return env;

  const home = os.homedir();
  const extraPaths: string[] = [];
  const nvmDir = path.join(home, '.nvm', 'versions', 'node');
  if (fs.existsSync(nvmDir)) {
    try {
      for (const version of fs.readdirSync(nvmDir)) {
        extraPaths.push(path.join(nvmDir, version, 'bin'));
      }
    } catch { /* ignore unreadable nvm installs */ }
  }
  extraPaths.push(path.join(home, '.local', 'bin'), '/usr/local/bin');

  const currentPath = env.PATH || '';
  const pathSet = new Set(currentPath.split(path.delimiter));
  const additions = extraPaths.filter((entry) => !pathSet.has(entry));
  if (additions.length > 0) {
    env.PATH = currentPath + path.delimiter + additions.join(path.delimiter);
  }
  return env;
}

function safeSend(win: BrowserWindow, event: LegacyEvent): void {
  try {
    if (!win.isDestroyed()) win.webContents.send('claude:message', event);
  } catch { /* window destroyed */ }
}

function translateEvent(msg: LegacyEvent, projectPath: string): LegacyEvent[] {
  const events: LegacyEvent[] = [];
  switch (msg.type) {
    case 'thread.started':
      if (msg.thread_id) events.push({ type: 'session_id', sessionId: msg.thread_id, projectPath });
      break;
    case 'turn.started':
      break;
    case 'item.started': {
      const item = msg.item;
      if (item?.type === 'command_execution') {
        events.push({
          type: 'assistant',
          projectPath,
          message: { content: [{ id: item.id, type: 'tool_use', name: 'Bash', input: { command: item.command || '' } }] },
        });
      } else if (item?.type === 'file_change') {
        events.push({
          type: 'assistant',
          projectPath,
          message: { content: [{ id: item.id, type: 'tool_use', name: 'Edit', input: { file_path: item.file_path || item.path || '' } }] },
        });
      }
      break;
    }
    case 'item.completed': {
      const item = msg.item;
      if (item?.type === 'agent_message' && item?.text) {
        events.push({ type: 'assistant', projectPath, message: { content: [{ type: 'text', text: item.text }] } });
      } else if (item?.type === 'command_execution' && item?.id) {
        events.push({
          type: 'user',
          projectPath,
          message: { content: [{
            type: 'tool_result',
            tool_use_id: item.id,
            content: item.aggregated_output || '',
            is_error: (item.exit_code || 0) !== 0,
          }] },
        });
      } else if (item?.type === 'reasoning' && item?.text) {
        events.push({ type: 'assistant', projectPath, message: { content: [{ type: 'text', text: item.text }] } });
      }
      break;
    }
    case 'turn.completed':
      events.push({
        type: 'result',
        projectPath,
        ...(msg.usage ? { usage: {
          input_tokens: msg.usage.input_tokens || 0,
          cache_read_input_tokens: msg.usage.cached_input_tokens || 0,
          cache_creation_input_tokens: 0,
          output_tokens: msg.usage.output_tokens || 0,
        } } : {}),
      });
      events.push({ type: 'done', projectPath });
      break;
    case 'turn.failed':
    case 'error':
      events.push({ type: 'error', projectPath, text: msg.message || msg.error || 'Codex error' });
      events.push({ type: 'done', projectPath });
      break;
  }
  return events;
}

let cachedModels: CodexModelResult | null = null;

/** Fetch and cache the model list exposed by `codex app-server`. */
export function fetchCodexModels(forceRefresh = false): Promise<CodexModelResult> {
  if (!forceRefresh && cachedModels) return Promise.resolve(cachedModels);

  return new Promise((resolve) => {
    const fallback: CodexModelResult = { models: [], defaultModel: '' };
    let proc: ChildProcess;
    try {
      proc = spawn('codex', ['app-server'], {
        env: getEnrichedEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });
    } catch {
      resolve(fallback);
      return;
    }
    let buffer = '';
    let resolved = false;
    const finish = (result: CodexModelResult) => {
      if (resolved) return;
      resolved = true;
      if (result.models.length > 0) cachedModels = result;
      try { proc.kill(); } catch { /* already dead */ }
      resolve(result);
    };
    const timeout = setTimeout(() => finish(fallback), 10_000);

    const processLine = (line: string) => {
      if (!line.trim() || resolved) return;
      try {
        const msg = JSON.parse(line);
        if (msg.id === 0 && !msg.error) {
          proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method: 'model/list', id: 1, params: {} }) + '\n');
        }
        if (msg.id === 1 && msg.result) {
          const data = msg.result.data || [];
          const models = data
            .filter((model: any) => !model.hidden)
            .map((model: any) => ({ id: model.model, name: model.displayName || model.model }));
          const defaultModel = data.find((model: any) => model.isDefault)?.model || models[0]?.id || '';
          clearTimeout(timeout);
          finish({ models, defaultModel });
        }
        if (msg.error) {
          clearTimeout(timeout);
          finish(fallback);
        }
      } catch { /* malformed JSON */ }
    };
    proc.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        processLine(line);
      }
    });
    proc.on('error', () => { clearTimeout(timeout); finish(fallback); });
    proc.on('exit', () => {
      clearTimeout(timeout);
      // stdout may deliver its final `data`/`end` callbacks immediately after
      // the child exit callback. Defer the fallback one turn so a complete
      // unterminated JSON-RPC response can still be parsed.
      setTimeout(() => {
        if (buffer.trim()) processLine(buffer);
        if (!resolved) finish(fallback);
      }, 0);
    });
    proc.stdin?.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      id: 0,
      params: { clientInfo: { name: 'sai', version: '1.0' } },
    }) + '\n');
  });
}

/** Legacy one-process-per-workspace Codex CLI transport. */
export class CliCodexBackend implements CodexBackend {
  private readonly runtimes = new Map<string, CliRuntime>();

  constructor(private readonly win: BrowserWindow) {}

  start(args: CodexStartArgs): void {
    const ws = getOrCreate(args.projectPath);
    ws.codex.cwd = args.scopeCwd || args.projectPath;
    ws.codex.metaPreamble = args.metaPreamble || '';
    const scope = codexScope(args.scope);
    this.runtime(args.projectPath, scope).selectedScope = scope;
    this.emit({ type: 'ready', projectPath: ws.projectPath }, scope);
  }

  send(args: CodexSendArgs): void {
    const ws = get(args.projectPath);
    if (!ws) return;
    touchActivity(args.projectPath);
    const runtime = this.runtime(args.projectPath, args.scope);
    const scope = codexScope(args.scope);
    runtime.selectedScope = scope;

    if (runtime.active) this.retireTurn(args.projectPath, runtime, runtime.active, true);

    const spawnArgs: string[] = ws.codex.sessionId
      ? ['exec', 'resume', '--json', ws.codex.sessionId]
      : ['exec', '--json'];
    if (args.model) spawnArgs.push('-m', args.model);
    if (args.permission === 'full-access') {
      spawnArgs.push('--dangerously-bypass-approvals-and-sandbox');
    } else if (args.permission === 'read-only') {
      spawnArgs.push('--sandbox', 'read-only');
    } else {
      spawnArgs.push('--full-auto');
    }
    for (const imagePath of args.imagePaths || []) spawnArgs.push('-i', imagePath);
    spawnArgs.push(args.message);

    const turnSeq = ++ws.codex.turnSeq;
    let proc: ChildProcess;
    try {
      proc = spawn('codex', spawnArgs, {
        cwd: ws.codex.cwd || args.projectPath,
        env: getEnrichedEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });
    } catch (error) {
      ws.codex.process = null;
      ws.codex.busy = false;
      ws.codex.buffer = '';
      const text = error instanceof Error ? error.message : String(error);
      this.emit({ type: 'streaming_start', projectPath: ws.projectPath, turnSeq, sessionId: ws.codex.sessionId ?? null }, scope);
      this.emit({ type: 'error', text: `Codex process error: ${text}`, projectPath: ws.projectPath, turnSeq }, scope);
      this.emit({ type: 'done', projectPath: ws.projectPath, turnSeq }, scope);
      return;
    }
    proc.stdin?.end();

    const turn: ActiveCliTurn = { scope, turnSeq, process: proc, doneSent: false };
    runtime.active = turn;
    ws.codex.process = proc;
    ws.codex.busy = true;
    ws.codex.buffer = '';
    this.emit({
      type: 'streaming_start',
      projectPath: ws.projectPath,
      turnSeq,
      sessionId: ws.codex.sessionId ?? null,
    }, scope);

    proc.stdout?.on('data', (data: Buffer) => {
      if (!this.isActive(runtime, turn)) return;
      ws.codex.buffer += data.toString();
      const lines = ws.codex.buffer.split('\n');
      ws.codex.buffer = lines.pop() || '';
      for (const line of lines) this.processLine(line, ws.projectPath, runtime, turn);
    });
    proc.stderr?.on('data', (data: Buffer) => {
      if (!this.isActive(runtime, turn)) return;
      const text = data.toString().trim();
      if (!text || text.toLowerCase().includes('reading additional input from stdin')) return;
      this.emit({ type: 'error', text, projectPath: ws.projectPath, turnSeq }, turn.scope);
    });
    proc.on('exit', () => {
      if (!this.isActive(runtime, turn)) return;
      if (ws.codex.buffer.trim()) this.processLine(ws.codex.buffer, ws.projectPath, runtime, turn);
      const wasBusy = ws.codex.busy;
      ws.codex.buffer = '';
      ws.codex.process = null;
      ws.codex.busy = false;
      runtime.active = undefined;
      if (wasBusy) this.emitDone(ws.projectPath, turn);
    });
    proc.on('error', (error) => {
      if (!this.isActive(runtime, turn)) return;
      ws.codex.process = null;
      ws.codex.busy = false;
      runtime.active = undefined;
      this.emit({ type: 'error', text: `Codex process error: ${error.message}`, projectPath: ws.projectPath, turnSeq }, turn.scope);
      this.emitDone(ws.projectPath, turn);
    });
  }

  interrupt(projectPath: string, scope?: string): void {
    const ws = get(projectPath);
    const runtime = this.runtime(projectPath, scope);
    const requestedScope = codexScope(scope);
    if (!ws || !runtime.active || runtime.active.scope !== requestedScope) return;
    runtime.selectedScope = requestedScope;
    this.retireTurn(projectPath, runtime, runtime.active, true);
  }

  reconcileScope(projectPath: string, scope?: string): void {
    const ws = get(projectPath);
    const runtime = this.runtime(projectPath, scope);
    const requestedScope = codexScope(scope);
    if (ws?.codex.busy && runtime.active?.scope === requestedScope) return;
    runtime.selectedScope = requestedScope;
    this.emit({ type: 'done', projectPath, turnSeq: null }, requestedScope);
  }

  setSessionId(projectPath: string, sessionId: string | undefined, scope?: string): void {
    const ws = get(projectPath);
    if (!ws) return;
    const runtime = this.runtime(projectPath, scope);
    const requestedScope = codexScope(scope);
    // Chat selection can replay setSessionId while a response is streaming.
    // Any active turn owns the workspace-global CLI process and session until
    // it settles, regardless of whether the incoming scope matches.
    if (runtime.active) return;
    runtime.selectedScope = requestedScope;
    ws.codex.sessionId = sessionId;
  }

  getModels(forceRefresh = false): Promise<CodexModelResult> {
    return fetchCodexModels(forceRefresh);
  }

  suspendWorkspace(projectPath: string): void {
    const ws = get(projectPath);
    if (!ws) return;
    const runtime = this.runtimes.get(projectPath);
    if (runtime?.active) this.retireTurn(projectPath, runtime, runtime.active, false);
    else {
      if (ws.codex.process) {
        const proc = ws.codex.process;
        ws.codex.process = null;
        proc.kill();
      }
      ws.codex.busy = false;
    }
  }

  isWorkspaceBusy(projectPath: string): boolean {
    return get(projectPath)?.codex.busy ?? false;
  }

  destroy(): void {
    for (const projectPath of this.runtimes.keys()) this.suspendWorkspace(projectPath);
    this.runtimes.clear();
  }

  private runtime(projectPath: string, scope?: string): CliRuntime {
    let runtime = this.runtimes.get(projectPath);
    if (!runtime) {
      runtime = { selectedScope: codexScope(scope) };
      this.runtimes.set(projectPath, runtime);
    }
    return runtime;
  }

  private processLine(line: string, projectPath: string, runtime: CliRuntime, turn: ActiveCliTurn): void {
    if (!line.trim()) return;
    const ws = get(projectPath);
    if (!ws || !this.isActive(runtime, turn)) return;
    try {
      const msg = JSON.parse(line);
      if (msg.type === 'thread.started' && msg.thread_id && !ws.codex.sessionId) {
        ws.codex.sessionId = msg.thread_id;
      }
      for (const event of translateEvent(msg, ws.projectPath)) {
        if (event.type === 'done') this.emitDone(projectPath, turn);
        else this.emit({ ...event, turnSeq: turn.turnSeq }, turn.scope);
      }
      if (msg.type === 'turn.completed' || msg.type === 'turn.failed' || msg.type === 'error') {
        const wasBusy = ws.codex.busy;
        ws.codex.busy = false;
        if (wasBusy && (msg.type === 'turn.completed' || msg.type === 'turn.failed')) {
          setTimeout(() => notifyCompletion(this.win, ws.projectPath, { provider: 'Codex' }), 500);
        }
      }
    } catch { /* malformed JSON */ }
  }

  private emit(event: LegacyEvent, scope: string): void {
    event.scope = scope;
    safeSend(this.win, event);
  }

  private emitDone(projectPath: string, turn: ActiveCliTurn): void {
    if (turn.doneSent) return;
    turn.doneSent = true;
    this.emit({ type: 'done', projectPath, turnSeq: turn.turnSeq }, turn.scope);
  }

  private isActive(runtime: CliRuntime, turn: ActiveCliTurn): boolean {
    return runtime.active === turn && runtime.active.process === turn.process;
  }

  private retireTurn(projectPath: string, runtime: CliRuntime, turn: ActiveCliTurn, sendDone: boolean): void {
    if (!this.isActive(runtime, turn)) return;
    const ws = get(projectPath);
    if (ws?.codex.process === turn.process) ws.codex.process = null;
    if (ws) {
      ws.codex.busy = false;
      ws.codex.buffer = '';
    }
    runtime.active = undefined;
    try { turn.process.kill(); } catch { /* already dead */ }
    if (sendDone) this.emitDone(projectPath, turn);
  }
}
