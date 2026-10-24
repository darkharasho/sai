// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  formatScopeTag,
  parseScopeTag,
  withScopeTag,
  stripInheritedScopeTag,
  SCOPE_ENV,
} from '../../../../electron/services/loadGuard/scopeTag';

describe('scopeTag', () => {
  it('round-trips a tag whose projectPath contains |', () => {
    const t = { instance: 42, provider: 'codex' as const, projectPath: '/a|b/c', scope: 'sess|1' };
    expect(parseScopeTag(formatScopeTag(t))).toEqual(t);
  });

  it('rejects garbage and unknown versions', () => {
    expect(parseScopeTag('nope')).toBeNull();
    expect(parseScopeTag('v9|1|claude|x|/p')).toBeNull();
    expect(parseScopeTag('v1|1|bogus|x|/p')).toBeNull();
  });

  it('withScopeTag stamps this instance pid and does not mutate input', () => {
    const env = { PATH: '/bin' };
    const out = withScopeTag(env, { provider: 'claude', projectPath: '/p', scope: 'chat' });
    expect(parseScopeTag(out.SAI_LOAD_SCOPE!)!.instance).toBe(process.pid);
    expect(out.PATH).toBe('/bin');
    expect(env).toEqual({ PATH: '/bin' });
  });

  it('stripInheritedScopeTag removes an inherited tag only', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/bin', [SCOPE_ENV]: 'v1|7|claude|chat|/p' };
    stripInheritedScopeTag(env);
    expect(env).toEqual({ PATH: '/bin' });
  });
});
