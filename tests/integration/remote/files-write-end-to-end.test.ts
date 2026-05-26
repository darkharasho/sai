import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RemoteModule } from '@electron/services/remote';
import { BridgeServer } from '@electron/services/remote/bridge-server';
import { PairingStore } from '@electron/services/remote/pairing-store';
import { SessionBus } from '@electron/services/remote/session-bus';
import { safeJoin } from '@electron/services/remote/safe-join';
import { langFromPath, isTextLike } from '@electron/services/remote/lang';
import { readFileImpl, statFileImpl, writeFileImpl } from '@electron/services/fs';

describe('mobile remote files.write end-to-end', () => {
  let tmpRoot: string;
  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-files-write-e2e-'));
    fs.writeFileSync(path.join(tmpRoot, 'a.txt'), 'one\n');
  });
  afterAll(() => { fs.rmSync(tmpRoot, { recursive: true, force: true }); });

  it('read → write happy path, then concurrent modify → stale → force-write', async () => {
    const pairing = new PairingStore(':memory:');
    const bus = new SessionBus();

    const remote = new RemoteModule({
      pairing, bus,
      resolveTailnetEndpoint: async () => ({ ip: '127.0.0.1', host: null }),
      makeBridge: (ip) => new BridgeServer({
        tailnetIp: ip, pairing, bus, pwaDir: null,
        screenshotSecret: 'e2e', loadScreenshot: async () => null, port: 0,
        readFile: async (cwd, p) => {
          const full = safeJoin(cwd, p);
          const stat = await statFileImpl(full);
          if (isTextLike(p) && stat.size <= 64 * 1024) {
            const r = await readFileImpl(full);
            return { content: r.content, encoding: 'text' as const, size: stat.size,
                     lang: langFromPath(p) ?? undefined, mtime: r.mtime, sha: r.sha };
          }
          return { encoding: 'binary' as const, size: stat.size };
        },
        writeFile: (cwd, p, content, opts) => writeFileImpl(cwd, p, content, opts),
      }),
      pollMs: 0,
    });
    await remote.start();
    const { url } = remote.status();

    const { code } = remote.mintPairingCode();
    const pairRes = await fetch(`${url}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, deviceLabel: 'E2E' }),
    });
    const { token } = await pairRes.json();
    const ws = new WebSocket(`${url!.replace(/^http/, 'ws')}/ws`);
    const inbox: any[] = [];
    ws.on('message', (d) => inbox.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'auth', token }));
    const deadline = Date.now() + 3000;
    while (!inbox.find((m) => m.type === 'auth_ok') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }

    // 1. Read.
    ws.send(JSON.stringify({ type: 'files.read', cwd: tmpRoot, path: 'a.txt', reqId: 'r1' }));
    await new Promise((r) => setTimeout(r, 100));
    const read = inbox.find((m) => m.type === 'files.read.result');
    expect(read.content).toBe('one\n');
    expect(typeof read.mtime).toBe('number');
    expect(read.sha).toMatch(/^[0-9a-f]{16}$/);

    // 2. Happy-path write.
    ws.send(JSON.stringify({
      type: 'files.write', cwd: tmpRoot, path: 'a.txt', content: 'two\n',
      expectMtime: read.mtime, expectSha: read.sha, reqId: 'w1',
    }));
    await new Promise((r) => setTimeout(r, 100));
    const w1 = inbox.find((m) => m.type === 'files.write.result' && m.reqId === 'w1');
    expect(w1).toBeTruthy();
    expect(fs.readFileSync(path.join(tmpRoot, 'a.txt'), 'utf-8')).toBe('two\n');

    // 3. Concurrent desktop edit, then phone tries to save with the post-w1 mtime/sha.
    fs.writeFileSync(path.join(tmpRoot, 'a.txt'), 'desktop\n');
    ws.send(JSON.stringify({
      type: 'files.write', cwd: tmpRoot, path: 'a.txt', content: 'phone\n',
      expectMtime: w1.mtime, expectSha: w1.sha, reqId: 'w2',
    }));
    await new Promise((r) => setTimeout(r, 100));
    const w2 = inbox.find((m) => m.type === 'error' && m.reqId === 'w2');
    expect(w2.code).toBe('stale');
    expect(w2.currentSha).toMatch(/^[0-9a-f]{16}$/);
    expect(fs.readFileSync(path.join(tmpRoot, 'a.txt'), 'utf-8')).toBe('desktop\n');

    // 4. Force-write succeeds.
    ws.send(JSON.stringify({
      type: 'files.write', cwd: tmpRoot, path: 'a.txt', content: 'phone\n',
      expectMtime: null, expectSha: null, reqId: 'w3',
    }));
    await new Promise((r) => setTimeout(r, 100));
    const w3 = inbox.find((m) => m.type === 'files.write.result' && m.reqId === 'w3');
    expect(w3).toBeTruthy();
    expect(fs.readFileSync(path.join(tmpRoot, 'a.txt'), 'utf-8')).toBe('phone\n');

    ws.close();
    await remote.stop();
  });
});
