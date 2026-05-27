# Pairing Device Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-pairing from the same mobile browser replaces the prior pairing instead of stacking duplicate rows, and the default device label becomes a human-readable string like `iPhone · Safari · #a3f4`.

**Architecture:** Mobile renderer generates a stable `clientId` once and stores it in localStorage. It is sent with every `/pair` claim along with a parsed UA-based label. The bridge server passes `clientId` through to `PairingStore.issue`, which silently revokes any non-revoked rows that share the same `clientId` before inserting the new row.

**Tech Stack:** TypeScript, Node `crypto`, Vitest, native `fetch`/`http`.

**Spec:** `docs/superpowers/specs/2026-05-26-pairing-device-identity-design.md`

---

## File Structure

- `electron/services/remote/pairing-store.ts` — add `clientId` to `Row`/`PairedDevice`; extend `issue(label, clientId?)` with dedupe.
- `electron/services/remote/bridge-server.ts` — accept `clientId` in `POST /pair` body; thread to `pairing.issue`.
- `src/renderer-remote/deviceLabel.ts` — **new**, pure UA → label parser.
- `src/renderer-remote/wire.ts` — `pair()` gains a `clientId` arg.
- `src/renderer-remote/App.tsx` — get-or-create `clientId` in localStorage; build label via `describeDevice`; pass both to `pair`.
- `tests/unit/remote/pairing-store.test.ts` — extend.
- `tests/unit/remote/bridge-server-pair.test.ts` — extend.
- `tests/unit/remote/device-label.test.ts` — **new**.

---

## Task 1: `PairingStore` — add `clientId` field and dedupe on issue

