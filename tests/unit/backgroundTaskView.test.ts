import { describe, it, expect } from 'vitest';
import { partitionTasks, nowLine, formatTokens, DONE_HOLD_MS } from '@/components/Chat/backgroundTaskView';
import type { BackgroundTaskDetail } from '../../electron/services/claudeBackend/backgroundTasks';

const task = (over: Partial<BackgroundTaskDetail>): BackgroundTaskDetail => ({
  id: 'a', description: 'd', kind: 'Explore', isShell: false, isAgent: true, status: 'running',
  startedAt: 0, endedAt: null, lastEventAt: 0, totalTokens: null, toolUses: null,
  lastToolName: null, summary: null, error: null, ...over,
});

describe('partitionTasks', () => {
  it('keeps a settling terminal task in running', () => {
    const settling = task({ id: 's', status: 'completed', endedAt: 5 });
    const done = task({ id: 'd', status: 'completed', endedAt: 4 });
    const run = task({ id: 'r' });
    const { running, finished } = partitionTasks([run, settling, done], new Set(['s']));
    expect(running.map((t) => t.id)).toEqual(['r', 's']);
    expect(finished.map((t) => t.id)).toEqual(['d']);
  });
  it('two finish together', () => {
    const a = task({ id: 'a', status: 'completed', endedAt: 10 });
    const b = task({ id: 'b', status: 'failed', endedAt: 11 });
    const mid = partitionTasks([a, b], new Set(['a', 'b']));
    expect(mid.running.map((t) => t.id)).toEqual(['a', 'b']);
    expect(mid.finished).toEqual([]);
    const after = partitionTasks([a, b], new Set());
    expect(after.running).toEqual([]);
    expect(after.finished.map((t) => t.id)).toEqual(['b', 'a']); // endedAt desc
  });
  it('DONE_HOLD_MS keeps the effect under 1s', () => {
    expect(DONE_HOLD_MS).toBe(650);
  });
});

describe('nowLine', () => {
  it('agent summary, tool, starting', () => {
    expect(nowLine(task({ summary: 'Reading files' }), 0)).toBe('Reading files');
    expect(nowLine(task({ lastToolName: 'Grep' }), 0)).toBe('Now: Grep');
    expect(nowLine(task({}), 0)).toBe('Starting…');
  });
  it('shell', () => {
    expect(nowLine(task({ isShell: true, isAgent: false, kind: 'shell' }), 999_999)).toBe('Running');
  });
  it('stuck', () => {
    expect(nowLine(task({ summary: 'x', lastEventAt: 0 }), 125_000)).toBe('No updates for 2m 05s');
  });
  it('finished', () => {
    expect(nowLine(task({ status: 'completed', summary: 'Found 3 bugs' }), 0)).toBe('Found 3 bugs');
    expect(nowLine(task({ status: 'completed' }), 0)).toBe('Completed');
    expect(nowLine(task({ status: 'failed', error: 'boom', summary: 's' }), 0)).toBe('Failed: boom');
    expect(nowLine(task({ status: 'failed', summary: 's' }), 0)).toBe('Failed: s');
    expect(nowLine(task({ status: 'failed' }), 0)).toBe('Failed: unknown error');
    expect(nowLine(task({ status: 'stopped', summary: 'whatever' }), 0)).toBe('Stopped');
  });
});

describe('formatTokens', () => {
  it('formats', () => {
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(18400)).toBe('18.4k');
    expect(formatTokens(1_250_000)).toBe('1.3M');
  });
});
