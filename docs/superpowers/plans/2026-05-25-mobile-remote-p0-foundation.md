# Mobile Remote — Phase 0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the foundation for SAI's mobile remote — Tailscale-only bridge, QR pairing, argon2id-hashed bearer tokens, RemoteModule supervisor, separate PWA Vite entry, and Settings UI. PWA shows only a "paired ✓" status screen; chat lands in Phase 1.

**Architecture:** Port Otto's `src/main/remote/` module (see `../../../otto/src/main/remote/`) into `electron/services/remote/` with SAI-specific adaptations: separate SQLite DB at `<userData>/sai-remote.db`, IPC + Settings tab in existing `SettingsModal`, standalone `vite.config.pwa.ts` for the PWA bundle, tests in SAI's `tests/unit/` and `tests/integration/` layout (not co-located).

**Tech Stack:** Node `http`, `ws`, `better-sqlite3`, `argon2`, `qrcode`, Electron preload IPC, React+Vite for the PWA, Tailwind, vitest for tests.

**Spec:** `docs/superpowers/specs/2026-05-25-mobile-remote-p0-foundation-design.md`. **Roadmap:** `docs/superpowers/specs/2026-05-25-mobile-remote-roadmap.md`. **Reference:** Otto's `src/main/remote/`.

---

## Pre-flight notes

- SAI's vitest uses three projects (`unit`, `integration`, `swarm`); tests live in `tests/unit/**`, `tests/integration/**`, not co-located. Use those paths.
- SAI already has `@electron/rebuild` and a `postinstall` rebuild for `node-pty`; extend it for `better-sqlite3` and `argon2`.
- SAI's preload exposes the `sai.*` global via `contextBridge.exposeInMainWorld('sai', ...)`. Add `sai.remote.*` IPC handlers to the same global.
- `SettingsModal.tsx` uses a `SettingsPage` string union; add `'remote'`.
- For files that port near-verbatim from Otto, the plan calls out the source file and any SAI-specific adaptations rather than reprinting verbatim code. Engineers should `cat ../otto/src/main/remote/<file>.ts` and adapt — Otto's tests are also valuable reference reading.

---

## Task 1: Add dependencies and native rebuild

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime deps**

```bash
npm install better-sqlite3 argon2 ws qrcode
npm install --save-dev @types/ws @types/qrcode @types/better-sqlite3
```

- [ ] **Step 2: Extend postinstall to rebuild new native modules**

Update the `postinstall` script in `package.json`:

```json
"postinstall": "electron-rebuild -w node-pty -w better-sqlite3 -w argon2"
```

- [ ] **Step 3: Run postinstall to rebuild**

```bash
npm run postinstall
```

Expected: `node-pty`, `better-sqlite3`, `argon2` all rebuild successfully against Electron's ABI.

- [ ] **Step 4: Mark new native modules as external in vite-plugin-electron config**

Edit `vite.config.ts`, extend the main entry's `external` array:

```ts
external: ['electron', 'node-pty', 'simple-git', 'electron-updater', 'better-sqlite3', 'argon2'],
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vite.config.ts
git commit -m "feat(remote): add deps for mobile remote bridge"
```

---

## Task 2: Create module scaffold

**Files:**
- Create: `electron/services/remote/` (directory)
- Create: `electron/services/remote/README.md` (one-paragraph stub describing the module)
- Create: `tests/unit/remote/` (directory)
- Create: `tests/integration/remote/` (directory)

- [ ] **Step 1: Create directories and stub README**

```bash
mkdir -p electron/services/remote tests/unit/remote tests/integration/remote
```

Write `electron/services/remote/README.md`:

```markdown
# Mobile Remote

Bridge between the desktop SAI Electron app and a Tailscale-private PWA running on the user's phone. See `docs/superpowers/specs/2026-05-25-mobile-remote-roadmap.md`.

Modules:
- `tailnet.ts` — resolves the Tailscale IP/hostname for this host
- `pairing-store.ts` — argon2id-hashed bearer tokens, single-table sqlite
- `screenshot-urls.ts` — signed single-use URLs for binary payloads
- `session-bus.ts` — output fan-out: subscribeAll + per-topic subscribe + history
- `bridge-server.ts` — HTTP + WS, binds tailnet IP only
- `index.ts` — RemoteModule supervisor

Tests live under `tests/unit/remote/` and `tests/integration/remote/` per SAI's vitest project layout.
```

- [ ] **Step 2: Commit**

```bash
git add electron/services/remote/README.md
git commit -m "chore(remote): scaffold module directory"
```

---

## Task 3: `tailnet.ts` — Tailscale resolver

**Files:**
- Create: `electron/services/remote/tailnet.ts`
- Create: `tests/unit/remote/tailnet.test.ts`

Port from `../otto/src/main/remote/tailnet.ts` verbatim (zero SAI-specific changes).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/remote/tailnet.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveTailnetIp, resolveTailnetEndpoint } from '@electron/services/remote/tailnet';

describe('resolveTailnetIp', () => {
  it('returns first IPv4 from tailscale ip -4', async () => {
    const exec = async () => ({ stdout: '100.64.1.5\nfd7a:115c::1\n', stderr: '', code: 0 });
    expect(await resolveTailnetIp({ exec })).toBe('100.64.1.5');
  });

  it('returns null when CLI exits non-zero', async () => {
    const exec = async () => ({ stdout: '', stderr: 'not running', code: 1 });
    expect(await resolveTailnetIp({ exec })).toBeNull();
  });

  it('returns null on garbage output', async () => {
    const exec = async () => ({ stdout: 'not an ip\n', stderr: '', code: 0 });
    expect(await resolveTailnetIp({ exec })).toBeNull();
  });
});

