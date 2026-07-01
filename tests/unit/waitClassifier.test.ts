import { describe, it, expect } from 'vitest';
import { classifyTurnEnd, isSchedulingTool } from '@electron/services/waitClassifier';

describe('isSchedulingTool', () => {
  it('recognizes ScheduleWakeup and CronCreate', () => {
    expect(isSchedulingTool('ScheduleWakeup')).toBe(true);
    expect(isSchedulingTool('CronCreate')).toBe(true);
  });
  it('rejects ordinary tools', () => {
    expect(isSchedulingTool('Bash')).toBe(false);
    expect(isSchedulingTool('CronList')).toBe(false);
  });
});

describe('classifyTurnEnd', () => {
  it('classifies background_requested as a background wait with task count', () => {
    expect(classifyTurnEnd({ terminalReason: 'background_requested', sawSchedulingTool: false, taskCount: 2 }))
      .toEqual({ kind: 'background', resumeInSeconds: null, taskCount: 2 });
  });
  it('classifies completed + scheduling tool as a scheduled wait with delay', () => {
    expect(classifyTurnEnd({ terminalReason: 'completed', sawSchedulingTool: true, wakeupResumeInSeconds: 252 }))
      .toEqual({ kind: 'scheduled', resumeInSeconds: 252, taskCount: null });
  });
  it('scheduled wait with unknown delay carries null resumeInSeconds', () => {
    expect(classifyTurnEnd({ terminalReason: 'completed', sawSchedulingTool: true }))
      .toEqual({ kind: 'scheduled', resumeInSeconds: null, taskCount: null });
  });
  it('completed without a scheduling tool is a real end', () => {
    expect(classifyTurnEnd({ terminalReason: 'completed', sawSchedulingTool: false }).kind).toBe('none');
  });
  it('unknown/absent terminal_reason is a real end even if a scheduling tool fired', () => {
    expect(classifyTurnEnd({ terminalReason: undefined, sawSchedulingTool: true }).kind).toBe('none');
    expect(classifyTurnEnd({ terminalReason: 'max_turns', sawSchedulingTool: true }).kind).toBe('none');
  });
});
