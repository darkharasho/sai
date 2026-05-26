import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RemoteModule } from '@electron/services/remote';
import { BridgeServer } from '@electron/services/remote/bridge-server';
import { PairingStore } from '@electron/services/remote/pairing-store';
import { SessionBus } from '@electron/services/remote/session-bus';
import { BlobStore } from '@electron/services/remote/blob-store';
import { safeJoin } from '@electron/services/remote/safe-join';
import { langFromPath, isTextLike, mimeFromPath } from '@electron/services/remote/lang';
import { readDirImpl, readFileImpl, readFileBufImpl, statFileImpl } from '@electron/services/fs';
import { gitStatusImpl, gitDiffImpl } from '@electron/services/git';

describe('mobile remote files end-to-end', () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-files-e2e-'));
    fs.writeFileSync(path.join(tmpRoot, 'a.ts'), 'export const x = 1;\n');
    execSync('git init -q && git add a.ts && git -c user.email=t@t -c user.name=T commit -q -m init', { cwd: tmpRoot });
    fs.writeFileSync(path.join(tmpRoot, 'a.ts'), 'export const x = 2;\n');
  });
  afterAll(() => { fs.rmSync(tmpRoot, { recursive: true, force: true }); });

  it('list → status → diff → read round trip', async () => {
    const pairing = new PairingStore(':memory:');
    const bus = new SessionBus();
    const blobStore = new BlobStore();
    let bridge: BridgeServer | null = null;

    const remote = new RemoteModule({
      pairing, bus,
      resolveTailnetEndpoint: async () => ({ ip: '127.0.0.1', host: null }),
      makeBridge: (ip) => {
        const b = new BridgeServer({
          tailnetIp: ip, pairing, bus, pwaDir: null,
          screenshotSecret: 'e2e', loadScreenshot: async () => null, port: 0,
          listFiles: async (cwd, p) => {
            const entries = await readDirImpl(safeJoin(cwd, p));
            return entries.map((e) => ({ name: e.name, kind: e.type === 'directory' ? 'dir' as const : 'file' as const }));
          },
          readFile: async (cwd, p) => {
            const full = safeJoin(cwd, p);
            const stat = await statFileImpl(full);
            if (isTextLike(p) && stat.size <= 64 * 1024) {
              const content = await readFileImpl(full);
              return { content, encoding: 'text' as const, size: stat.size, lang: langFromPath(p) ?? undefined };
            }
            const id = blobStore.register(cwd, p);
            const signedUrl = b.signBlobUrl(id);
            return { signedUrl, encoding: 'binary' as const, size: stat.size, mime: mimeFromPath(p) };
          },
          statusFiles: async (cwd) => (await gitStatusImpl(cwd)).entries,
          diffFile: async (cwd, p, staged) => ({ diff: await gitDiffImpl(cwd, p, staged), lang: langFromPath(p) ?? undefined }),
          loadBlob: async (id) => {
            const e = blobStore.consume(id);
            if (!e) return null;
            return { buffer: await readFileBufImpl(safeJoin(e.cwd, e.path)), mime: mimeFromPath(e.path) };
          },
        });
        bridge = b;
        return b;
      },
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

    ws.send(JSON.stringify({ type: 'files.list', cwd: tmpRoot, path: '', reqId: 'l1' }));
    await new Promise((r) => setTimeout(r, 80));
    const list = inbox.find((m) => m.type === 'files.list.result');
    expect(list).toBeTruthy();
    expect(list.entries.some((e: any) => e.name === 'a.ts')).toBe(true);

    ws.send(JSON.stringify({ type: 'files.status', cwd: tmpRoot, reqId: 's1' }));
    await new Promise((r) => setTimeout(r, 80));
    const status = inbox.find((m) => m.type === 'files.status.result');
    expect(status.entries.length).toBeGreaterThan(0);
    expect(status.entries[0].path).toBe('a.ts');

    ws.send(JSON.stringify({ type: 'files.diff', cwd: tmpRoot, path: 'a.ts', staged: false, reqId: 'd1' }));
    await new Promise((r) => setTimeout(r, 80));
    const diff = inbox.find((m) => m.type === 'files.diff.result');
    expect(diff.diff).toMatch(/-export const x = 1/);
    expect(diff.diff).toMatch(/\+export const x = 2/);

    ws.send(JSON.stringify({ type: 'files.read', cwd: tmpRoot, path: 'a.ts', reqId: 'r1' }));
    await new Promise((r) => setTimeout(r, 80));
    const read = inbox.find((m) => m.type === 'files.read.result');
    expect(read.encoding).toBe('text');
    expect(read.content).toMatch(/export const x = 2/);

    const bigPath = path.join(tmpRoot, 'big.png');
    fs.writeFileSync(bigPath, Buffer.alloc(100 * 1024, 0xab));
    ws.send(JSON.stringify({ type: 'files.read', cwd: tmpRoot, path: 'big.png', reqId: 'r2' }));
    await new Promise((r) => setTimeout(r, 80));
    const big = inbox.filter((m) => m.type === 'files.read.result').pop();
    expect(big.encoding).toBe('binary');
    expect(big.signedUrl).toMatch(/^\/blob\//);

    const blobRes = await fetch(`${url}${big.signedUrl}`);
    expect(blobRes.status).toBe(200);
    const buf = Buffer.from(await blobRes.arrayBuffer());
    expect(buf.length).toBe(100 * 1024);

    const blobRes2 = await fetch(`${url}${big.signedUrl}`);
    expect(blobRes2.status).toBe(401);

    ws.close();
    await remote.stop();
  });
});