describe('resolveTailnetEndpoint', () => {
  it('returns ip and MagicDNS host', async () => {
    const exec = async () => ({
      stdout: JSON.stringify({
        Self: { HostName: 'sai-laptop', TailscaleIPs: ['100.64.1.5'] },
        MagicDNSSuffix: 'tailnet-abc.ts.net.',
      }),
      stderr: '',
      code: 0,
    });
    const r = await resolveTailnetEndpoint({ exec });
    expect(r).toEqual({ ip: '100.64.1.5', host: 'sai-laptop.tailnet-abc.ts.net' });
  });

  it('falls back to Self.DNSName when MagicDNS missing', async () => {
    const exec = async () => ({
      stdout: JSON.stringify({ Self: { DNSName: 'sai-laptop.example.', TailscaleIPs: ['100.64.1.5'] } }),
      stderr: '',
      code: 0,
    });
    expect(await resolveTailnetEndpoint({ exec })).toEqual({ ip: '100.64.1.5', host: 'sai-laptop.example' });
  });

  it('returns nulls on exec failure', async () => {
    const exec = async () => ({ stdout: '', stderr: '', code: 1 });
    expect(await resolveTailnetEndpoint({ exec })).toEqual({ ip: null, host: null });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/unit/remote/tailnet.test.ts
```

Expected: FAIL ("Cannot find module").

- [ ] **Step 3: Port the implementation from Otto**

Copy `../otto/src/main/remote/tailnet.ts` to `electron/services/remote/tailnet.ts`. **No edits required** — the file is self-contained.

- [ ] **Step 4: Run tests to verify pass**

```bash
npx vitest run tests/unit/remote/tailnet.test.ts
```

Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add electron/services/remote/tailnet.ts tests/unit/remote/tailnet.test.ts
git commit -m "feat(remote): tailnet IP + endpoint resolver"
```

---

## Task 4: `pairing-store.ts` — argon2id bearer tokens

**Files:**
- Create: `electron/services/remote/pairing-store.ts`
- Create: `tests/unit/remote/pairing-store.test.ts`

Port from `../otto/src/main/remote/pairing-store.ts`. **No SAI-specific changes** — the schema and API match the spec exactly.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/remote/pairing-store.test.ts`:

```ts
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach } from 'vitest';
import { PairingStore } from '@electron/services/remote/pairing-store';

function freshStore(): { store: PairingStore; db: Database.Database } {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE paired_devices (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, token_hash TEXT NOT NULL,
      paired_at INTEGER NOT NULL, last_seen_at INTEGER, revoked_at INTEGER
    );
  `);
  return { store: new PairingStore(db), db };
}

describe('PairingStore', () => {
  it('issues and verifies a token', async () => {
    const { store } = freshStore();
    const { deviceId, token } = await store.issue('iPhone');
    const found = await store.verify(token);
    expect(found?.id).toBe(deviceId);
    expect(found?.label).toBe('iPhone');
  });

  it('returns null for wrong token', async () => {
    const { store } = freshStore();
    await store.issue('iPhone');
    expect(await store.verify('wrong-token')).toBeNull();
  });

  it('returns null after revoke', async () => {
    const { store } = freshStore();
    const { deviceId, token } = await store.issue('iPhone');
    store.revoke(deviceId);
    expect(await store.verify(token)).toBeNull();
  });

  it('updates last_seen_at on verify', async () => {
    const { store } = freshStore();
    const { token } = await store.issue('iPhone');
    const before = store.list()[0].lastSeenAt;
    await store.verify(token);
    const after = store.list()[0].lastSeenAt;
    expect(after).not.toBeNull();
    expect(after).not.toEqual(before);
  });

  it('lists devices newest first', async () => {
    const { store } = freshStore();
    await store.issue('a');
    await new Promise((r) => setTimeout(r, 5));
    await store.issue('b');
    const list = store.list();
    expect(list.map((d) => d.label)).toEqual(['b', 'a']);
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npx vitest run tests/unit/remote/pairing-store.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Port the implementation**

Copy `../otto/src/main/remote/pairing-store.ts` to `electron/services/remote/pairing-store.ts`. No edits.

- [ ] **Step 4: Verify pass**

```bash
npx vitest run tests/unit/remote/pairing-store.test.ts
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add electron/services/remote/pairing-store.ts tests/unit/remote/pairing-store.test.ts
git commit -m "feat(remote): argon2id-hashed pairing store"
```

---

## Task 5: `screenshot-urls.ts` — signed URL helper

**Files:**
- Create: `electron/services/remote/screenshot-urls.ts`
- Create: `tests/unit/remote/screenshot-urls.test.ts`

Port from `../otto/src/main/remote/screenshot-urls.ts`. Used in Phase 3+ but built now.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/remote/screenshot-urls.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ScreenshotUrlSigner } from '@electron/services/remote/screenshot-urls';

describe('ScreenshotUrlSigner', () => {
  it('signs and verifies round trip', () => {
    const s = new ScreenshotUrlSigner('secret');
    const url = s.sign('img-1');
    const r = s.verify(url);
    expect(r.ok).toBe(true);
    expect(r.id).toBe('img-1');
  });

  it('rejects tampered signature', () => {
    const s = new ScreenshotUrlSigner('secret');
    const url = s.sign('img-1').replace(/sig=[^&]+/, 'sig=tampered');
    expect(s.verify(url).ok).toBe(false);
  });

  it('rejects replay (single-use)', () => {
    const s = new ScreenshotUrlSigner('secret');
    const url = s.sign('img-1');
    expect(s.verify(url).ok).toBe(true);
    expect(s.verify(url).ok).toBe(false);
  });

  it('produces different URLs for the same id (nonce)', () => {
    const s = new ScreenshotUrlSigner('secret');
    expect(s.sign('img-1')).not.toBe(s.sign('img-1'));
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npx vitest run tests/unit/remote/screenshot-urls.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Port the implementation**

Copy `../otto/src/main/remote/screenshot-urls.ts` to `electron/services/remote/screenshot-urls.ts`. No edits.

- [ ] **Step 4: Verify pass**

```bash
npx vitest run tests/unit/remote/screenshot-urls.test.ts
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add electron/services/remote/screenshot-urls.ts tests/unit/remote/screenshot-urls.test.ts
git commit -m "feat(remote): signed single-use screenshot URLs with nonce"
```

---

## Task 6: `session-bus.ts` — output fan-out

**Files:**
- Create: `electron/services/remote/session-bus.ts`
- Create: `tests/unit/remote/session-bus.test.ts`

Port from `../otto/src/main/remote/session-bus.ts`. **SAI-specific adaptation:** rename the bus's "session id" terminology to "topic" so non-chat surfaces (terminal, git, files) can reuse the same primitive in later phases.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/remote/session-bus.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SessionBus } from '@electron/services/remote/session-bus';

describe('SessionBus', () => {
  it('delivers events to per-topic subscribers', () => {
    const bus = new SessionBus();
    const events: any[] = [];
    bus.subscribe('chat-1', (e) => events.push(e));
    bus.publish('chat-1', { type: 'foo' });
    bus.publish('chat-2', { type: 'bar' });
    expect(events).toEqual([{ type: 'foo' }]);
  });

  it('delivers all events to subscribeAll', () => {
    const bus = new SessionBus();
    const events: any[] = [];
    bus.subscribeAll((topic, e) => events.push({ topic, e }));
    bus.publish('a', { type: 'x' });
    bus.publish('b', { type: 'y' });
    expect(events).toEqual([
      { topic: 'a', e: { type: 'x' } },
      { topic: 'b', e: { type: 'y' } },
    ]);
  });

  it('unsubscribe stops delivery', () => {
    const bus = new SessionBus();
    const events: any[] = [];
    const unsub = bus.subscribe('a', (e) => events.push(e));
    bus.publish('a', { type: '1' });
    unsub();
    bus.publish('a', { type: '2' });
    expect(events).toEqual([{ type: '1' }]);
  });

  it('history returns events since a sequence number', () => {
    const bus = new SessionBus();
    bus.publish('a', { type: '1' });
    bus.publish('a', { type: '2' });
    bus.publish('a', { type: '3' });
    const { events, lastSeq } = bus.history('a', 1);
    expect(events).toEqual([{ type: '2' }, { type: '3' }]);
    expect(lastSeq).toBe(3);
  });

  it('ring buffer caps at 256 events per topic', () => {
    const bus = new SessionBus();
    for (let i = 0; i < 300; i++) bus.publish('a', { type: String(i) });
    const { events } = bus.history('a', 0);
    expect(events).toHaveLength(256);
    expect((events[0] as any).type).toBe('44'); // 300 - 256
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npx vitest run tests/unit/remote/session-bus.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement (port + topic rename)**

Read Otto's `../otto/src/main/remote/session-bus.ts` for the shape, then write `electron/services/remote/session-bus.ts` with the topic-based API:

```ts
export type BusEvent = Record<string, unknown>;
type Sub = (event: BusEvent) => void;
type SubAll = (topic: string, event: BusEvent) => void;

interface Ring {
  events: BusEvent[];
  seq: number;
}
const RING_CAP = 256;

export class SessionBus {
  private subs = new Map<string, Set<Sub>>();
  private allSubs = new Set<SubAll>();
  private rings = new Map<string, Ring>();

  publish(topic: string, event: BusEvent): void {
    let ring = this.rings.get(topic);
    if (!ring) { ring = { events: [], seq: 0 }; this.rings.set(topic, ring); }
    ring.seq += 1;
    ring.events.push(event);
    if (ring.events.length > RING_CAP) ring.events.splice(0, ring.events.length - RING_CAP);
    const ts = this.subs.get(topic);
    if (ts) for (const fn of ts) { try { fn(event); } catch { /* isolate one bad sub */ } }
    for (const fn of this.allSubs) { try { fn(topic, event); } catch { /* isolate */ } }
  }

  subscribe(topic: string, fn: Sub): () => void {
    let set = this.subs.get(topic);
    if (!set) { set = new Set(); this.subs.set(topic, set); }
    set.add(fn);
    return () => { set!.delete(fn); };
  }

  subscribeAll(fn: SubAll): () => void {
    this.allSubs.add(fn);
    return () => { this.allSubs.delete(fn); };
  }

  history(topic: string, since: number): { events: BusEvent[]; lastSeq: number } {
    const ring = this.rings.get(topic);
    if (!ring) return { events: [], lastSeq: 0 };
    const startIdx = Math.max(0, ring.events.length - (ring.seq - since));
    return { events: ring.events.slice(startIdx), lastSeq: ring.seq };
  }
}
```

- [ ] **Step 4: Verify pass**

```bash
npx vitest run tests/unit/remote/session-bus.test.ts
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add electron/services/remote/session-bus.ts tests/unit/remote/session-bus.test.ts
git commit -m "feat(remote): topic-keyed session bus with fan-out and history"
```

---

## Task 7: `bridge-server.ts` — pairing endpoint (HTTP only)

**Files:**
- Create: `electron/services/remote/bridge-server.ts`
- Create: `tests/unit/remote/bridge-server-pair.test.ts`

This task adds HTTP `/pair`, `/healthz`, and the tailnet-bind refusal. WS comes in Task 8, static serving in Task 9. Port shape from `../otto/src/main/remote/bridge-server.ts`; the SAI version starts smaller and grows.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/remote/bridge-server-pair.test.ts`:

```ts
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BridgeServer } from '@electron/services/remote/bridge-server';
import { PairingStore } from '@electron/services/remote/pairing-store';
import { SessionBus } from '@electron/services/remote/session-bus';

function buildPairingStore() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE paired_devices (id TEXT PRIMARY KEY, label TEXT NOT NULL, token_hash TEXT NOT NULL, paired_at INTEGER NOT NULL, last_seen_at INTEGER, revoked_at INTEGER);`);
  return new PairingStore(db);
}

describe('BridgeServer HTTP', () => {
  let server: BridgeServer;
  let port: number;

  beforeEach(async () => {
    server = new BridgeServer({
      tailnetIp: '127.0.0.1',
      pairing: buildPairingStore(),
      bus: new SessionBus(),
      pwaDir: null,
      screenshotSecret: 'test',
      loadScreenshot: async () => null,
    });
    ({ port } = await server.start());
  });
  afterEach(async () => { await server.stop(); });

  it('refuses to start without a tailnet IP', async () => {
    const s = new BridgeServer({
      tailnetIp: null,
      pairing: buildPairingStore(),
      bus: new SessionBus(),
      pwaDir: null,
      screenshotSecret: 'x',
      loadScreenshot: async () => null,
    });
    await expect(s.start()).rejects.toThrow(/tailnet/);
  });

  it('GET /healthz returns ok', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.status).toBe('ok');
  });

  it('POST /pair returns 401 for unknown code', async () => {
    const r = await fetch(`http://127.0.0.1:${port}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'unknown', deviceLabel: 'Test' }),
    });
    expect(r.status).toBe(401);
  });

  it('POST /pair succeeds with valid code, then 401 on reuse', async () => {
    const code = server.mintPairingCode();
    const r1 = await fetch(`http://127.0.0.1:${port}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceLabel: 'Test' }),
    });
    expect(r1.status).toBe(200);
    const body = await r1.json();
    expect(body.token).toBeDefined();
    expect(body.deviceId).toBeDefined();

    const r2 = await fetch(`http://127.0.0.1:${port}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceLabel: 'Test' }),
    });
    expect(r2.status).toBe(401);
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npx vitest run tests/unit/remote/bridge-server-pair.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement HTTP shell**

Create `electron/services/remote/bridge-server.ts` with this initial shape (lifted from Otto, trimmed to Phase 0 routes — WS handler is a stub for now, fleshed out next task):

```ts
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import nodePath from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import type { PairingStore } from './pairing-store';
import type { SessionBus } from './session-bus';
import { ScreenshotUrlSigner } from './screenshot-urls';

export interface BridgeServerOpts {
  tailnetIp: string | null;
  pairing: PairingStore;
  bus: SessionBus;
  pwaDir: string | null;
  screenshotSecret: string;
  loadScreenshot: (id: string) => Promise<Buffer | null>;
  /** Preferred TCP port. Defaults to ephemeral inside the class; the production caller pins 17829. */
  port?: number;
}

interface PairingCode { code: string; expiresAt: number }

export class BridgeServer {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly codes = new Map<string, PairingCode>();
  private readonly liveSockets = new Map<string, Set<WebSocket>>(); // deviceId -> sockets
  private readonly PAIR_TTL_MS = 120_000;
  private readonly pairHits = new Map<string, number[]>();
  private readonly PAIR_WINDOW_MS = 60_000;
  private readonly PAIR_MAX = 10;
  private static readonly DEFAULT_PORT = 0;
  private readonly signer: ScreenshotUrlSigner;

  constructor(private readonly opts: BridgeServerOpts) {
    this.signer = new ScreenshotUrlSigner(opts.screenshotSecret);
  }

  signScreenshotUrl(id: string): string { return this.signer.sign(id); }

  mintPairingCode(now: number = Date.now()): string {
    const code = randomBytes(32).toString('base64url');
    this.codes.set(code, { code, expiresAt: now + this.PAIR_TTL_MS });
    return code;
  }

  async start(): Promise<{ port: number }> {
    if (!this.opts.tailnetIp) {
      throw new Error('tailnet IP not available; refusing to bind to 0.0.0.0 or 127.0.0.1');
    }
    const server = http.createServer((req, res) => { void this.handle(req, res); });
    const desired = this.opts.port ?? BridgeServer.DEFAULT_PORT;
    const tryListen = (p: number) => new Promise<void>((resolve, reject) => {
      const onErr = (err: Error) => { server.removeListener('error', onErr); reject(err); };
      server.once('error', onErr);
      server.listen(p, this.opts.tailnetIp!, () => { server.removeListener('error', onErr); resolve(); });
    });
    try {
      await tryListen(desired);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'EADDRINUSE' && desired !== 0) {
        await tryListen(0);
      } else throw err;
    }
    this.server = server;
    const { port } = server.address() as AddressInfo;
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws, req) => this.handleWs(ws, req));
    return { port };
  }

  async stop(): Promise<void> {
    const s = this.server; this.server = null;
    if (this.wss) { this.wss.close(); this.wss = null; }
    if (!s) return;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }

  /** Close all WS connections for a device (called by RemoteModule on revoke). */
  closeDeviceConnections(deviceId: string): void {
    const set = this.liveSockets.get(deviceId);
    if (!set) return;
    for (const ws of set) { try { ws.close(1008, 'revoked'); } catch { /* already closed */ } }
    this.liveSockets.delete(deviceId);
  }

  private rateLimited(req: http.IncomingMessage): boolean {
    const ip = req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    const arr = (this.pairHits.get(ip) ?? []).filter((t) => now - t < this.PAIR_WINDOW_MS);
    if (arr.length >= this.PAIR_MAX) { this.pairHits.set(ip, arr); return true; }
    arr.push(now); this.pairHits.set(ip, arr);
    return false;
  }

  private async readJson<T>(req: http.IncomingMessage): Promise<T> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      if (req.method === 'GET' && req.url === '/healthz') {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ status: 'ok', version: 1 }));
        return;
      }
      if (req.method === 'POST' && req.url === '/pair') return await this.handlePair(req, res);
      if (req.method === 'GET' && req.url?.startsWith('/screenshot/')) return await this.handleScreenshot(req, res);
      if (req.method === 'GET' && this.opts.pwaDir) return await this.handleStatic(req, res);
      res.statusCode = 404; res.end('not found');
    } catch (err) {
      res.statusCode = 500; res.end('internal error');
    }
  }

  private async handlePair(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (this.rateLimited(req)) { res.statusCode = 429; res.end('too many requests'); return; }
    const body = await this.readJson<{ code: string; deviceLabel?: string }>(req);
    const entry = this.codes.get(body.code);
    const now = Date.now();
    if (!entry || entry.expiresAt < now) { res.statusCode = 401; res.end('invalid code'); return; }
    this.codes.delete(body.code);
    const { deviceId, token } = await this.opts.pairing.issue(body.deviceLabel ?? 'Mobile');
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ token, deviceId, wsUrl: '/ws' }));
  }

  private async handleScreenshot(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const result = this.signer.verify(req.url!);
    if (!result.ok || !result.id) { res.statusCode = 401; res.end('bad url'); return; }
    const buf = await this.opts.loadScreenshot(result.id);
    if (!buf) { res.statusCode = 404; res.end('not found'); return; }
    res.statusCode = 200;
    res.setHeader('content-type', 'image/png');
    res.end(buf);
  }

  private static readonly MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  };

  private async handleStatic(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const root = this.opts.pwaDir!;
    const url = new URL(req.url ?? '/', 'http://x');
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (rel === '' || rel.endsWith('/')) rel = nodePath.join(rel, 'index.html');
    const resolved = nodePath.resolve(root, rel);
    // Path-traversal guard
    if (!resolved.startsWith(nodePath.resolve(root) + nodePath.sep) && resolved !== nodePath.resolve(root, 'index.html')) {
      res.statusCode = 403; res.end('forbidden'); return;
    }
    try {
      const buf = await fsp.readFile(resolved);
      const ext = nodePath.extname(resolved).toLowerCase();
      res.statusCode = 200;
      res.setHeader('content-type', BridgeServer.MIME[ext] ?? 'application/octet-stream');
      res.end(buf);
    } catch {
      // SPA fallback
      try {
        const buf = await fsp.readFile(nodePath.join(root, 'index.html'));
        res.statusCode = 200;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(buf);
      } catch { res.statusCode = 404; res.end('not found'); }
    }
  }

  // WS handler — fleshed out in Task 8. For now, immediately closes any connection.
  private handleWs(ws: WebSocket, _req: http.IncomingMessage): void {
    ws.close(1011, 'not implemented yet');
  }
}
```

- [ ] **Step 4: Verify pass**

```bash
npx vitest run tests/unit/remote/bridge-server-pair.test.ts
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add electron/services/remote/bridge-server.ts tests/unit/remote/bridge-server-pair.test.ts
git commit -m "feat(remote): bridge server with pairing endpoint and static serving"
```

---

## Task 8: WS handler with auth + ping + revoke close

**Files:**
- Modify: `electron/services/remote/bridge-server.ts`
- Create: `tests/unit/remote/bridge-server-ws.test.ts`

Fleshes out the WS handler to support `auth`/`auth_ok`, `ping`/`pong`, fan-out from the bus, and clean close on revoke.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/remote/bridge-server-ws.test.ts`:

