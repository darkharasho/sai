import { describe, it, expect } from 'vitest';
import { inferWindow, type WindowCandidate } from '../../../../electron/capture/inferWindow';

const w = (id: string, title: string): WindowCandidate => ({ id, title });

describe('inferWindow', () => {
  it('always excludes the SAI window', () => {
    const r = inferWindow([w('sai', 'SAI'), w('a', 'MyApp')], { projectNames: ['MyApp'], selfSourceId: 'sai' });
    expect(r).toEqual({ kind: 'pick', window: w('a', 'MyApp') });
  });

  it('matches the explicit target substring case-insensitively', () => {
    const r = inferWindow([w('a', 'Firefox'), w('b', 'MyApp (dev)')], { target: 'myapp', projectNames: [] });
    expect(r).toEqual({ kind: 'pick', window: w('b', 'MyApp (dev)') });
  });

  it('matches the project name when no target given', () => {
    const r = inferWindow([w('a', 'Steam'), w('b', 'Acme — dev')], { projectNames: ['Acme'] });
    expect(r).toEqual({ kind: 'pick', window: w('b', 'Acme — dev') });
  });

  it('returns candidate titles when ambiguous', () => {
    const r = inferWindow([w('a', 'App one'), w('b', 'App two')], { target: 'app', projectNames: [] });
    expect(r).toEqual({ kind: 'candidates', titles: ['App one', 'App two'] });
  });

  it('picks the only remaining non-SAI window when nothing else matches', () => {
    const r = inferWindow([w('sai', 'SAI'), w('a', 'Editor')], { projectNames: ['nomatch'], selfSourceId: 'sai' });
    expect(r).toEqual({ kind: 'pick', window: w('a', 'Editor') });
  });

  it('returns none when only SAI is present', () => {
    const r = inferWindow([w('sai', 'SAI')], { projectNames: [], selfSourceId: 'sai' });
    expect(r).toEqual({ kind: 'none' });
  });
});