**Files:**
- Modify: `electron/services/remote/pairing-store.ts`
- Test: `tests/unit/remote/pairing-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Append these tests to `tests/unit/remote/pairing-store.test.ts` (inside the existing `describe('PairingStore', …)` block):

```typescript
  it('issuing with a matching clientId revokes the prior row', async () => {
    let t = 1000;
    const store = new PairingStore(':memory:', () => t++);
    const first = await store.issue('iPhone', 'client-A');
    await store.issue('iPhone (re-pair)', 'client-A');
    const rows = store.list();
    // newest first
    expect(rows[0].label).toBe('iPhone (re-pair)');
    expect(rows[0].revokedAt).toBeNull();
    expect(rows[1].label).toBe('iPhone');
    expect(rows[1].revokedAt).not.toBeNull();
    // prior token no longer verifies
    expect(await store.verify(first.token)).toBeNull();
  });

  it('issuing with a clientId does not touch rows with a different clientId', async () => {
    const store = new PairingStore(':memory:');
    const other = await store.issue('Pixel', 'client-B');
    await store.issue('iPhone', 'client-A');
    const rows = store.list();
    const pixel = rows.find((r) => r.label === 'Pixel');
    expect(pixel?.revokedAt).toBeNull();
    expect(await store.verify(other.token)).not.toBeNull();
  });

  it('issuing with a clientId does not touch rows with null clientId', async () => {
    const store = new PairingStore(':memory:');
    const legacy = await store.issue('Legacy');
    await store.issue('iPhone', 'client-A');
    expect(await store.verify(legacy.token)).not.toBeNull();
  });

  it('issuing without a clientId never revokes anything', async () => {
    const store = new PairingStore(':memory:');
    const a = await store.issue('A');
    await store.issue('B');
    expect(await store.verify(a.token)).not.toBeNull();
  });

  it('list() exposes clientId on each entry', async () => {
    const store = new PairingStore(':memory:');
    await store.issue('iPhone', 'client-A');
    await store.issue('Legacy');
    const rows = store.list();
    expect(rows.find((r) => r.label === 'iPhone')?.clientId).toBe('client-A');
    expect(rows.find((r) => r.label === 'Legacy')?.clientId).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/remote/pairing-store.test.ts`
Expected: the five new tests FAIL (TypeScript will complain about `clientId` arg on `issue`, and `clientId` missing from `PairedDevice`).

- [ ] **Step 3: Implement `clientId` and dedupe in the store**

Replace `electron/services/remote/pairing-store.ts` with:

```typescript
import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promises as fsp, existsSync, mkdirSync, readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export interface PairedDevice {
  id: string;
  label: string;
  clientId: string | null;
  pairedAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
}

interface Row extends PairedDevice {
  tokenSalt: string;
  tokenHash: string;
}

interface FileShape {
  devices: Row[];
}

const SCRYPT_KEYLEN = 64;

async function hashToken(token: string): Promise<{ salt: string; hash: string }> {
  const salt = randomBytes(16);
  const derived = await scrypt(token, salt, SCRYPT_KEYLEN);
  return { salt: salt.toString('base64'), hash: derived.toString('base64') };
}

async function verifyToken(token: string, saltB64: string, hashB64: string): Promise<boolean> {
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const derived = await scrypt(token, salt, expected.length);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export class PairingStore {
  private rows: Row[] = [];
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly path: string, private readonly now: () => number = Date.now) {
    if (path !== ':memory:') this.loadSync();
  }

  private loadSync(): void {
    try {
      const dir = nodePath.dirname(this.path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      if (!existsSync(this.path)) { this.rows = []; return; }
      const raw = readFileSync(this.path, 'utf8');
      const data = JSON.parse(raw) as FileShape;
      const loaded = Array.isArray(data.devices) ? data.devices : [];
      this.rows = loaded.map((r) => ({ ...r, clientId: r.clientId ?? null }));
    } catch {
      this.rows = [];
    }
  }

  private async persist(): Promise<void> {
    if (this.path === ':memory:') return;
    const snapshot = JSON.stringify({ devices: this.rows }, null, 2);
    this.writeChain = this.writeChain.then(async () => {
      const tmp = `${this.path}.tmp`;
      await fsp.writeFile(tmp, snapshot, 'utf8');
      await fsp.rename(tmp, this.path);
    }).catch(() => { /* swallow; next write retries */ });
    return this.writeChain;
  }

  async issue(label: string, clientId?: string | null): Promise<{ deviceId: string; token: string }> {
    const cid = clientId ?? null;
    if (cid !== null) {
      const now = this.now();
      for (const row of this.rows) {
        if (row.clientId === cid && !row.revokedAt) row.revokedAt = now;
      }
    }
    const deviceId = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const { salt, hash } = await hashToken(token);
    this.rows.push({
      id: deviceId, label, clientId: cid,
      pairedAt: this.now(), lastSeenAt: null, revokedAt: null,
      tokenSalt: salt, tokenHash: hash,
    });
    await this.persist();
    return { deviceId, token };
  }

  async verify(token: string): Promise<PairedDevice | null> {
    for (const row of this.rows) {
      if (row.revokedAt) continue;
      if (await verifyToken(token, row.tokenSalt, row.tokenHash)) {
        row.lastSeenAt = this.now();
        await this.persist();
        return {
          id: row.id, label: row.label, clientId: row.clientId,
          pairedAt: row.pairedAt, lastSeenAt: row.lastSeenAt, revokedAt: row.revokedAt,
        };
      }
    }
    return null;
  }

  revoke(deviceId: string): void {
    const row = this.rows.find((r) => r.id === deviceId);
    if (row && !row.revokedAt) {
      row.revokedAt = this.now();
      void this.persist();
    }
  }

  list(): PairedDevice[] {
    return [...this.rows]
      .sort((a, b) => b.pairedAt - a.pairedAt)
      .map((r) => ({
        id: r.id, label: r.label, clientId: r.clientId,
        pairedAt: r.pairedAt, lastSeenAt: r.lastSeenAt, revokedAt: r.revokedAt,
      }));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/remote/pairing-store.test.ts`
Expected: all tests PASS (existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add electron/services/remote/pairing-store.ts tests/unit/remote/pairing-store.test.ts
git commit -m "feat(remote): clientId dedupe in PairingStore"
```

---

## Task 2: `BridgeServer` — accept `clientId` in `POST /pair`

**Files:**
- Modify: `electron/services/remote/bridge-server.ts` (around line 258)
- Test: `tests/unit/remote/bridge-server-pair.test.ts`

- [ ] **Step 1: Write the failing tests**

Append these tests to `tests/unit/remote/bridge-server-pair.test.ts` (inside the existing `describe('BridgeServer HTTP', …)` block):

```typescript
  it('POST /pair with clientId dedupes prior pairings from the same client', async () => {
    const code1 = server.mintPairingCode();
    const r1 = await fetch(`http://127.0.0.1:${port}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: code1, deviceLabel: 'iPhone', clientId: 'client-A' }),
    });
    expect(r1.status).toBe(200);
    const code2 = server.mintPairingCode();
    const r2 = await fetch(`http://127.0.0.1:${port}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: code2, deviceLabel: 'iPhone (re-pair)', clientId: 'client-A' }),
    });
    expect(r2.status).toBe(200);
    const list = (server as unknown as { opts: { pairing: PairingStore } }).opts.pairing.list();
    const active = list.filter((d) => !d.revokedAt);
    expect(active).toHaveLength(1);
    expect(active[0].label).toBe('iPhone (re-pair)');
  });

  it('POST /pair without clientId stores clientId as null', async () => {
    const code = server.mintPairingCode();
    const r = await fetch(`http://127.0.0.1:${port}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceLabel: 'Legacy' }),
    });
    expect(r.status).toBe(200);
    const list = (server as unknown as { opts: { pairing: PairingStore } }).opts.pairing.list();
    expect(list[0].clientId).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/remote/bridge-server-pair.test.ts`
Expected: the two new tests FAIL — the existing `handlePair` doesn't read `clientId`, so rows have `clientId: null` and dedupe doesn't fire (first test expects `active.length === 1` but will get 2).

- [ ] **Step 3: Thread `clientId` through `handlePair`**

In `electron/services/remote/bridge-server.ts`, replace the `handlePair` body (lines ~256–267) with:

```typescript
  private async handlePair(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (this.rateLimited(req)) { res.statusCode = 429; res.end('too many requests'); return; }
    const body = await this.readJson<{ code: string; deviceLabel?: string; clientId?: string }>(req);
    const entry = this.codes.get(body.code);
    const now = Date.now();
    if (!entry || entry.expiresAt < now) { res.statusCode = 401; res.end('invalid code'); return; }
    this.codes.delete(body.code);
    const { deviceId, token } = await this.opts.pairing.issue(
      body.deviceLabel ?? 'Mobile',
      body.clientId ?? null,
    );
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ token, deviceId, wsUrl: '/ws' }));
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/remote/bridge-server-pair.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/remote/bridge-server.ts tests/unit/remote/bridge-server-pair.test.ts
git commit -m "feat(remote): accept clientId in POST /pair"
```

---

## Task 3: `describeDevice` — pure UA → label parser

**Files:**
- Create: `src/renderer-remote/deviceLabel.ts`
- Test: `tests/unit/remote/device-label.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/remote/device-label.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { describeDevice } from '@/renderer-remote/deviceLabel';

