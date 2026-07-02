import { describe, it, expect } from 'vitest';
import { classifyTurnEnd, isSchedulingTool, isBackgroundLaunch } from '@electron/services/waitClassifier';

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

describe('isBackgroundLaunch', () => {
  it('recognizes Bash/Agent/Task with run_in_background true', () => {
    expect(isBackgroundLaunch('Bash', { run_in_background: true })).toBe(true);
    expect(isBackgroundLaunch('Agent', { run_in_background: true })).toBe(true);
    expect(isBackgroundLaunch('Task', { run_in_background: true })).toBe(true);
  });
  it('recognizes Workflow regardless of input (always backgrounded)', () => {
    expect(isBackgroundLaunch('Workflow', {})).toBe(true);
    expect(isBackgroundLaunch('Workflow', undefined)).toBe(true);
  });
  it('rejects foreground runs and other tools', () => {
    expect(isBackgroundLaunch('Bash', {})).toBe(false);
    expect(isBackgroundLaunch('Bash', { run_in_background: false })).toBe(false);
    expect(isBackgroundLaunch('Bash', undefined)).toBe(false);
    expect(isBackgroundLaunch('Read', { run_in_background: true })).toBe(false);
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
  // The CLI reports terminal_reason 'completed' when a turn ends with a
  // background task still running (verified on 2.1.195), so the launch flag
  // is the positive signal that a resume is coming.
  it('classifies completed + background launch as a background wait', () => {
    expect(classifyTurnEnd({ terminalReason: 'completed', sawSchedulingTool: false, sawBackgroundLaunch: true }))
      .toEqual({ kind: 'background', resumeInSeconds: null, taskCount: null });
    expect(classifyTurnEnd({ terminalReason: 'completed', sawSchedulingTool: false, sawBackgroundLaunch: true, taskCount: 3 }).taskCount)
      .toBe(3);
  });
  it('scheduled wait takes priority over a background launch', () => {
    expect(classifyTurnEnd({ terminalReason: 'completed', sawSchedulingTool: true, sawBackgroundLaunch: true, wakeupResumeInSeconds: 60 }).kind)
      .toBe('scheduled');
  });
  it('background launch without completed terminal_reason is a real end', () => {
    expect(classifyTurnEnd({ terminalReason: undefined, sawSchedulingTool: false, sawBackgroundLaunch: true }).kind).toBe('none');
    expect(classifyTurnEnd({ terminalReason: 'max_turns', sawSchedulingTool: false, sawBackgroundLaunch: true }).kind).toBe('none');
  });
});
