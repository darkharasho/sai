import { describe, it, expect } from 'vitest';
import { effectiveChatSettings, settingsSeed } from '../../../src/lib/chat/composerSettings';

const defaults = { provider: 'claude' as const, model: 'sonnet', permMode: 'default', effort: 'high' };

describe('composer settings', () => {
  it("shows the chat's own values, filling gaps from the workspace defaults", () => {
    expect(effectiveChatSettings({ provider: 'claude', model: 'opus' }, defaults)).toEqual({ ...defaults, model: 'opus' });
    expect(effectiveChatSettings(null, defaults)).toEqual(defaults);
    // Another provider's settings never leak into this provider's pickers.
    expect(effectiveChatSettings({ provider: 'codex', model: 'gpt-5', permMode: 'read-only' }, defaults)).toEqual(defaults);
  });

  it('seeds everything for a new or other-provider chat, only the gaps otherwise', () => {
    expect(settingsSeed(null, defaults)).toEqual(defaults);
    expect(settingsSeed({ provider: 'codex', model: 'gpt-5' }, defaults)).toEqual(defaults);
    expect(settingsSeed({ provider: 'claude', model: 'opus' }, defaults)).toEqual({ provider: 'claude', permMode: 'default', effort: 'high' });
    expect(settingsSeed({ provider: 'claude', model: 'opus', permMode: 'bypass', effort: 'max' }, defaults)).toBeNull();
  });
});