```ts
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { BridgeServer } from '@electron/services/remote/bridge-server';
import { PairingStore } from '@electron/services/remote/pairing-store';
import { SessionBus } from '@electron/services/remote/session-bus';

function buildPairingStore() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE paired_devices (id TEXT PRIMARY KEY, label TEXT NOT NULL, token_hash TEXT NOT NULL, paired_at INTEGER NOT NULL, last_seen_at INTEGER, revoked_at INTEGER);`);
  return new PairingStore(db);
}

function once<T = any>(ws: WebSocket, type: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const onMsg = (data: WebSocket.Data) => {
      const m = JSON.parse(data.toString());
      if (m.type === type) { ws.off('message', onMsg); resolve(m); }
    };
    ws.on('message', onMsg);
    ws.once('close', (code, reason) => reject(new Error(`closed before ${type}: ${code} ${reason}`)));
  });
}

describe('BridgeServer WS', () => {
  let server: BridgeServer; let port: number;
  let pairing: PairingStore; let bus: SessionBus;

  beforeEach(async () => {
    pairing = buildPairingStore();
    bus = new SessionBus();
    server = new BridgeServer({
      tailnetIp: '127.0.0.1', pairing, bus, pwaDir: null,
      screenshotSecret: 'x', loadScreenshot: async () => null,
    });
    ({ port } = await server.start());
  });
  afterEach(async () => { await server.stop(); });

  async function pairAndGetToken(): Promise<string> {
    const code = server.mintPairingCode();
    const r = await fetch(`http://127.0.0.1:${port}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceLabel: 'Test' }),
    });
    return (await r.json()).token;
  }

  it('closes WS with 4001 on missing auth', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const close = await new Promise<{ code: number; reason: string }>((resolve) => {
      ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
      ws.on('open', () => ws.send(JSON.stringify({ type: 'wrong' })));
    });
    expect(close.code).toBe(4001);
  });

  it('replies auth_ok on valid token', async () => {
    const token = await pairAndGetToken();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'auth', token }));
    const m = await once(ws, 'auth_ok');
    expect(m.deviceLabel).toBe('Test');
    ws.close();
  });

  it('forwards bus events to authed clients', async () => {
    const token = await pairAndGetToken();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'auth', token }));
    await once(ws, 'auth_ok');
    setTimeout(() => bus.publish('topic-1', { type: 'noop', payload: 1 }), 10);
    const m = await once(ws, 'noop');
    expect(m.topic).toBe('topic-1');
    expect(m.payload).toBe(1);
    ws.close();
  });

  it('replies pong to ping', async () => {
    const token = await pairAndGetToken();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'auth', token }));
    await once(ws, 'auth_ok');
    ws.send(JSON.stringify({ type: 'ping' }));
    const m = await once(ws, 'pong');
    expect(m).toBeDefined();
    ws.close();
  });

  it('closeDeviceConnections kicks the device', async () => {
    const token = await pairAndGetToken();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'auth', token }));
    const ok = await once(ws, 'auth_ok');
    const closed = new Promise<number>((r) => ws.on('close', (c) => r(c)));
    server.closeDeviceConnections(ok.deviceId);
    expect(await closed).toBe(1008);
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npx vitest run tests/unit/remote/bridge-server-ws.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the WS handler**

Replace the `handleWs` stub in `electron/services/remote/bridge-server.ts` with the full handler:

```ts
private handleWs(ws: WebSocket, _req: http.IncomingMessage): void {
  let authed = false;
  let deviceId: string | null = null;
  let unsub: null | (() => void) = null;

  const close = (code: number, reason: string) => { try { ws.close(code, reason); } catch { /* already closed */ } };

  ws.on('message', async (data) => {
    let msg: { type?: string; [k: string]: unknown };
    try { msg = JSON.parse(data.toString()); } catch { return close(1003, 'bad json'); }

    if (!authed) {
      if (msg.type !== 'auth' || typeof msg.token !== 'string') return close(4001, 'auth_failed');
      const found = await this.opts.pairing.verify(msg.token);
      if (!found) return close(4001, 'auth_failed');
      authed = true;
      deviceId = found.id;
      let set = this.liveSockets.get(found.id);
      if (!set) { set = new Set(); this.liveSockets.set(found.id, set); }
      set.add(ws);
      ws.send(JSON.stringify({ v: 1, type: 'auth_ok', deviceId: found.id, deviceLabel: found.label }));
      unsub = this.opts.bus.subscribeAll((topic, e) => {
        try { ws.send(JSON.stringify({ v: 1, topic, ...e })); } catch { /* ws may be closed */ }
      });
      return;
    }

    if (msg.type === 'ping') { ws.send(JSON.stringify({ v: 1, type: 'pong' })); return; }
    // Phase 0 has no other inbound messages. Future phases add prompt/interrupt/approval/etc.
  });

  ws.on('close', () => {
    if (unsub) unsub();
    if (deviceId) {
      const set = this.liveSockets.get(deviceId);
      if (set) { set.delete(ws); if (set.size === 0) this.liveSockets.delete(deviceId); }
    }
  });
}
```

Also send `deviceId` in `auth_ok` (the test reads `ok.deviceId`).

- [ ] **Step 4: Verify pass**

```bash
npx vitest run tests/unit/remote/bridge-server-ws.test.ts
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add electron/services/remote/bridge-server.ts tests/unit/remote/bridge-server-ws.test.ts
git commit -m "feat(remote): WS auth, ping, bus fan-out, revoke close"
```

---

## Task 9: `index.ts` — RemoteModule supervisor

**Files:**
- Create: `electron/services/remote/index.ts`
- Create: `tests/unit/remote/index.test.ts`

Port from `../otto/src/main/remote/index.ts`. **One SAI-specific change:** add a `closeDeviceConnections(deviceId)` method that delegates to the bridge — used by the IPC revoke handler.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/remote/index.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { RemoteModule } from '@electron/services/remote';
import { SessionBus } from '@electron/services/remote/session-bus';

function fakePairing(): any {
  return { list: () => [], issue: vi.fn(), verify: vi.fn(), revoke: vi.fn() };
}

function fakeBridge(opts: { startResult?: 'ok' | 'fail'; port?: number } = {}) {
  let startCalls = 0;
  return {
    startCalls: () => startCalls,
    start: vi.fn(async () => {
      startCalls += 1;
      if (opts.startResult === 'fail') throw new Error('boom');
      return { port: opts.port ?? 17829 };
    }),
    stop: vi.fn(async () => {}),
    mintPairingCode: vi.fn(() => 'CODE'),
    signScreenshotUrl: vi.fn((id: string) => `/screenshot/${id}`),
    closeDeviceConnections: vi.fn(),
  };
}

describe('RemoteModule', () => {
  it('runs when tailnet IP available', async () => {
    const bridge = fakeBridge();
    const m = new RemoteModule({
      pairing: fakePairing(), bus: new SessionBus(),
      resolveTailnetEndpoint: async () => ({ ip: '100.64.1.1', host: 'sai.tail.ts.net' }),
      makeBridge: () => bridge as any,
      pollMs: 0,
    });
    await m.start();
    const s = m.status();
    expect(s.running).toBe(true);
    expect(s.url).toBe('http://sai.tail.ts.net:17829');
    await m.stop();
  });

  it('stays down with reason when no tailnet IP', async () => {
    const m = new RemoteModule({
      pairing: fakePairing(), bus: new SessionBus(),
      resolveTailnetEndpoint: async () => ({ ip: null, host: null }),
      makeBridge: () => fakeBridge() as any,
      pollMs: 0,
    });
    await m.start();
    const s = m.status();
    expect(s.running).toBe(false);
    expect(s.reason).toMatch(/tailnet/);
    await m.stop();
  });

  it('retries once on bridge.start failure', async () => {
    let attempts = 0;
    const m = new RemoteModule({
      pairing: fakePairing(), bus: new SessionBus(),
      resolveTailnetEndpoint: async () => ({ ip: '100.64.1.1', host: null }),
      makeBridge: () => ({
        ...fakeBridge(),
        start: vi.fn(async () => {
          attempts += 1;
          if (attempts < 2) throw new Error('first fail');
          return { port: 17829 };
        }),
      } as any),
      pollMs: 0, restartDelayMs: 5,
    });
    await m.start();
    await new Promise((r) => setTimeout(r, 30));
    expect(attempts).toBe(2);
    expect(m.status().running).toBe(true);
    await m.stop();
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npx vitest run tests/unit/remote/index.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Port the implementation**

Copy `../otto/src/main/remote/index.ts` to `electron/services/remote/index.ts` and apply these edits:

1. Replace Otto's `import { logger } from '../logger';` with a local minimal logger (SAI uses console-based logging in services):
   ```ts
   const logger = {
     info:  (m: string) => console.log(`[remote] ${m}`),
     warn:  (m: string) => console.warn(`[remote] ${m}`),
     error: (m: string) => console.error(`[remote] ${m}`),
   };
   ```
2. Add a `closeDeviceConnections(deviceId: string)` method that delegates to `this.bridge?.closeDeviceConnections(deviceId)`. Update the `RemoteModuleBridge` interface to include this method.
3. Otto's `mintPairingCode` returns `{ code, url, expiresAt }`. Keep that shape.

- [ ] **Step 4: Verify pass**

```bash
npx vitest run tests/unit/remote/index.test.ts
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add electron/services/remote/index.ts tests/unit/remote/index.test.ts
git commit -m "feat(remote): RemoteModule supervisor with retry and rebind"
```

---

## Task 10: Wire RemoteModule into the Electron main process

**Files:**
- Modify: `electron/main.ts`

Open the existing `electron/main.ts` and locate where other long-lived services (e.g., `pty.ts`, `mcp.ts`) are constructed. Add the RemoteModule setup alongside.

- [ ] **Step 1: Add the bootstrap helper**

In `electron/main.ts`, add near the top imports:

```ts
import Database from 'better-sqlite3';
import { app, ipcMain } from 'electron';
import nodePath from 'node:path';
import { promises as fsp } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { RemoteModule } from './services/remote';
import { BridgeServer } from './services/remote/bridge-server';
import { PairingStore } from './services/remote/pairing-store';
import { SessionBus } from './services/remote/session-bus';
import { resolveTailnetEndpoint } from './services/remote/tailnet';
```

Add a single-instance helper somewhere after `app.whenReady()`:

```ts
let remote: RemoteModule | null = null;
let pairing: PairingStore | null = null;
let bus: SessionBus | null = null;
const REMOTE_PORT = 17829;

async function getOrInitRemote(): Promise<RemoteModule> {
  if (remote) return remote;
  const userDataDir = app.getPath('userData');
  const dbPath = nodePath.join(userDataDir, 'sai-remote.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS paired_devices (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, token_hash TEXT NOT NULL,
      paired_at INTEGER NOT NULL, last_seen_at INTEGER, revoked_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  `);
  pairing = new PairingStore(db);
  bus = new SessionBus();

  // Persistent screenshot HMAC secret
  let secret = (db.prepare('SELECT v FROM kv WHERE k = ?').get('screenshot_secret') as { v?: string } | undefined)?.v;
  if (!secret) {
    secret = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO kv (k, v) VALUES (?, ?)').run('screenshot_secret', secret);
  }
  const screenshotSecret = secret;

  const pwaDir = app.isPackaged
    ? nodePath.join(process.resourcesPath, 'app', 'dist', 'renderer-remote')
    : nodePath.join(__dirname, '..', 'dist', 'renderer-remote');

  remote = new RemoteModule({
    pairing,
    bus,
    resolveTailnetEndpoint: () => resolveTailnetEndpoint(),
    makeBridge: (tailnetIp) => new BridgeServer({
      tailnetIp,
      pairing: pairing!,
      bus: bus!,
      pwaDir,
      screenshotSecret,
      loadScreenshot: async () => null, // Phase 3+ wires this
      port: REMOTE_PORT,
    }),
  });
  return remote;
}
```

- [ ] **Step 2: Lazy-start when user enables it (do NOT auto-start)**

Phase 0 keeps the bridge opt-in. We'll start it from the IPC handler in Task 11.

- [ ] **Step 3: Add a clean-shutdown hook**

```ts
app.on('before-quit', () => { void remote?.stop(); });
```

- [ ] **Step 4: Verify the app still boots**

```bash
npm run dev
```

Open the app. Watch for native-module load errors. Quit.

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts
git commit -m "feat(remote): wire RemoteModule into Electron main process"
```

---

## Task 11: IPC handlers + preload exposure

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/vite-env.d.ts` (declare new `sai.remote` types)

- [ ] **Step 1: Register IPC handlers in `electron/main.ts`**

After the `getOrInitRemote` helper, register handlers (inside `app.whenReady()` or top-level after init). The enabled flag is persisted into the same `kv` table seeded in Task 10, so the bridge auto-resumes on the next launch when the user had it on:

```ts
async function getEnabledFlag(): Promise<boolean> {
  await getOrInitRemote(); // ensures pairing/db are initialized
  const row = (pairing as any).db?.prepare('SELECT v FROM kv WHERE k = ?').get('enabled') as { v?: string } | undefined;
  return row?.v === '1';
}
async function setEnabledFlag(value: boolean): Promise<void> {
  await getOrInitRemote();
  (pairing as any).db?.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').run('enabled', value ? '1' : '0');
}
```

Note: the `(pairing as any).db` cast works because `PairingStore`'s constructor holds the `Database` instance — but cleaner is to expose the `Database` directly from `getOrInitRemote()` via a module-level `let db: Database | null`. Refactor inline if you prefer.

```ts
ipcMain.handle('remote:setEnabled', async (_e, enabled: boolean) => {
  const r = await getOrInitRemote();
  await setEnabledFlag(enabled);
  if (enabled) await r.start();
  else await r.stop();
});

ipcMain.handle('remote:status', async () => {
  if (!remote) return { running: false, url: null, reason: 'disabled', pairedCount: 0, enabled: false };
  return { ...remote.status(), enabled: await getEnabledFlag() };
});

ipcMain.handle('remote:mintPairCode', async () => {
  const r = await getOrInitRemote();
  return r.mintPairingCode();
});

ipcMain.handle('remote:listDevices', async () => {
  await getOrInitRemote();
  return pairing!.list();
});

ipcMain.handle('remote:revoke', async (_e, deviceId: string) => {
  await getOrInitRemote();
  pairing!.revoke(deviceId);
  remote!.closeDeviceConnections(deviceId);
});
```

- [ ] **Step 2: Expose handlers in `electron/preload.ts`**

Append to the `contextBridge.exposeInMainWorld('sai', { ... })` object:

```ts
  remote: {
    setEnabled: (enabled: boolean) => ipcRenderer.invoke('remote:setEnabled', enabled),
    status:     () => ipcRenderer.invoke('remote:status'),
    mintPairCode: () => ipcRenderer.invoke('remote:mintPairCode'),
    listDevices:  () => ipcRenderer.invoke('remote:listDevices'),
    revoke:       (deviceId: string) => ipcRenderer.invoke('remote:revoke', deviceId),
  },
```

- [ ] **Step 3: Add TypeScript types**

In `src/vite-env.d.ts`, find or add the `Window.sai` global declaration. Append a `remote` field:

```ts
interface SaiRemoteApi {
  setEnabled: (enabled: boolean) => Promise<void>;
  status: () => Promise<{ running: boolean; url: string | null; reason: string | null; pairedCount: number; enabled: boolean }>;
  mintPairCode: () => Promise<{ code: string; url: string; expiresAt: number }>;
  listDevices: () => Promise<Array<{ id: string; label: string; pairedAt: number; lastSeenAt: number | null; revokedAt: number | null }>>;
  revoke: (deviceId: string) => Promise<void>;
}
```

Then add `remote: SaiRemoteApi` to the existing `sai` interface.

- [ ] **Step 4: Smoke-test from DevTools**

```bash
npm run dev
```

Open DevTools → Console:
```js
await window.sai.remote.status()
// expected: { running: false, url: null, reason: 'disabled' or 'tailnet IP not detected', pairedCount: 0 }
```

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts electron/preload.ts src/vite-env.d.ts
git commit -m "feat(remote): IPC handlers and preload exposure"
```

---

## Task 12: Standalone PWA Vite config + entry HTML

**Files:**
- Create: `vite.config.pwa.ts`
- Create: `src/renderer-remote/index.html`
- Create: `src/renderer-remote/main.tsx` (stub)
- Create: `src/renderer-remote/styles.css` (Tailwind entry)
- Modify: `tsconfig.json` (include the new directory)
- Modify: `tailwind.config.ts` (extend `content`)
- Modify: `package.json` (`build` script)
- Modify: `package.json` electron-builder `files`

- [ ] **Step 1: Create the Vite config**

Create `vite.config.pwa.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import nodePath from 'node:path';

export default defineConfig({
  root: 'src/renderer-remote',
  plugins: [react()],
  build: {
    outDir: nodePath.resolve(__dirname, 'dist/renderer-remote'),
    emptyOutDir: true,
    sourcemap: true,
  },
});
```

- [ ] **Step 2: Create the entry HTML**

Create `src/renderer-remote/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="theme-color" content="#0b0b0d" />
    <title>SAI Remote</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body class="bg-neutral-950 text-neutral-100 antialiased">
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Create the entry tsx**

Create `src/renderer-remote/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client';
import App from './App';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
```

Create a placeholder `src/renderer-remote/App.tsx` (fleshed out in Task 14):

```tsx
export default function App() {
  return <div className="p-6"><h1 className="text-xl font-semibold">SAI Remote — bootstrapping</h1></div>;
}
```

Create `src/renderer-remote/styles.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 4: Extend Tailwind and tsconfig**

In `tailwind.config.ts`, extend `content`:

```ts
content: [
  './index.html',
  './src/**/*.{ts,tsx}',
  './src/renderer-remote/**/*.{ts,tsx,html}',
],
```

In `tsconfig.json`, ensure `src/renderer-remote/**/*` is covered by `include` (should already be matched by `src/**/*`; verify).

- [ ] **Step 5: Add PWA to the build pipeline**

Update `package.json`:

```json
"scripts": {
  ...
  "build": "tsc && vite build && vite build --config vite.config.pwa.ts",
  ...
}
```

Also extend electron-builder `files`:

```json
"files": [
  "dist/**/*",
  "dist-electron/**/*",
  "node_modules/**/*",
  "package.json"
]
```

(The PWA already lives under `dist/**/*` so no change required, but verify.)

- [ ] **Step 6: Verify the PWA bundle builds**

```bash
npm run build
ls dist/renderer-remote/
# expected: index.html, assets/...
```

- [ ] **Step 7: Commit**

```bash
git add vite.config.pwa.ts src/renderer-remote/ tsconfig.json tailwind.config.ts package.json
git commit -m "feat(remote): standalone PWA Vite entry and build wiring"
```

---

## Task 13: PWA — `wire.ts` (auth + reconnect helpers)

**Files:**
- Create: `src/renderer-remote/wire.ts`
- Create: `tests/unit/remote/pwa-wire.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/remote/pwa-wire.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractPairCode, BEARER_KEY } from '@/renderer-remote/wire';

describe('PWA wire helpers', () => {
  it('extracts ?code= from URL', () => {
    expect(extractPairCode('https://x.y/?code=abc123')).toBe('abc123');
    expect(extractPairCode('https://x.y/?other=1&code=zz')).toBe('zz');
    expect(extractPairCode('https://x.y/')).toBeNull();
  });

  it('exposes a stable localStorage key', () => {
    expect(BEARER_KEY).toBe('sai-remote-bearer');
  });
});
```

- [ ] **Step 2: Verify failure**

```bash
npx vitest run tests/unit/remote/pwa-wire.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/renderer-remote/wire.ts`:

```ts
export const BEARER_KEY = 'sai-remote-bearer';

export function extractPairCode(url: string): string | null {
  try { return new URL(url).searchParams.get('code'); } catch { return null; }
}

export interface PairResult { token: string; deviceId: string }

export async function pair(code: string, deviceLabel: string): Promise<PairResult> {
  const r = await fetch('/pair', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, deviceLabel }),
  });
  if (!r.ok) throw new Error(`pair failed: ${r.status}`);
  return r.json();
}

export type WireMsg = { type: string; [k: string]: unknown };

export interface WireClient {
  send(msg: WireMsg): void;
  close(): void;
  on(handler: (msg: WireMsg) => void): () => void;
  onState(handler: (s: 'opening' | 'open' | 'closed') => void): () => void;
}

export function connect(token: string): WireClient {
  const wsUrl = new URL('/ws', location.href.replace(/^http/, 'ws')).toString();
  const handlers = new Set<(msg: WireMsg) => void>();
  const stateHandlers = new Set<(s: 'opening' | 'open' | 'closed') => void>();
  let ws: WebSocket | null = null;
  let closed = false;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  const notifyState = (s: 'opening' | 'open' | 'closed') => { for (const h of stateHandlers) try { h(s); } catch { /* isolate */ } };

  const open = () => {
    notifyState('opening');
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      ws!.send(JSON.stringify({ type: 'auth', token }));
    };
    ws.onmessage = (ev) => {
      let msg: WireMsg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'auth_ok') {
        notifyState('open');
        pingTimer = setInterval(() => { try { ws?.send(JSON.stringify({ type: 'ping' })); } catch { /* socket may be closed */ } }, 25_000);
      }
      for (const h of handlers) try { h(msg); } catch { /* isolate */ }
    };
    ws.onclose = () => {
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      notifyState('closed');
      if (!closed) setTimeout(open, 2_000); // simple linear reconnect
    };
  };
  open();

  return {
    send: (msg) => ws?.send(JSON.stringify(msg)),
    close: () => { closed = true; ws?.close(); },
    on: (h) => { handlers.add(h); return () => { handlers.delete(h); }; },
    onState: (h) => { stateHandlers.add(h); return () => { stateHandlers.delete(h); }; },
  };
}
```

- [ ] **Step 4: Verify pass**

```bash
npx vitest run tests/unit/remote/pwa-wire.test.ts
```

Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add src/renderer-remote/wire.ts tests/unit/remote/pwa-wire.test.ts
git commit -m "feat(remote): PWA wire helpers (pair, connect, reconnect)"
```

