// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';

let userData = '';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => userData) },
}));

function writeSettings(settings: unknown) {
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify(settings));
}

async function loadDevlog() {
  vi.resetModules();
  return import('@electron/services/devlog');
}

describe('devlog gating', () => {
  beforeEach(() => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-devlog-'));
    delete process.env.SAI_DEVLOG;
    delete process.env.SAI_DEVLOG_CHANNELS;
  });

  afterEach(() => {
    delete process.env.SAI_DEVLOG;
    delete process.env.SAI_DEVLOG_CHANNELS;
    fs.rmSync(userData, { recursive: true, force: true });
  });

  it('is off for a non-maintainer account', async () => {
    writeSettings({ github_auth: { user: { login: 'someone-else' } } });
    const { devlogEnabled } = await loadDevlog();
    expect(devlogEnabled()).toBe(false);
  });

  it('is off when signed out', async () => {
    writeSettings({});
    const { devlogEnabled } = await loadDevlog();
    expect(devlogEnabled()).toBe(false);
  });

  it('is on for the maintainer account', async () => {
    writeSettings({ github_auth: { user: { login: 'darkharasho' } } });
    const { devlogEnabled } = await loadDevlog();
    expect(devlogEnabled()).toBe(true);
  });

  it('SAI_DEVLOG=1 forces on, SAI_DEVLOG=0 forces off', async () => {
    writeSettings({ github_auth: { user: { login: 'someone-else' } } });
    process.env.SAI_DEVLOG = '1';
    let mod = await loadDevlog();
    expect(mod.devlogEnabled()).toBe(true);

    writeSettings({ github_auth: { user: { login: 'darkharasho' } } });
    process.env.SAI_DEVLOG = '0';
    mod = await loadDevlog();
    expect(mod.devlogEnabled()).toBe(false);
  });

  it('writes one JSON record per call when enabled', async () => {
    writeSettings({ github_auth: { user: { login: 'darkharasho' } } });
    const { devlog, devlogPath } = await loadDevlog();
    devlog('notify', 'completion.fired', { projectPath: '/a', turnSeq: 3 });
    devlog('notify', 'completion.suppressed.focused', { projectPath: '/a' });

    const lines = fs.readFileSync(devlogPath(), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first).toMatchObject({ ch: 'notify', ev: 'completion.fired', projectPath: '/a', turnSeq: 3 });
    expect(typeof first.t).toBe('string');
  });

  it('is on when settings opt in, regardless of account', async () => {
    writeSettings({ devlog: true, github_auth: { user: { login: 'someone-else' } } });
    const { devlogEnabled } = await loadDevlog();
    expect(devlogEnabled()).toBe(true);
  });

  it('SAI_DEVLOG_CHANNELS narrows output to the listed channels', async () => {
    writeSettings({ github_auth: { user: { login: 'darkharasho' } } });
    process.env.SAI_DEVLOG_CHANNELS = 'notify';
    const { devlog, devlogPath } = await loadDevlog();
    devlog('notify', 'kept');
    devlog('claude-sdk', 'dropped');
    delete process.env.SAI_DEVLOG_CHANNELS;

    const lines = fs.readFileSync(devlogPath(), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ ch: 'notify', ev: 'kept' });
  });

  it('devlogFor binds a channel', async () => {
    writeSettings({ github_auth: { user: { login: 'darkharasho' } } });
    const { devlogFor, devlogPath } = await loadDevlog();
    devlogFor('terminal')('spawn', { shell: 'bash' });
    const rec = JSON.parse(fs.readFileSync(devlogPath(), 'utf-8').trim());
    expect(rec).toMatchObject({ ch: 'terminal', ev: 'spawn', shell: 'bash' });
  });

  it('devlogTimed records duration and passes results through', async () => {
    writeSettings({ github_auth: { user: { login: 'darkharasho' } } });
    const { devlogTimed, devlogPath } = await loadDevlog();

    expect(devlogTimed('perf', 'sync', () => 41 + 1)).toBe(42);
    await expect(devlogTimed('perf', 'async', async () => 'done')).resolves.toBe('done');
    expect(() => devlogTimed('perf', 'boom', () => { throw new Error('nope'); })).toThrow('nope');

    const recs = fs.readFileSync(devlogPath(), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    expect(recs.map((r) => [r.ev, r.ok])).toEqual([['sync', true], ['async', true], ['boom', false]]);
    expect(typeof recs[0].ms).toBe('number');
  });

  it('writes nothing when disabled', async () => {
    writeSettings({ github_auth: { user: { login: 'someone-else' } } });
    const { devlog } = await loadDevlog();
    devlog('notify', 'completion.fired', { projectPath: '/a' });
    expect(fs.existsSync(path.join(userData, 'logs', 'devlog.jsonl'))).toBe(false);
  });
});
