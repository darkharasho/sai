import { describe, it, expect, vi } from 'vitest';

vi.mock('../../electron/services/claude', () => ({ spawnEnv: () => ({}) }));
vi.mock('../../electron/services/devlog', () => ({ devlog: vi.fn(), devlogSnip: (t: unknown) => String(t) }));

import {
  buildJudgePrompt, parseJudgeVerdict, judgeFollowUp, FOLLOWUP_JUDGE_MAX_CHARS,
} from '../../electron/services/followupJudge';

describe('buildJudgePrompt', () => {
  it('keeps only the last MAX_CHARS chars', () => {
    const p = buildJudgePrompt('x'.repeat(5000) + 'END');
    expect(p).toContain('END');
    expect(p).not.toContain('x'.repeat(5000));
    expect(p).toContain('x'.repeat(FOLLOWUP_JUDGE_MAX_CHARS - 3));
  });
});

describe('parseJudgeVerdict', () => {
  it('parses plain JSON', () => {
    expect(parseJudgeVerdict('{"followUp":true,"waitingFor":"CI for PR #42"}'))
      .toEqual({ followUp: true, waitingFor: 'CI for PR #42' });
  });
  it('tolerates fences and prose', () => {
    expect(parseJudgeVerdict('Here you go:\n```json\n{"followUp":false,"waitingFor":null}\n```'))
      .toEqual({ followUp: false, waitingFor: null });
  });
  it('truncates waitingFor to 8 words and nulls empty', () => {
    expect(parseJudgeVerdict('{"followUp":true,"waitingFor":"a b c d e f g h i j"}')?.waitingFor).toBe('a b c d e f g h');
    expect(parseJudgeVerdict('{"followUp":true,"waitingFor":""}')?.waitingFor).toBeNull();
  });
  it('returns null for junk', () => {
    expect(parseJudgeVerdict('sure!')).toBeNull();
    expect(parseJudgeVerdict('{"waitingFor":"x"}')).toBeNull();
    expect(parseJudgeVerdict('{"followUp":"yes"}')).toBeNull();
  });
});

describe('judgeFollowUp', () => {
  it('times out to null and aborts the runner', async () => {
    let sig: AbortSignal | undefined;
    const r = await judgeFollowUp('hello', (_p, s) => { sig = s; return new Promise<string>(() => {}); }, 20);
    expect(r).toBeNull();
    expect(sig?.aborted).toBe(true);
  });
  it('returns null when the runner rejects', async () => {
    expect(await judgeFollowUp('hello', async () => { throw new Error('boom'); })).toBeNull();
  });
  it('returns null without calling runner on empty text', async () => {
    const run = vi.fn();
    expect(await judgeFollowUp('', run)).toBeNull();
    expect(await judgeFollowUp('  \n', run)).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
  it('returns the parsed verdict', async () => {
    expect(await judgeFollowUp('hi', async () => '{"followUp":true,"waitingFor":"CI"}'))
      .toEqual({ followUp: true, waitingFor: 'CI' });
  });
});
