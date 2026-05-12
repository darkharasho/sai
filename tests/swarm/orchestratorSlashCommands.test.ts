import { describe, it, expect, vi } from 'vitest';
import { isSlashCommand, executeSlashCommand } from '../../src/lib/orchestratorSlashCommands';
import type { SwarmHost } from '../../src/lib/swarmOrchestratorDispatcher';

function makeHost(overrides: Partial<Record<keyof SwarmHost, any>> = {}): SwarmHost {
  return {
    spawnTask: vi.fn().mockResolvedValue({ id: 't1', title: 'add tests' }),
    spawnTasks: vi.fn().mockResolvedValue([
      { id: 't1', title: 'a' },
      { id: 't2', title: 'b' },
      { id: 't3', title: 'c' },
    ]),
    snapshot: vi.fn().mockResolvedValue({ active: 2, approvals: 1, ready: 0, tasks: [] }),
    approve: vi.fn().mockResolvedValue(undefined),
    deny: vi.fn().mockResolvedValue(undefined),
    land: vi.fn().mockResolvedValue({ ok: true }),
    discard: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as SwarmHost;
}

describe('isSlashCommand', () => {
  it('returns true for /spawn', () => expect(isSlashCommand('/spawn')).toBe(true));
  it('returns true for leading whitespace', () => expect(isSlashCommand('  /spawn x')).toBe(true));
  it('returns false for spawn (no slash)', () => expect(isSlashCommand('spawn')).toBe(false));
  it('returns false for empty', () => expect(isSlashCommand('')).toBe(false));
  it('returns false for whitespace only', () => expect(isSlashCommand(' ')).toBe(false));
});

describe('executeSlashCommand', () => {
  it('returns handled=false for non-slash text', async () => {
    const host = makeHost();
    const out = await executeSlashCommand('hello', host);
    expect(out).toEqual({ handled: false });
  });

  it('/spawn dispatches and replies with title', async () => {
    const host = makeHost();
    const out = await executeSlashCommand('/spawn add tests', host);
    expect(host.spawnTask).toHaveBeenCalledWith({ prompt: 'add tests' });
    expect(out).toEqual({ handled: true, reply: '✓ "add tests" → spawned' });
  });

  it('/spawn with no prompt asks for one', async () => {
    const host = makeHost();
    const out = await executeSlashCommand('/spawn', host);
    expect(host.spawnTask).not.toHaveBeenCalled();
    expect(out.handled).toBe(true);
    if (out.handled) expect(out.reply).toContain('/spawn requires');
  });

  it('/burst splits body lines and spawns multiple tasks', async () => {
    const host = makeHost();
    const out = await executeSlashCommand('/burst\na\nb\nc', host);
    expect(host.spawnTasks).toHaveBeenCalledWith(['a', 'b', 'c']);
    expect(out.handled).toBe(true);
    if (out.handled) expect(out.reply).toContain('3 tasks');
  });

  it('/burst with no body lines returns guidance', async () => {
    const host = makeHost();
    const out = await executeSlashCommand('/burst', host);
    expect(host.spawnTasks).not.toHaveBeenCalled();
    expect(out.handled).toBe(true);
    if (out.handled) expect(out.reply).toContain('each task on its own line');
  });

  it('/burst trims and skips blank lines', async () => {
    const host = makeHost();
    await executeSlashCommand('/burst\n  a  \n\n  b  \nc\n', host);
    expect(host.spawnTasks).toHaveBeenCalledWith(['a', 'b', 'c']);
  });

  it('/status calls snapshot() with no filter and formats counts', async () => {
    const host = makeHost();
    const out = await executeSlashCommand('/status', host);
    expect(host.snapshot).toHaveBeenCalledWith(undefined);
    expect(out.handled).toBe(true);
    if (out.handled) expect(out.reply).toBe('2 active · 1 approvals · 0 ready');
  });

  it('/status with filter passes string through', async () => {
    const host = makeHost();
    await executeSlashCommand('/status streaming', host);
    expect(host.snapshot).toHaveBeenCalledWith('streaming');
  });

  it('/approve calls host.approve and replies', async () => {
    const host = makeHost();
    const out = await executeSlashCommand('/approve a1', host);
    expect(host.approve).toHaveBeenCalledWith('a1');
    expect(out.handled).toBe(true);
    if (out.handled) expect(out.reply).toContain('approved a1');
  });

  it('/deny calls host.deny and replies', async () => {
    const host = makeHost();
    const out = await executeSlashCommand('/deny a1', host);
    expect(host.deny).toHaveBeenCalledWith('a1');
    expect(out.handled).toBe(true);
    if (out.handled) expect(out.reply).toContain('denied a1');
  });

  it('/land replies success when host returns ok=true', async () => {
    const host = makeHost();
    const out = await executeSlashCommand('/land foo', host);
    expect(host.land).toHaveBeenCalledWith('foo');
    expect(out).toEqual({ handled: true, reply: '✓ landed foo' });
  });

  it('/land replies failure with reason when host returns ok=false', async () => {
    const host = makeHost({ land: vi.fn().mockResolvedValue({ ok: false, reason: 'rebase needed' }) });
    const out = await executeSlashCommand('/land foo', host);
    expect(out).toEqual({ handled: true, reply: '✗ rebase needed' });
  });

  it('/discard calls host.discard', async () => {
    const host = makeHost();
    const out = await executeSlashCommand('/discard foo', host);
    expect(host.discard).toHaveBeenCalledWith('foo');
    expect(out.handled).toBe(true);
    if (out.handled) expect(out.reply).toContain('discarded foo');
  });

  it('/pause calls host.pause', async () => {
    const host = makeHost();
    const out = await executeSlashCommand('/pause foo', host);
    expect(host.pause).toHaveBeenCalledWith('foo');
    expect(out.handled).toBe(true);
    if (out.handled) expect(out.reply).toContain('paused foo');
  });

  it('/resume calls host.resume', async () => {
    const host = makeHost();
    const out = await executeSlashCommand('/resume foo', host);
    expect(host.resume).toHaveBeenCalledWith('foo');
    expect(out.handled).toBe(true);
    if (out.handled) expect(out.reply).toContain('resumed foo');
  });

  it('/help replies with a command listing without calling host', async () => {
    const host = makeHost();
    const out = await executeSlashCommand('/help', host);
    expect(host.spawnTask).not.toHaveBeenCalled();
    expect(host.snapshot).not.toHaveBeenCalled();
    expect(out.handled).toBe(true);
    if (out.handled) {
      expect(out.reply).toContain('/spawn');
      expect(out.reply).toContain('/burst');
      expect(out.reply).toContain('/status');
      expect(out.reply).toContain('/land');
    }
  });

  it('/unknown returns Unknown slash command message', async () => {
    const host = makeHost();
    const out = await executeSlashCommand('/foo bar', host);
    expect(out.handled).toBe(true);
    if (out.handled) expect(out.reply).toContain('Unknown slash command');
  });

  it('catches host errors and turns them into ✗ replies', async () => {
    const host = makeHost({ spawnTask: vi.fn().mockRejectedValue(new Error('boom')) });
    const out = await executeSlashCommand('/spawn add tests', host);
    expect(out.handled).toBe(true);
    if (out.handled) expect(out.reply).toBe('✗ boom');
  });

  it('handles leading whitespace before slash', async () => {
    const host = makeHost();
    const out = await executeSlashCommand('  /spawn add tests', host);
    expect(host.spawnTask).toHaveBeenCalledWith({ prompt: 'add tests' });
    expect(out.handled).toBe(true);
  });
});
