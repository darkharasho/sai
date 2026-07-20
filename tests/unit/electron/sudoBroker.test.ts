// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { SudoBroker, type SudoPromptArgs } from '@electron/services/sudo/sudoBroker';

function fakeSession(opts: { unlocked?: boolean; unlock?: (pw: string) => { ok: boolean; error?: string } }) {
  let unlocked = opts.unlocked ?? false;
  return {
    isUnlocked: () => unlocked,
    unlock: async (password: string) => {
      const res = opts.unlock ? opts.unlock(password) : { ok: true };
      if (res.ok) unlocked = true;
      return res;
    },
  };
}

const baseArgs: SudoPromptArgs = {
  projectPath: '/proj',
  scope: 'scope-1',
  toolUseId: 'toolu_1',
  command: 'sudo apt update',
};

function makeBroker(session: ReturnType<typeof fakeSession>) {
  const events: Array<Record<string, unknown>> = [];
  const broker = new SudoBroker(session, (e) => events.push(e), { promptTimeoutMs: 50 });
  return { broker, events };
}

describe('SudoBroker.ensureUnlocked', () => {
  it('returns true immediately if already unlocked, with no prompt', async () => {
    const { broker, events } = makeBroker(fakeSession({ unlocked: true }));
    expect(await broker.ensureUnlocked(baseArgs)).toBe(true);
    expect(events).toEqual([]);
  });

  it('prompts, accepts a valid password, and unlocks', async () => {
    const { broker, events } = makeBroker(fakeSession({ unlock: () => ({ ok: true }) }));
    const p = broker.ensureUnlocked(baseArgs);
    await vi.waitFor(() => expect(events.some((e) => e.type === 'sudo-prompt')).toBe(true));
    const evt = events.find((e) => e.type === 'sudo-prompt')!;
    expect(evt).toMatchObject({ projectPath: '/proj', scope: 'scope-1', command: 'sudo apt update' });
    broker.resolveSudo(evt.promptId as string, 'goodpw');
    expect(await p).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'sudo-resolved', status: 'unlocked' });
  });

  it('cancels when the renderer replies with null', async () => {
    const { broker, events } = makeBroker(fakeSession({}));
    const p = broker.ensureUnlocked(baseArgs);
    await vi.waitFor(() => expect(events.some((e) => e.type === 'sudo-prompt')).toBe(true));
    broker.resolveSudo(events.find((e) => e.type === 'sudo-prompt')!.promptId as string, null);
    expect(await p).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'sudo-resolved', status: 'cancelled' });
  });

  it('re-prompts with an error on a wrong password, then fails after max attempts', async () => {
    const { broker, events } = makeBroker(fakeSession({ unlock: () => ({ ok: false, error: 'Incorrect password' }) }));
    const p = broker.ensureUnlocked(baseArgs);
    for (let i = 0; i < 3; i++) {
      await vi.waitFor(() => expect(events.filter((e) => e.type === 'sudo-prompt').length).toBe(i + 1));
      const evt = events.filter((e) => e.type === 'sudo-prompt').at(-1)!;
      broker.resolveSudo(evt.promptId as string, 'wrong');
    }
    expect(await p).toBe(false);
    const prompts = events.filter((e) => e.type === 'sudo-prompt');
    expect(prompts.length).toBe(3);
    expect(prompts[1]!.error).toBe('Incorrect password');
    expect(events.at(-1)).toMatchObject({ type: 'sudo-resolved', status: 'failed' });
  });

  it('times out to cancelled when the renderer never replies', async () => {
    const { broker, events } = makeBroker(fakeSession({}));
    expect(await broker.ensureUnlocked(baseArgs)).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'sudo-resolved', status: 'cancelled' });
  });

  it('coalesces concurrent callers into one prompt', async () => {
    const { broker, events } = makeBroker(fakeSession({ unlock: () => ({ ok: true }) }));
    const p1 = broker.ensureUnlocked(baseArgs);
    const p2 = broker.ensureUnlocked({ ...baseArgs, scope: 'scope-2', toolUseId: 'toolu_2' });
    await vi.waitFor(() => expect(events.filter((e) => e.type === 'sudo-prompt').length).toBe(1));
    broker.resolveSudo(events.find((e) => e.type === 'sudo-prompt')!.promptId as string, 'goodpw');
    expect(await p1).toBe(true);
    expect(await p2).toBe(true);
    // Still only the one prompt — the second caller shared the first unlock.
    expect(events.filter((e) => e.type === 'sudo-prompt').length).toBe(1);
  });

  it('a new ensureUnlocked after a cancelled flow prompts again', async () => {
    const { broker, events } = makeBroker(fakeSession({}));
    const p = broker.ensureUnlocked(baseArgs);
    await vi.waitFor(() => expect(events.some((e) => e.type === 'sudo-prompt')).toBe(true));
    broker.resolveSudo(events.find((e) => e.type === 'sudo-prompt')!.promptId as string, null);
    expect(await p).toBe(false);

    const p2 = broker.ensureUnlocked(baseArgs);
    await vi.waitFor(() => expect(events.filter((e) => e.type === 'sudo-prompt').length).toBe(2));
    broker.resolveSudo(events.filter((e) => e.type === 'sudo-prompt').at(-1)!.promptId as string, null);
    expect(await p2).toBe(false);
  });
});
