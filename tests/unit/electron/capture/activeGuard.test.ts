import { describe, it, expect } from 'vitest';
import { titleMatch, activeWindowIsTarget } from '../../../../electron/capture/activeGuard';

describe('titleMatch', () => {
  it('matches case-insensitively in either direction', () => {
    expect(titleMatch('MyApp (dev)', 'myapp')).toBe(true);
    expect(titleMatch('myapp', 'MyApp (dev)')).toBe(true);
    expect(titleMatch('Firefox', 'MyApp')).toBe(false);
  });
  it('treats empty strings as no match', () => {
    expect(titleMatch('', 'x')).toBe(false);
    expect(titleMatch('x', '')).toBe(false);
  });
});

describe('activeWindowIsTarget', () => {
  it('false when the active window is unknown', () => {
    expect(activeWindowIsTarget(null, 'MyApp', 'SAI')).toBe(false);
  });
  it('false when the active window is SAI (never capture SAI)', () => {
    expect(activeWindowIsTarget('SAI', 'MyApp', 'SAI')).toBe(false);
  });
  it('true when the active window is the intended target and not SAI', () => {
    expect(activeWindowIsTarget('MyApp (dev)', 'MyApp', 'SAI')).toBe(true);
  });
  it('false when the active window is some other app', () => {
    expect(activeWindowIsTarget('Spotify', 'MyApp', 'SAI')).toBe(false);
  });
});