describe('describeDevice', () => {
  const cid = 'a3f4abcd-1111-2222-3333-444455556666';

  it('formats iPhone Safari', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/605.1.15';
    expect(describeDevice(ua, cid)).toBe('iPhone · Safari · #a3f4');
  });

  it('formats iPad Safari', () => {
    const ua = 'Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/605.1.15';
    expect(describeDevice(ua, cid)).toBe('iPad · Safari · #a3f4');
  });

  it('formats Android Chrome', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36';
    expect(describeDevice(ua, cid)).toBe('Android · Chrome · #a3f4');
  });

  it('formats Mac Safari', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15';
    expect(describeDevice(ua, cid)).toBe('Mac · Safari · #a3f4');
  });

  it('formats Windows Chrome', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
    expect(describeDevice(ua, cid)).toBe('Windows · Chrome · #a3f4');
  });

  it('formats Linux Firefox', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';
    expect(describeDevice(ua, cid)).toBe('Linux · Firefox · #a3f4');
  });

  it('formats Edge as Edge, not Chrome', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0';
    expect(describeDevice(ua, cid)).toBe('Windows · Edge · #a3f4');
  });

  it('falls back to Device for unrecognized UA', () => {
    expect(describeDevice('totally unknown agent', cid)).toBe('Device · #a3f4');
  });

  it('uses first 4 chars of clientId as suffix', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';
    expect(describeDevice(ua, '9c10ffff-0000')).toBe('Linux · Firefox · #9c10');
  });

  it('handles empty clientId by omitting suffix', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';
    expect(describeDevice(ua, '')).toBe('Linux · Firefox');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/remote/device-label.test.ts`
Expected: FAIL — `describeDevice` not defined / module not found.

- [ ] **Step 3: Implement `describeDevice`**

Create `src/renderer-remote/deviceLabel.ts`:

```typescript
export function describeDevice(ua: string, clientId: string): string {
  const platform = detectPlatform(ua);
  const browser = detectBrowser(ua);
  const suffix = clientId ? `#${clientId.slice(0, 4)}` : '';
  const parts = [platform];
  if (browser) parts.push(browser);
  if (suffix) parts.push(suffix);
  return parts.join(' · ');
}

function detectPlatform(ua: string): string {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Linux|X11/.test(ua)) return 'Linux';
  return 'Device';
}

