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

describe('SudoBroker.getPendingPrompt', () => {
  it('is null initially, reflects the outstanding prompt while awaiting a reply, and clears once resolved', async () => {
    const { broker, events } = makeBroker(fakeSession({ unlock: () => ({ ok: true }) }));
    expect(broker.getPendingPrompt()).toBeNull();

    const p = broker.ensureUnlocked(baseArgs);
    await vi.waitFor(() => expect(events.some((e) => e.type === 'sudo-prompt')).toBe(true));
    const evt = events.find((e) => e.type === 'sudo-prompt')!;
    expect(broker.getPendingPrompt()).toMatchObject({ projectPath: '/proj', scope: 'scope-1', command: 'sudo apt update' });
    expect(broker.getPendingPrompt()!.promptId).toBe(evt.promptId);

    broker.resolveSudo(evt.promptId as string, null);
    await p;
    expect(broker.getPendingPrompt()).toBeNull();
  });

  it('overwrites with the second promptId and error on a wrong-password retry', async () => {
    const { broker, events } = makeBroker(fakeSession({ unlock: () => ({ ok: false, error: 'Incorrect password' }) }));
    const p = broker.ensureUnlocked(baseArgs);

    await vi.waitFor(() => expect(events.filter((e) => e.type === 'sudo-prompt').length).toBe(1));
    const firstEvt = events.filter((e) => e.type === 'sudo-prompt')[0]!;
    broker.resolveSudo(firstEvt.promptId as string, 'wrong');

    await vi.waitFor(() => expect(events.filter((e) => e.type === 'sudo-prompt').length).toBe(2));
    const secondEvt = events.filter((e) => e.type === 'sudo-prompt')[1]!;
    expect(broker.getPendingPrompt()!.promptId).toBe(secondEvt.promptId);
    expect(broker.getPendingPrompt()!.promptId).not.toBe(firstEvt.promptId);
    expect(broker.getPendingPrompt()!.error).toBe('Incorrect password');

    // Drive the remaining attempt to completion so the flow settles cleanly.
    broker.resolveSudo(secondEvt.promptId as string, 'wrong');
    await vi.waitFor(() => expect(events.filter((e) => e.type === 'sudo-prompt').length).toBe(3));
    const thirdEvt = events.filter((e) => e.type === 'sudo-prompt')[2]!;
    broker.resolveSudo(thirdEvt.promptId as string, 'wrong');
    expect(await p).toBe(false);
    expect(broker.getPendingPrompt()).toBeNull();
  });
});
