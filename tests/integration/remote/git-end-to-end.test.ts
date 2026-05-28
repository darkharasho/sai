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
import {
  gitStatusImpl, gitStageImpl, gitUnstageImpl, gitCommitImpl,
} from '@electron/services/git';

describe('mobile remote git end-to-end', () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-git-e2e-'));
    fs.writeFileSync(path.join(tmpRoot, 'a.txt'), 'one\n');
    execSync('git init -q', { cwd: tmpRoot });
    // CI runners (ubuntu-latest) have no global git identity, so the later
    // commit-via-simple-git would silently fail. Pin identity at the repo level.
    execSync('git config user.email t@t && git config user.name T', { cwd: tmpRoot });
    execSync('git add a.txt && git commit -q -m init', { cwd: tmpRoot });
    fs.writeFileSync(path.join(tmpRoot, 'a.txt'), 'two\n');
  });
  afterAll(() => { fs.rmSync(tmpRoot, { recursive: true, force: true }); });

  async function send(ws: WebSocket, frame: any, inbox: any[], type: string, timeoutMs = 2000): Promise<any> {
    ws.send(JSON.stringify(frame));
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const m = inbox.find((x) => x.type === type && x.reqId === frame.reqId);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`timeout waiting for ${type}`);
  }

  it('stage → status → commit → status', async () => {
    const pairing = new PairingStore(':memory:');
    const bus = new SessionBus();

    const remote = new RemoteModule({
      pairing, bus,
      resolveTailnetEndpoint: async () => ({ ip: '127.0.0.1', host: null }),
      makeBridge: (ip) => new BridgeServer({
        tailnetIp: ip, pairing, bus, pwaDir: null,
        screenshotSecret: 'e2e', loadScreenshot: async () => null, port: 0,
        statusFiles: async (cwd) => {
          const { entries, branch, ahead, behind } = await gitStatusImpl(cwd);
          return { entries, branch, ahead, behind };
        },
        stageFile:   (cwd, p) => gitStageImpl(cwd, p),
        unstageFile: (cwd, p) => gitUnstageImpl(cwd, p),
        commit:      (cwd, m) => gitCommitImpl(cwd, m),
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

    let s = await send(ws, { type: 'files.status', cwd: tmpRoot, reqId: 's1' }, inbox, 'files.status.result');
    expect(s.entries.find((e: any) => e.path === 'a.txt')).toMatchObject({ status: 'modified', staged: false });
    expect(s.branch).toBeTruthy();

    await send(ws, { type: 'git.stage', cwd: tmpRoot, path: 'a.txt', reqId: 'g1' }, inbox, 'git.stage.result');

    s = await send(ws, { type: 'files.status', cwd: tmpRoot, reqId: 's2' }, inbox, 'files.status.result');
    expect(s.entries.find((e: any) => e.path === 'a.txt')).toMatchObject({ staged: true });

    const c = await send(ws, { type: 'git.commit', cwd: tmpRoot, message: 'feat: two', reqId: 'c1' }, inbox, 'git.commit.result');
    expect(c.hash).toBeTruthy();

    s = await send(ws, { type: 'files.status', cwd: tmpRoot, reqId: 's3' }, inbox, 'files.status.result');
    expect(s.entries).toHaveLength(0);

    ws.close();
    await remote.stop();
  });
});