function detectBrowser(ua: string): string | null {
  // Order matters: Edge advertises Chrome; Chrome advertises Safari.
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return null;
}
```

Note: the `@/renderer-remote/...` import alias is used by other tests in this repo (see `tests/unit/remote/pwa-wire.test.ts`). If your test fails to resolve the import, mirror what nearby tests use.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/remote/device-label.test.ts`
Expected: all 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer-remote/deviceLabel.ts tests/unit/remote/device-label.test.ts
git commit -m "feat(remote): describeDevice UA parser"
```

---

## Task 4: `wire.pair()` — accept `clientId` arg

**Files:**
- Modify: `src/renderer-remote/wire.ts`

- [ ] **Step 1: Update `pair()` signature**

In `src/renderer-remote/wire.ts`, replace the existing `pair` function (lines 9–16) with:

```typescript
export async function pair(code: string, deviceLabel: string, clientId: string): Promise<PairResult> {
  const r = await fetch('/pair', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, deviceLabel, clientId }),
  });
  if (!r.ok) throw new Error(`pair failed: ${r.status}`);
  return r.json();
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: one error in `src/renderer-remote/App.tsx` at the `pair(code, label)` call site — missing third argument. This is fixed in Task 5.

- [ ] **Step 3: Do not commit yet**

Wait for Task 5 to land together so the tree stays buildable.

---

## Task 5: `App.tsx` — get-or-create `clientId`, build label, pass both

**Files:**
- Modify: `src/renderer-remote/App.tsx`

- [ ] **Step 1: Add a clientId helper at module scope**

In `src/renderer-remote/App.tsx`, near the top of the file (above the `App` component), add:

```typescript
import { describeDevice } from './deviceLabel';

const CLIENT_ID_KEY = 'sai.remote.clientId';

function getOrCreateClientId(): string {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, created);
    return created;
  } catch {
    // localStorage unavailable (private mode / disabled). Per-session fallback.
    return crypto.randomUUID();
  }
}
```

- [ ] **Step 2: Use it in the pair effect**

In the same file, replace the block currently at lines ~94–98:

```typescript
        if (code && !bearer) {
          setPhase('pairing');
          const label = navigator.userAgent.slice(0, 64);
          const { token, deviceId } = await pair(code, label);
          localStorage.setItem(BEARER_KEY, JSON.stringify({ token, deviceId, label }));
```

with:

```typescript
        if (code && !bearer) {
          setPhase('pairing');
          const clientId = getOrCreateClientId();
          const label = describeDevice(navigator.userAgent, clientId);
          const { token, deviceId } = await pair(code, label, clientId);
          localStorage.setItem(BEARER_KEY, JSON.stringify({ token, deviceId, label }));
```

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: clean.

- [ ] **Step 4: Run the unit test suite**

Run: `npx vitest run tests/unit/remote`
Expected: all PASS.

- [ ] **Step 5: Commit Tasks 4 + 5 together**

```bash
git add src/renderer-remote/wire.ts src/renderer-remote/App.tsx
git commit -m "feat(remote): mobile sends clientId + parsed device label"
```

---

## Task 6: Full verification sweep

- [ ] **Step 1: Run the full unit + integration suite for the remote bridge**

Run: `npx vitest run tests/unit/remote tests/integration/remote`
Expected: all PASS. If any pre-existing integration test fails because it constructs `PairedDevice` literals without a `clientId`, add `clientId: null` to those literals.

- [ ] **Step 2: Run the linter**

Run: `npm run lint`
Expected: clean (or only pre-existing warnings unrelated to these files).

- [ ] **Step 3: Manual smoke (document, do not block on)**

In a follow-up smoke session (not part of this plan's commits):
1. Pair the mobile PWA, observe label in desktop `RemoteSettings` is something like `iPhone · Safari · #a3f4`.
2. Pair again from the same browser; observe the previous row disappears from the active list.
3. Pair from a different browser; observe both rows coexist.

---

## Self-Review Notes

- **Spec coverage:** Stable clientId (Tasks 1, 5), bridge passthrough (Task 2), label parser (Task 3), wire change (Task 4), mobile integration (Task 5). All spec testing items covered in Tasks 1–3.
- **Type consistency:** `PairedDevice` gains `clientId: string | null` (Task 1) and is read as `.clientId` in Task 2 test. `pair(code, label, clientId)` signature defined in Task 4 and called with three args in Task 5.
- **Placeholder scan:** none.
- **JSON backward compat:** Task 1 step 3 normalizes loaded rows (`clientId: r.clientId ?? null`), so existing on-disk files continue to load.