---

## Task 14: PWA — `App.tsx` + `Status.tsx`

**Files:**
- Modify: `src/renderer-remote/App.tsx`
- Create: `src/renderer-remote/Status.tsx`

- [ ] **Step 1: Write `Status.tsx`**

```tsx
interface Props {
  deviceLabel: string;
  serverUrl: string;
  wsState: 'opening' | 'open' | 'closed';
  onDisconnect: () => void;
}

export default function Status({ deviceLabel, serverUrl, wsState, onDisconnect }: Props) {
  const dot = wsState === 'open' ? 'bg-green-500' : wsState === 'opening' ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-4">
      <div className="text-4xl">✓</div>
      <h1 className="text-2xl font-semibold">Paired</h1>
      <p className="text-sm text-neutral-400">{deviceLabel}</p>
      <div className="flex items-center gap-2 text-sm">
        <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
        <span>{wsState}</span>
        <span className="text-neutral-500">·</span>
        <span className="text-neutral-400">{serverUrl}</span>
      </div>
      <button
        onClick={onDisconnect}
        className="mt-8 px-4 py-2 rounded bg-neutral-800 hover:bg-neutral-700 text-sm"
      >
        Disconnect
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `App.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { BEARER_KEY, connect, extractPairCode, pair, type WireClient } from './wire';
import Status from './Status';

