import { describe, it, expect } from 'vitest';
import { classifyTurnEnd, isSchedulingTool, isBackgroundLaunch, isAsyncLaunchResult } from '@electron/services/waitClassifier';

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

  // Runtime-reported in-flight tasks (Stop hook background_tasks) are the
  // authoritative wait signal: they cover launches the input sniff misses
  // (the runtime can async-launch an Agent with no run_in_background flag)
  // and resume turns that launch nothing while earlier tasks still run.
  it('classifies completed + in-flight task count as a background wait even without a launch this turn', () => {
    expect(classifyTurnEnd({ terminalReason: 'completed', sawSchedulingTool: false, sawBackgroundLaunch: false, taskCount: 1 }))
      .toEqual({ kind: 'background', resumeInSeconds: null, taskCount: 1 });
  });
  it('classifies absent terminal_reason + in-flight task count as a background wait (count is authoritative)', () => {
    expect(classifyTurnEnd({ terminalReason: undefined, sawSchedulingTool: false, taskCount: 2 }).kind).toBe('background');
  });
  it('zero/null task count without launches is a real end', () => {
    expect(classifyTurnEnd({ terminalReason: 'completed', sawSchedulingTool: false, taskCount: 0 }).kind).toBe('none');
    expect(classifyTurnEnd({ terminalReason: 'completed', sawSchedulingTool: false, taskCount: null }).kind).toBe('none');
  });
  it('an authoritative zero overrides the launch sniff (the launched task already finished)', () => {
    expect(classifyTurnEnd({ terminalReason: 'completed', sawSchedulingTool: false, sawBackgroundLaunch: true, taskCount: 0 }).kind).toBe('none');
    expect(classifyTurnEnd({ terminalReason: 'completed', sawSchedulingTool: false, sawAsyncLaunchResult: true, taskCount: 0 }).kind).toBe('none');
  });
  it('async-launch tool_result sniff classifies background when no ledger exists', () => {
    expect(classifyTurnEnd({ terminalReason: 'completed', sawSchedulingTool: false, sawAsyncLaunchResult: true }))
      .toEqual({ kind: 'background', resumeInSeconds: null, taskCount: null });
  });
  it('aborted/error terminal reasons stay a real end even with in-flight tasks', () => {
    expect(classifyTurnEnd({ terminalReason: 'aborted_streaming', sawSchedulingTool: false, taskCount: 1 }).kind).toBe('none');
    expect(classifyTurnEnd({ terminalReason: 'max_turns', sawSchedulingTool: false, taskCount: 1 }).kind).toBe('none');
  });
});

describe('isAsyncLaunchResult', () => {
  // Real transcript shape (2026-07-05): Agent tool_use with NO run_in_background
  // flag came back "Async agent launched successfully." — the runtime decided to
  // background it, so the tool_result is the only launch signal.
  const asyncText = 'Async agent launched successfully.\nagentId: afdba032ce2118862 (internal ID...)\nThe agent is working in the background.';
  it('recognizes the async-launch tool_result as string content', () => {
    expect(isAsyncLaunchResult(asyncText)).toBe(true);
  });
  it('recognizes the async-launch tool_result as block-array content', () => {
    expect(isAsyncLaunchResult([{ type: 'text', text: asyncText }])).toBe(true);
  });
  it('recognizes a backgrounded Bash tool_result (runtime 2.1.195 wording)', () => {
    expect(isAsyncLaunchResult('Command running in background with ID: bash_1. Output is being written to: /tmp/x.out. You will be notified when it completes.')).toBe(true);
  });
  it('rejects ordinary tool_results', () => {
    expect(isAsyncLaunchResult('ok, 3 files changed')).toBe(false);
    expect(isAsyncLaunchResult([{ type: 'text', text: 'done' }])).toBe(false);
    expect(isAsyncLaunchResult(undefined)).toBe(false);
    expect(isAsyncLaunchResult(null)).toBe(false);
  });
});
