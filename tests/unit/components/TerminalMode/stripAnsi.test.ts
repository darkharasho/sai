import { describe, it, expect } from 'vitest';
import { stripAnsi } from '../../../../src/components/TerminalMode/stripAnsi';

describe('stripAnsi', () => {
  it('returns plain text unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });

  it('strips color codes', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red');
  });

  it('strips bold/underline codes', () => {
    expect(stripAnsi('\x1b[1mbold\x1b[22m')).toBe('bold');
  });

  it('strips cursor movement codes', () => {
    expect(stripAnsi('\x1b[2Jhello')).toBe('hello');
  });

  it('strips OSC sequences', () => {
    expect(stripAnsi('\x1b]0;title\x07text')).toBe('text');
  });

  it('handles empty string', () => {
    expect(stripAnsi('')).toBe('');
  });

  it('strips multiple sequences in one string', () => {
    expect(stripAnsi('\x1b[32mgreen\x1b[0m \x1b[1mbold\x1b[0m')).toBe('green bold');
  });

  it('strips bracketed paste mode sequences', () => {
    expect(stripAnsi('\x1b[?2004htext\x1b[?2004l')).toBe('text');
  });

  it('strips carriage returns', () => {
    expect(stripAnsi('line1\r\nline2\r\n')).toBe('line1\nline2\n');
  });

  it('strips OSC sequences with ST terminator', () => {
    expect(stripAnsi('\x1b]0;title\x1b\\text')).toBe('text');
  });

  it('preserves exit markers through ANSI stripping', () => {
    expect(stripAnsi('\x1b[?2004l__EXIT:0__\r\n')).toBe('__EXIT:0__\n');
  });
});
