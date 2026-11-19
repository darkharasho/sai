import { describe, it, expect } from 'vitest';
import { capClaudePermMode, capCodexPermission, capAcpApprovalMode, capSettings } from '../../../electron/services/chatlog/remoteCap';

describe('capClaudePermMode', () => {
  it.each([
    ['bypass', null, 'bypass'],
    ['bypass', 'auto', 'bypass'],
    ['bypass', 'auto-read', 'default'],
    ['bypass', 'always-ask', 'default'],
    ['default', 'always-ask', 'default'],
    ['default', 'auto', 'default'],
    [undefined, 'always-ask', undefined],
  ] as const)('%s under %s → %s', (mode, ceiling, want) => {
    expect(capClaudePermMode(mode, ceiling)).toBe(want);
  });
});

describe('capCodexPermission', () => {
  it.each([
    ['full-access', null, 'full-access'],
    ['full-access', 'auto', 'auto'],
    ['full-access', 'auto-read', 'read-only'],
    ['full-access', 'always-ask', 'read-only'],
    ['auto', 'auto', 'auto'],
    ['auto', 'auto-read', 'read-only'],
    ['auto', 'always-ask', 'read-only'],
    ['read-only', 'auto', 'read-only'],
    ['read-only', 'auto-read', 'read-only'],
    ['read-only', 'always-ask', 'read-only'],
    [undefined, 'auto', undefined],
    [undefined, 'always-ask', 'read-only'],
  ] as const)('%s under %s → %s', (mode, ceiling, want) => {
    expect(capCodexPermission(mode, ceiling)).toBe(want);
  });
});

describe('capAcpApprovalMode', () => {
  it.each([
    ['yolo', null, 'default', 'yolo'],
    ['yolo', 'auto', 'default', 'auto_edit'],
    ['auto_edit', 'auto', 'default', 'auto_edit'],
    ['yolo', 'auto-read', 'default', 'default'],
    ['auto_edit', 'always-ask', 'default', 'default'],
    ['default', 'always-ask', 'default', 'default'],
    ['plan', 'auto', 'default', 'plan'],
    ['plan', 'always-ask', 'default', 'plan'],
    // Kimi runs undefined as auto_edit: a stricter ceiling makes it explicit.
    [undefined, 'always-ask', 'auto_edit', 'default'],
    [undefined, 'auto', 'auto_edit', undefined],
    [undefined, 'always-ask', 'default', undefined],
  ] as const)('%s under %s (unset=%s) → %s', (mode, ceiling, unsetAs, want) => {
    expect(capAcpApprovalMode(mode, ceiling, unsetAs)).toBe(want);
  });
});

describe('capSettings', () => {
  it('caps only the provider\'s own permission field and never raises', () => {
    expect(capSettings({ permMode: 'bypass', model: 'm' }, 'claude', 'always-ask')).toEqual({ permMode: 'default', model: 'm' });
    expect(capSettings({ permMode: 'read-only' }, 'codex', 'auto')).toEqual({ permMode: 'read-only' });
    expect(capSettings({}, 'codex', 'auto-read')).toEqual({ permMode: 'read-only' });
    expect(capSettings({ approvalMode: 'yolo' }, 'gemini', 'auto')).toEqual({ approvalMode: 'auto_edit' });
    expect(capSettings({ model: 'k' }, 'kimi', 'always-ask')).toEqual({ model: 'k', approvalMode: 'default' });
    expect(capSettings({ permMode: 'bypass' }, 'claude', null)).toEqual({ permMode: 'bypass' });
  });
});
