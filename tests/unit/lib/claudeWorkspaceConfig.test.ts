import { describe, it, expect } from 'vitest';
import {
  resolveClaudeConfig,
  setWorkspaceOverride,
  sanitizeOverrideMap,
  type ClaudeOverrideMap,
} from '@/lib/claudeWorkspaceConfig';

const globals = { model: 'sonnet', effort: 'high' } as const;

describe('resolveClaudeConfig', () => {
  it('no override → globals, not flagged', () => {
    expect(resolveClaudeConfig({}, '/ws', globals)).toEqual({
      model: 'sonnet', effort: 'high', modelOverridden: false, effortOverridden: false,
    });
  });
  it('full override wins and is flagged', () => {
    const map: ClaudeOverrideMap = { '/ws': { model: 'opus', effort: 'max' } };
    expect(resolveClaudeConfig(map, '/ws', globals)).toEqual({
      model: 'opus', effort: 'max', modelOverridden: true, effortOverridden: true,
    });
  });
  it('partial override resolves field-by-field', () => {
    const map: ClaudeOverrideMap = { '/ws': { effort: 'low' } };
    expect(resolveClaudeConfig(map, '/ws', globals)).toEqual({
      model: 'sonnet', effort: 'low', modelOverridden: false, effortOverridden: true,
    });
  });
  it('other workspaces are unaffected', () => {
    const map: ClaudeOverrideMap = { '/other': { model: 'opus' } };
    expect(resolveClaudeConfig(map, '/ws', globals).model).toBe('sonnet');
  });
});

describe('setWorkspaceOverride', () => {
  it('sets a field immutably', () => {
    const map: ClaudeOverrideMap = {};
    const next = setWorkspaceOverride(map, '/ws', { model: 'opus' });
    expect(next['/ws']).toEqual({ model: 'opus' });
    expect(map).toEqual({});
  });
  it('null clears a field; empty entries are pruned', () => {
    const map: ClaudeOverrideMap = { '/ws': { model: 'opus', effort: 'low' } };
    const a = setWorkspaceOverride(map, '/ws', { model: null });
    expect(a['/ws']).toEqual({ effort: 'low' });
    const b = setWorkspaceOverride(a, '/ws', { effort: null });
    expect(b['/ws']).toBeUndefined();
  });
});

describe('sanitizeOverrideMap', () => {
  const isModel = (v: unknown): v is string => v === 'sonnet' || v === 'opus';
  const isEffort = (v: unknown): v is string => v === 'low' || v === 'high';
  it('drops invalid values and empty entries, keeps valid ones', () => {
    const raw = {
      '/a': { model: 'opus', effort: 'turbo' },
      '/b': { model: 'gpt5' },
      '/c': { effort: 'low' },
      '/d': 'nonsense',
    };
    expect(sanitizeOverrideMap(raw, isModel as any, isEffort as any)).toEqual({
      '/a': { model: 'opus' },
      '/c': { effort: 'low' },
    });
  });
  it('non-object input → empty map', () => {
    expect(sanitizeOverrideMap(null, isModel as any, isEffort as any)).toEqual({});
    expect(sanitizeOverrideMap('x', isModel as any, isEffort as any)).toEqual({});
  });
});
