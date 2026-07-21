// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildCodexInput, buildCodexSdkOptions } from '@electron/services/codexBackend/sdkOptions';
import type { CodexPermission } from '@electron/services/codexBackend/types';

describe('buildCodexSdkOptions', () => {
  it.each([
    ['auto', 'workspace-write', 'on-request'],
    ['read-only', 'read-only', 'never'],
    ['full-access', 'danger-full-access', 'never'],
  ] as const)('maps %s permissions', (permission, sandboxMode, approvalPolicy) => {
    expect(buildCodexSdkOptions({ cwd: '/repo', permission })).toMatchObject({
      thread: { workingDirectory: '/repo', sandboxMode, approvalPolicy },
    });
  });

  it('uses auto permissions when permission is omitted', () => {
    expect(buildCodexSdkOptions({ cwd: '/repo' }).thread).toMatchObject({
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
    });
  });

  it('maps cwd, model, and additional directories exactly', () => {
    const result = buildCodexSdkOptions({
      cwd: '/worktree',
      model: 'gpt-5.3-codex',
      additionalDirectories: ['/shared', '/another'],
    });

    expect(result.thread).toEqual({
      workingDirectory: '/worktree',
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      model: 'gpt-5.3-codex',
      additionalDirectories: ['/shared', '/another'],
    });
  });

  it.each(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const)(
    'maps valid %s effort unchanged',
    (effort) => {
      expect(buildCodexSdkOptions({ cwd: '/repo', effort }).thread.modelReasoningEffort)
        .toBe(effort);
    },
  );

  it('isolates additional directories from later input mutations', () => {
    const directories = ['/shared'];
    const result = buildCodexSdkOptions({ cwd: '/repo', additionalDirectories: directories });

    directories.push('/later');

    expect(result.thread.additionalDirectories).toEqual(['/shared']);
  });

  it('maps meta preamble to developer instructions', () => {
    expect(buildCodexSdkOptions({
      cwd: '/repo',
      metaPreamble: 'Projects live under /meta',
    }).clientConfig).toEqual({ developer_instructions: 'Projects live under /meta' });
  });

  it('returns an empty client config without a meta preamble', () => {
    expect(buildCodexSdkOptions({ cwd: '/repo' }).clientConfig).toEqual({});
    expect(buildCodexSdkOptions({ cwd: '/repo', metaPreamble: '' }).clientConfig).toEqual({});
  });

  it('omits an invalid runtime effort', () => {
    expect(buildCodexSdkOptions({
      cwd: '/repo',
      effort: 'future' as any,
    }).thread).not.toHaveProperty('modelReasoningEffort');
  });

  it('fails closed for an invalid runtime permission', () => {
    expect(buildCodexSdkOptions({
      cwd: '/repo',
      permission: 'unexpected' as unknown as CodexPermission,
    }).thread).toMatchObject({
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
    });
  });
});

describe('buildCodexInput', () => {
  it('returns plain text without images', () => {
    expect(buildCodexInput('hello')).toBe('hello');
    expect(buildCodexInput('hello', [])).toBe('hello');
  });

  it('returns structured text followed by local images in order', () => {
    expect(buildCodexInput('inspect', ['/tmp/a.png', '/tmp/b.png'])).toEqual([
      { type: 'text', text: 'inspect' },
      { type: 'local_image', path: '/tmp/a.png' },
      { type: 'local_image', path: '/tmp/b.png' },
    ]);
  });
});
