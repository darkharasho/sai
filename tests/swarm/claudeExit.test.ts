import { describe, it, expect } from 'vitest';
import { exitTerminalEvents } from '../../electron/services/claudeExit';

describe('exitTerminalEvents', () => {
  it('emits nothing when the process was not busy', () => {
    expect(exitTerminalEvents(0, null, false)).toEqual([]);
    expect(exitTerminalEvents(1, 'SIGKILL', false)).toEqual([]);
  });

  it('emits a single done on a clean exit while busy', () => {
    expect(exitTerminalEvents(0, null, true)).toEqual([{ type: 'done' }]);
  });

  it('emits a fatal error then done on a non-zero exit while busy', () => {
    const events = exitTerminalEvents(1, null, true);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'error', fatal: true });
    expect(typeof events[0].text).toBe('string');
    expect(events[1]).toEqual({ type: 'done' });
  });

  it('emits a fatal error then done when killed by a signal while busy', () => {
    const events = exitTerminalEvents(null, 'SIGKILL', true);
    expect(events[0]).toMatchObject({ type: 'error', fatal: true });
    expect(events[1]).toEqual({ type: 'done' });
  });
});
