// A fake SAI desktop for the phone e2e (playwright.mobile.config.ts): the real
// BridgeServer, ChatLogStore, ChatLogService and ChatCommands, with a scripted
// provider dispatch that streams a reply word by word (text deltas, as the
// Claude SDK backend logs them) and honours stop.
//
// Run with `npx jiti tests/e2e-mobile/fakeDesktop.ts`. A small control server
// lets the specs mint pairing links and read the desktop's chat list.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BridgeServer } from '../../electron/services/remote/bridge-server';
import { PairingStore } from '../../electron/services/remote/pairing-store';
import { SessionBus } from '../../electron/services/remote/session-bus';
import { WorkspaceRegistry } from '../../electron/services/remote/workspaceRegistry';
import { AppSettingsFeed, pickRemoteAppSettings } from '../../electron/services/remote/appSettings';
import { ChatLogStore } from '../../electron/services/chatlog/store';
import { ChatLogService } from '../../electron/services/chatlog/service';
import { ChatCommands, type ProviderDispatch } from '../../electron/services/chatlog/commands';

export const BRIDGE_PORT = Number(process.env.SAI_FAKE_BRIDGE_PORT ?? 17897);
export const CONTROL_PORT = Number(process.env.SAI_FAKE_CONTROL_PORT ?? 17898);
/** Words in every scripted reply, and the delay between them. */
const REPLY_WORDS = Number(process.env.SAI_FAKE_REPLY_WORDS ?? 60);
const WORD_MS = Number(process.env.SAI_FAKE_WORD_MS ?? 120);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-fake-desktop-'));
const logDir = path.join(root, 'chatlog');
const project = path.join(root, 'demo');
fs.mkdirSync(project, { recursive: true });

const store = new ChatLogStore({ dir: logDir });
const bus = new SessionBus();
const service = new ChatLogService({
  store, bus: () => bus, sendToRenderer: () => {}, liveChats: () => [], providerOf: () => 'claude', devlog: () => {},
});

interface Stream { timer: NodeJS.Timeout; turnSeq: number; projectPath: string }
const streams = new Map<string, Stream>();
let turnSeq = 0;

function finish(scope: string): void {
  const s = streams.get(scope);
  if (!s) return;
  clearInterval(s.timer);
  streams.delete(scope);
  service.record({ type: 'done', projectPath: s.projectPath, scope, turnSeq: s.turnSeq });
}

const dispatch: ProviderDispatch = {
  send(_provider, { projectPath, scope, prompt }) {
    finish(scope);
    const t = ++turnSeq;
    service.record({ type: 'streaming_start', projectPath, scope, turnSeq: t });
    let i = 0;
    const timer = setInterval(() => {
      i++;
      const wide = /wide/.test(String(prompt)) && i === 2
        ? '\n\nhttps://example.com/a/very/long/unbroken/path/that/keeps/going/and/going/forever/and/ever\n\n```ts\nconst somethingQuiteLong = callAFunctionWithAVeryLongName(argumentNumberOne, argumentNumberTwo, three);\n```\n\n| col a | col b | col c | col d |\n|---|---|---|---|\n| aaaaaaaaaa | bbbbbbbbbbbb | cccccccccccc | dddddddddddd |\n\n'
        : null;
      const text = wide ?? (i === 1 ? `Echo: ${prompt}. ` : `word${i} `);
      service.record({ type: 'assistant', projectPath, scope, turnSeq: t, message: { content: [{ type: 'text', text, delta: true }] } });
      // Mid-reply the runtime reports context usage: the composer grows its context ring and usage pill.
      if (i === 2) service.record({ type: 'context_usage', projectPath, scope, totalTokens: 84_000, maxTokens: 200_000 });
      // A prompt mentioning "tools" interleaves Bash tool calls (call, then its output a few words later).
      if (/tools/.test(String(prompt)) && i % 6 === 3) {
        const id = `tu-${t}-${i}`;
        service.record({ type: 'assistant', projectPath, scope, turnSeq: t, message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command: `ls -la /tmp/step${i}` } }] } });
        setTimeout(() => {
          const out = Array.from({ length: 12 }, (_, k) => `line ${k} of step ${i}`).join('\n');
          service.record({ type: 'user', projectPath, scope, turnSeq: t, message: { content: [{ type: 'tool_result', tool_use_id: id, content: out }] } });
        }, WORD_MS * 2);
      }
      if (i >= REPLY_WORDS) {
        service.record({ type: 'assistant', projectPath, scope, turnSeq: t, message: { content: [{ type: 'text', text: 'All done.', delta: true }] } });
        finish(scope);
      }
    }, WORD_MS);
    streams.set(scope, { timer, turnSeq: t, projectPath });
  },
  stop(_provider, _projectPath, scope) { finish(scope); },
  approve: async () => {},
  answer: async () => {},
  planReview: async () => {},
  isBusy: (_projectPath, scope) => streams.has(scope),
  isLoadPaused: () => false,
};

const commands = new ChatCommands({ log: service, store, dispatch });
// As electron/main.ts wires them: turn starts clear the in-flight mark, turn ends drain the queue.
service.setTurnHooks({
  started: (chatId) => commands.onTurnStarted(chatId),
  ended: (chatId, ev) => commands.onTurnEnded(chatId, ev),
  idleDone: (chatId) => commands.onIdleDone(chatId),
  opened: (chatId) => commands.onChatOpened(chatId),
});

const workspaces = new WorkspaceRegistry();
workspaces.set([{ projectPath: project, name: 'demo', kind: 'project', state: 'active' }]);
const appSettings = new AppSettingsFeed(() => pickRemoteAppSettings({ theme: 'default' }, null));

const pairing = new PairingStore(':memory:');
const bridge = new BridgeServer({
  tailnetIp: '127.0.0.1', pairing, bus, pwaDir: null, screenshotSecret: 'e2e', loadScreenshot: async () => null,
  port: BRIDGE_PORT, fallbackPorts: [],
  chatSync: () => ({ store, commands }),
  workspaces, appSettings,
  listModels: (provider) => (provider === 'claude'
    ? { models: [{ id: 'sonnet', label: 'Sonnet', description: 'Fast', recommended: true }] }
    : { models: [] }),
});

const control = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${CONTROL_PORT}`);
  const json = (code: number, body: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === '/health') return json(200, { ok: true });
  if (url.pathname === '/pair-url') {
    const code = bridge.mintPairingCode();
    return json(200, { url: `http://127.0.0.1:${BRIDGE_PORT}/?code=${code}`, projectPath: project });
  }
  if (url.pathname === '/chats') return json(200, { chats: store.list(project) });
  return json(404, { error: 'not found' });
});

async function main(): Promise<void> {
  const { port } = await bridge.start();
  if (port !== BRIDGE_PORT) throw new Error(`bridge took port ${port}, wanted ${BRIDGE_PORT}`);
  await new Promise<void>((r) => control.listen(CONTROL_PORT, '127.0.0.1', () => r()));
  console.log(`[fake-desktop] bridge :${BRIDGE_PORT}, control :${CONTROL_PORT}, project ${project}`);
}

function shutdown(): void {
  for (const scope of [...streams.keys()]) finish(scope);
  control.close();
  void bridge.stop().finally(() => {
    try { store.close(); } catch { /* already closed */ }
    fs.rmSync(root, { recursive: true, force: true });
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((err) => {
  console.error('[fake-desktop] failed to start', err);
  process.exit(1);
});
