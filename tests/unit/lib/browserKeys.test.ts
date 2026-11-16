/** Key-spec parsing for sai_browser_press: named keys, characters, combos. */
import { describe, it, expect } from 'vitest';
// @ts-expect-error - plain JS module shared with the unpacked extension
import { parseKeySpec } from '../../../extension/chrome/keys.js';

describe('parseKeySpec', () => {
  it('keeps named keys as before', () => {
    expect(parseKeySpec('Enter')).toEqual({ key: 'Enter', code: 'Enter', keyCode: 13, text: '\r', modifiers: 0 });
    expect(parseKeySpec('Tab')).toEqual({ key: 'Tab', code: 'Tab', keyCode: 9, modifiers: 0 });
  });

  it('accepts a single letter', () => {
    expect(parseKeySpec('a')).toEqual({ key: 'a', code: 'KeyA', keyCode: 65, text: 'a', modifiers: 0 });
  });

  it('accepts digits and punctuation', () => {
    expect(parseKeySpec('7')).toMatchObject({ key: '7', code: 'Digit7', keyCode: 55, text: '7' });
    expect(parseKeySpec('/')).toMatchObject({ key: '/', text: '/', modifiers: 0 });
  });

  it('Shift upper-cases a letter', () => {
    expect(parseKeySpec('Shift+a')).toEqual({ key: 'A', code: 'KeyA', keyCode: 65, text: 'A', modifiers: 8 });
  });

  it('Control combos carry the modifier and insert no text', () => {
    const k = parseKeySpec('Ctrl+a');
    expect(k).toMatchObject({ key: 'a', code: 'KeyA', keyCode: 65, modifiers: 2 });
    expect(k.text).toBeUndefined();
  });

  it('combines several modifiers', () => {
    expect(parseKeySpec('Control+Shift+Tab').modifiers).toBe(10);
    expect(parseKeySpec('Cmd+Enter')).toMatchObject({ key: 'Enter', modifiers: 4 });
    expect(parseKeySpec('Option+x').modifiers).toBe(1);
  });

  it('treats a trailing ++ as the plus key', () => {
    expect(parseKeySpec('Control++')).toMatchObject({ key: '+', modifiers: 2 });
    expect(parseKeySpec('+')).toMatchObject({ key: '+', text: '+' });
  });

  it('keeps the space aliases', () => {
    expect(parseKeySpec('Spacebar')).toMatchObject({ code: 'Space', key: ' ' });
    expect(parseKeySpec(' ')).toMatchObject({ code: 'Space' });
  });

  it('rejects unknown keys and modifiers', () => {
    expect(() => parseKeySpec('Foo+x')).toThrow(/unsupported key: Foo\+x/);
    expect(() => parseKeySpec('F13')).toThrow(/unsupported key: F13/);
    expect(() => parseKeySpec('')).toThrow(/unsupported key/);
  });
});
