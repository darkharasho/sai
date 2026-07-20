// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { buildSudoPreToolUseHook, SUDO_DENY_REASON } from '@electron/services/sudo/sudoHook';
import { buildSdkOptions } from '@electron/services/claudeBackend/sdkOptions';
import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';

function preToolUseInput(toolName: string, command?: string) {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: command !== undefined ? { command } : {},
    tool_use_id: 'toolu_x',
    session_id: 's',
    transcript_path: '/t',
    cwd: '/proj',
  } as never;
}

const hookOpts = { signal: new AbortController().signal } as never;

describe('buildSudoPreToolUseHook', () => {
  const deps = () => ({
    projectPath: '/proj',
    scope: 'scope-1',
    ensureUnlocked: vi.fn(async () => true),
  });

  it('passes through non-Bash tools without consulting the broker', async () => {
    const d = deps();
    const hook = buildSudoPreToolUseHook(d);
    expect(await hook(preToolUseInput('Read'), 'toolu_x', hookOpts)).toEqual({});
    expect(d.ensureUnlocked).not.toHaveBeenCalled();
  });

  it('passes through non-sudo and sudo -n Bash commands', async () => {
    const d = deps();
    const hook = buildSudoPreToolUseHook(d);
    expect(await hook(preToolUseInput('Bash', 'ls -la'), 'toolu_x', hookOpts)).toEqual({});
    expect(await hook(preToolUseInput('Bash', 'sudo -n true'), 'toolu_x', hookOpts)).toEqual({});
    expect(d.ensureUnlocked).not.toHaveBeenCalled();
  });

  it('awaits unlock for a sudo command and passes through on success', async () => {
    const d = deps();
    const hook = buildSudoPreToolUseHook(d);
    expect(await hook(preToolUseInput('Bash', 'sudo apt update'), 'toolu_x', hookOpts)).toEqual({});
    expect(d.ensureUnlocked).toHaveBeenCalledWith({
      projectPath: '/proj',
      scope: 'scope-1',
      toolUseId: 'toolu_x',
      command: 'sudo apt update',
    });
  });

  it('denies with the exact reason when elevation is not granted', async () => {
    const d = { ...deps(), ensureUnlocked: vi.fn(async () => false) };
    const hook = buildSudoPreToolUseHook(d);
    const out = await hook(preToolUseInput('Bash', 'sudo rm -rf /tmp/x'), 'toolu_x', hookOpts);
    expect(out).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: SUDO_DENY_REASON,
      },
    });
  });

  it('tolerates a missing command field', async () => {
    const d = deps();
    const hook = buildSudoPreToolUseHook(d);
    expect(await hook(preToolUseInput('Bash'), 'toolu_x', hookOpts)).toEqual({});
    expect(d.ensureUnlocked).not.toHaveBeenCalled();
  });
});

describe('buildSdkOptions PreToolUse wiring', () => {
  const base = { kind: 'chat' as const, cwd: '/proj' };
  const fakeHook: HookCallback = async () => ({});

  it('wires the preToolUseHook under a Bash matcher, alongside Stop', () => {
    const opts = buildSdkOptions({ ...base, stopHook: fakeHook, preToolUseHook: fakeHook });
    expect(opts.hooks?.Stop).toEqual([{ hooks: [fakeHook] }]);
    expect(opts.hooks?.PreToolUse).toEqual([{ matcher: 'Bash', hooks: [fakeHook] }]);
  });

  it('sets PreToolUse without a Stop hook', () => {
    const opts = buildSdkOptions({ ...base, preToolUseHook: fakeHook });
    expect(opts.hooks?.PreToolUse).toEqual([{ matcher: 'Bash', hooks: [fakeHook] }]);
    expect(opts.hooks?.Stop).toBeUndefined();
  });

  it('omits hooks entirely when neither is set', () => {
    const opts = buildSdkOptions(base);
    expect(opts.hooks).toBeUndefined();
  });
});