export default function App() {
  const [phase, setPhase] = useState<'init' | 'pairing' | 'connected' | 'needs-pair' | 'error'>('init');
  const [error, setError] = useState<string | null>(null);
  const [deviceLabel, setDeviceLabel] = useState<string>('');
  const [wsState, setWsState] = useState<'opening' | 'open' | 'closed'>('opening');
  const [client, setClient] = useState<WireClient | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        let bearer = localStorage.getItem(BEARER_KEY);
        const code = extractPairCode(location.href);
        if (code && !bearer) {
          setPhase('pairing');
          const label = navigator.userAgent.slice(0, 64);
          const { token, deviceId } = await pair(code, label);
          localStorage.setItem(BEARER_KEY, JSON.stringify({ token, deviceId, label }));
          history.replaceState(null, '', location.pathname);
          bearer = localStorage.getItem(BEARER_KEY);
        }
        if (!bearer) { setPhase('needs-pair'); return; }
        const { token, label } = JSON.parse(bearer);
        setDeviceLabel(label);
        const c = connect(token);
        c.onState((s) => setWsState(s));
        c.on((msg) => {
          if (msg.type === 'auth_ok') setPhase('connected');
        });
        setClient(c);
      } catch (err) {
        setError((err as Error).message);
        setPhase('error');
      }
    })();
  }, []);

  const disconnect = () => {
    client?.close();
    localStorage.removeItem(BEARER_KEY);
    location.reload();
  };

  if (phase === 'connected') {
    return (
      <Status
        deviceLabel={deviceLabel}
        serverUrl={location.origin}
        wsState={wsState}
        onDisconnect={disconnect}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-3 text-center">
      {phase === 'init' && <p>Connecting…</p>}
      {phase === 'pairing' && <p>Pairing…</p>}
      {phase === 'needs-pair' && (
        <>
          <h1 className="text-xl font-semibold">Re-pair required</h1>
          <p className="text-sm text-neutral-400 max-w-xs">
            Open the SAI app on your computer, go to Settings → Mobile Remote → Pair a new device, and scan the QR code with your phone camera.
          </p>
        </>
      )}
      {phase === 'error' && <p className="text-red-400">Error: {error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Rebuild the PWA bundle to verify it compiles**

```bash
npx vite build --config vite.config.pwa.ts
```

Expected: build succeeds; `dist/renderer-remote/index.html` present.

- [ ] **Step 4: Commit**

```bash
git add src/renderer-remote/App.tsx src/renderer-remote/Status.tsx
git commit -m "feat(remote): PWA paired-status screen and pairing flow"
```

---

## Task 15: Settings UI — `RemoteSettings.tsx` component

**Files:**
- Create: `src/components/Settings/RemoteSettings.tsx`

- [ ] **Step 1: Add the component**

```tsx
import { useEffect, useState, useCallback } from 'react';
import QRCode from 'qrcode';

interface Status { running: boolean; url: string | null; reason: string | null; pairedCount: number }
interface Device { id: string; label: string; pairedAt: number; lastSeenAt: number | null; revokedAt: number | null }

function relative(ts: number | null): string {
  if (!ts) return 'never';
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

export default function RemoteSettings() {
  const [enabled, setEnabled] = useState<boolean>(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [pairUrl, setPairUrl] = useState<string | null>(null);
  const [pairQr, setPairQr] = useState<string | null>(null);
  const [pairExpiresAt, setPairExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(Date.now());

  const refresh = useCallback(async () => {
    setStatus(await window.sai.remote.status());
    setDevices(await window.sai.remote.listDevices());
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => { void refresh(); setNow(Date.now()); }, 5_000);
    return () => clearInterval(t);
  }, [refresh]);

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next);
    await window.sai.remote.setEnabled(next);
    await refresh();
  };

  // Initialize the toggle state from persisted status on mount
  useEffect(() => {
    void window.sai.remote.status().then((s: any) => setEnabled(Boolean(s.enabled)));
  }, []);

  const startPair = async () => {
    const { url, expiresAt } = await window.sai.remote.mintPairCode();
    setPairUrl(url);
    setPairExpiresAt(expiresAt);
    setPairQr(await QRCode.toDataURL(url, { width: 256, margin: 1 }));
  };

  const revoke = async (id: string) => {
    await window.sai.remote.revoke(id);
    await refresh();
  };

  const countdown = pairExpiresAt ? Math.max(0, Math.ceil((pairExpiresAt - now) / 1000)) : 0;
  const pairExpired = pairExpiresAt !== null && countdown <= 0;

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold mb-2">Mobile Remote</h2>
        <p className="text-sm text-neutral-400 mb-4">
          Access SAI from your phone over Tailscale. The bridge binds only to your tailnet IP and never to a public interface.
        </p>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={toggle} />
          <span>Enable Mobile Remote</span>
        </label>
      </div>

      <div className="rounded border border-neutral-800 p-4 space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${status?.running ? 'bg-green-500' : 'bg-red-500'}`} />
          <span>{status?.running ? 'Running' : 'Not running'}</span>
        </div>
        {status?.url && (
          <div className="text-neutral-300">
            URL: <code className="text-xs bg-neutral-900 px-1 py-0.5 rounded">{status.url}</code>
          </div>
        )}
        {status?.reason && !status.running && (
          <div className="text-amber-400 text-xs">{status.reason}</div>
        )}
        <div className="text-neutral-400 text-xs">Paired devices: {status?.pairedCount ?? 0}</div>
      </div>

      <div>
        <button
          onClick={startPair}
          disabled={!status?.running}
          className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm"
        >
          Pair a new device
        </button>
        {pairQr && !pairExpired && (
          <div className="mt-4 flex gap-6 items-start">
            <img src={pairQr} alt="Pairing QR" className="w-48 h-48 bg-white p-2 rounded" />
            <div className="space-y-2 text-sm">
              <div>Scan with your phone's camera.</div>
              <div className="text-xs text-neutral-400">Expires in {countdown}s</div>
              <div className="text-xs break-all text-neutral-500">{pairUrl}</div>
            </div>
          </div>
        )}
        {pairExpired && (
          <div className="mt-2 text-xs text-amber-400">Pairing code expired. Click "Pair a new device" again.</div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2">Paired devices</h3>
        {devices.length === 0 && <div className="text-xs text-neutral-500">No devices paired yet.</div>}
        <ul className="divide-y divide-neutral-800">
          {devices.filter((d) => !d.revokedAt).map((d) => (
            <li key={d.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <div>{d.label}</div>
                <div className="text-xs text-neutral-500">last seen {relative(d.lastSeenAt)}</div>
              </div>
              <button
                onClick={() => revoke(d.id)}
                className="px-2 py-1 rounded bg-neutral-800 hover:bg-red-700 text-xs"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Settings/RemoteSettings.tsx
git commit -m "feat(remote): Settings tab component for pairing management"
```

---

## Task 16: Wire `RemoteSettings` into `SettingsModal`

**Files:**
- Modify: `src/components/SettingsModal.tsx`

- [ ] **Step 1: Add 'remote' to the `SettingsPage` union**

In `SettingsModal.tsx`, find the line:

```ts
type SettingsPage = 'general' | 'editor' | 'layout' | 'style' | 'storage' | 'provider' | 'claude' | 'codex' | 'gemini' | 'swarm' | 'keybindings';
```

Add `'remote'`:

```ts
type SettingsPage = 'general' | 'editor' | 'layout' | 'style' | 'storage' | 'provider' | 'claude' | 'codex' | 'gemini' | 'swarm' | 'remote' | 'keybindings';
```

- [ ] **Step 2: Add the import**

```tsx
import RemoteSettings from './Settings/RemoteSettings';
import { Smartphone } from 'lucide-react';
```

- [ ] **Step 3: Add to the sidebar list and the page switch**

Find where other pages (e.g., `swarm`) appear in the sidebar nav. Add a sibling entry with the `Smartphone` icon, label "Mobile Remote", and `setPage('remote')`.

Find where the page content is rendered (likely a switch on `page`). Add:

```tsx
{page === 'remote' && <RemoteSettings />}
```

- [ ] **Step 4: Smoke test**

```bash
npm run dev
```

Open Settings → Mobile Remote. Verify the panel renders with status block, toggle, and the "Pair a new device" button.

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsModal.tsx
git commit -m "feat(remote): Mobile Remote tab in SettingsModal"
```

---

## Task 17: Integration / end-to-end test

**Files:**
- Create: `tests/integration/remote/end-to-end.test.ts`

Mirrors Otto's `end-to-end.test.ts` shape. Exercises pair → auth → bus event → revoke → reconnect-fails using real `ws` + `fetch`.

- [ ] **Step 1: Write the test**

```ts
import Database from 'better-sqlite3';
import { describe, it, expect } from 'vitest';
import WebSocket from 'ws';
import { RemoteModule } from '@electron/services/remote';
import { BridgeServer } from '@electron/services/remote/bridge-server';
import { PairingStore } from '@electron/services/remote/pairing-store';
import { SessionBus } from '@electron/services/remote/session-bus';

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE paired_devices (id TEXT PRIMARY KEY, label TEXT NOT NULL, token_hash TEXT NOT NULL, paired_at INTEGER NOT NULL, last_seen_at INTEGER, revoked_at INTEGER);`);
  return db;
}

describe('mobile remote end-to-end', () => {
  it('pair → auth → event → revoke → reconnect fails', async () => {
    const pairing = new PairingStore(freshDb());
    const bus = new SessionBus();
    const remote = new RemoteModule({
      pairing,
      bus,
      resolveTailnetEndpoint: async () => ({ ip: '127.0.0.1', host: null }),
      makeBridge: (ip) => new BridgeServer({
        tailnetIp: ip, pairing, bus, pwaDir: null,
        screenshotSecret: 'e2e', loadScreenshot: async () => null,
        port: 0, // ephemeral
      }),
      pollMs: 0,
    });
    await remote.start();
    const { url } = remote.status();
    expect(url).not.toBeNull();

    // 1. Mint pair code → POST /pair → bearer
    const { code } = remote.mintPairingCode();
    const pairRes = await fetch(`${url}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceLabel: 'E2E iPhone' }),
    });
    expect(pairRes.status).toBe(200);
    const { token, deviceId } = await pairRes.json();

    // 2. WS connect + auth
    const wsUrl = url!.replace(/^http/, 'ws') + '/ws';
    const ws = new WebSocket(wsUrl);
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'auth', token }));
    const authOk = await new Promise<any>((resolve) => {
      ws.on('message', function on(d) {
        const m = JSON.parse(d.toString());
        if (m.type === 'auth_ok') { ws.off('message', on); resolve(m); }
      });
    });
    expect(authOk.deviceLabel).toBe('E2E iPhone');

    // 3. bus publish → client receives
    const got = new Promise<any>((resolve) => {
      ws.on('message', function on(d) {
        const m = JSON.parse(d.toString());
        if (m.type === 'noop') { ws.off('message', on); resolve(m); }
      });
    });
    bus.publish('t1', { type: 'noop', n: 42 });
    const frame = await got;
    expect(frame.topic).toBe('t1');
    expect(frame.n).toBe(42);

    // 4. Revoke → WS closes
    const closed = new Promise<number>((r) => ws.on('close', (c) => r(c)));
    pairing.revoke(deviceId);
    remote.closeDeviceConnections(deviceId);
    expect(await closed).toBe(1008);

    // 5. Reconnect with same token fails
    const ws2 = new WebSocket(wsUrl);
    await new Promise((r) => ws2.once('open', r));
    ws2.send(JSON.stringify({ type: 'auth', token }));
    const closed2 = await new Promise<{ code: number }>((r) => ws2.on('close', (code) => r({ code })));
    expect(closed2.code).toBe(4001);

    await remote.stop();
  });
});
```

- [ ] **Step 2: Run the integration suite**

```bash
npm run test:integration -- tests/integration/remote/end-to-end.test.ts
```

Expected: 1 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/remote/end-to-end.test.ts
git commit -m "test(remote): end-to-end pair→auth→event→revoke flow"
```

---

## Task 18: Manual smoke checklist

**Files:**
- Create: `docs/superpowers/notes/2026-05-25-mobile-remote-p0-smoke.md`

- [ ] **Step 1: Write the checklist**

```markdown
# Mobile Remote Phase 0 — Manual Smoke Checklist

Run this on real hardware (laptop + iPhone) before declaring Phase 0 done.

## Prerequisites

- [ ] Tailscale installed and logged in on both laptop and iPhone
- [ ] iPhone and laptop on the same tailnet (verify with `tailscale status`)
- [ ] SAI built from this branch (`npm run build` succeeded)

## Happy path

- [ ] Launch SAI. Open Settings → Mobile Remote.
- [ ] Status shows `running: false, reason: disabled`. Toggle Enable → status flips to `running`, URL shows `http://<host>.<tailnet>.ts.net:17829`.
- [ ] Click "Pair a new device". QR appears with 120s countdown.
- [ ] On iPhone, open Camera and point at the QR. Safari opens to the bridge URL.
- [ ] PWA shows "Pairing…" briefly then "Paired ✓" with green WS dot.
- [ ] Back on laptop, Settings shows the new device in "Paired devices" with a fresh `last seen`.

## Persistence

- [ ] Quit SAI. Relaunch.
- [ ] On iPhone (PWA still open via Add-to-Home-Screen or browser tab), WS reconnects automatically within ~10s.
- [ ] Settings → Mobile Remote shows the device still paired.

## Revoke

- [ ] In Settings, click Revoke on the device row.
- [ ] iPhone PWA dot flips red, then page transitions to "Re-pair required" within 30s.
- [ ] Re-scanning the same QR (if still valid) fails with 401.

## Failure modes

- [ ] Toggle Tailscale OFF on phone → WS disconnects within ~10s, dot flips red.
- [ ] Toggle Tailscale back on → WS reconnects automatically.
- [ ] On laptop, disable Tailscale → status flips to `reason: tailnet IP not detected`, no URL.

## Add to Home Screen

- [ ] In Safari, Share → Add to Home Screen. App icon appears on iPhone home screen.
- [ ] Tap icon → opens as PWA with no Safari chrome, still paired.
- [ ] Quit SAI, relaunch → home-screen icon still reconnects (proves stable port).

## Network change

- [ ] Move laptop to a different network (e.g. cellular hotspot vs. home wifi). Tailnet IP may change.
- [ ] Within 60s of the change, status URL updates. iPhone PWA reconnects.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/notes/2026-05-25-mobile-remote-p0-smoke.md
git commit -m "docs(remote): manual smoke checklist for phase 0"
```

---

## Task 19: Full test run + tidy

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: all unit + integration tests pass, no regressions in existing suites.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: If anything fails, fix in place and re-run before committing**

- [ ] **Step 4: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "chore(remote): final tidy after p0 verification"
```

---

## Done

Phase 0 is complete when:

1. All vitest unit tests pass.
2. The integration end-to-end test passes.
3. `tsc --noEmit` is clean.
4. The manual smoke checklist has been walked on real hardware.
5. Phone retains pairing across desktop restart (stable port verified).

After this lands, brainstorm Phase 1 (Chat + approvals) — that phase wires SAI's existing chat event stream into the `SessionBus` and adds the application surfaces on the PWA.
