import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock xterm Terminal
function createMockTerminal(lines: string[]) {
  return {
    buffer: {
      active: {
        length: lines.length,
        getLine: (i: number) => ({
          translateToString: () => lines[i] ?? '',
        }),
      },
    },
  };
}

// We need to mock the module internals. Import after mocking.
vi.mock('@xterm/xterm', () => ({}));

import {
  registerTerminal,
  unregisterTerminal,
  setActiveWorkspace,
  getTerminalLastCommand,
} from '../../src/terminalBuffer';

describe('getTerminalLastCommand', () => {
  beforeEach(() => {
    // Clean up any registered terminals
    for (let i = 0; i < 100; i++) unregisterTerminal(i);
    setActiveWorkspace(null);
  });

  it('returns null when no terminals are registered', () => {
    expect(getTerminalLastCommand()).toBeNull();
  });

  it('returns content from last prompt to bottom, skipping idle prompt', () => {
    const lines = [
      'some older output',
      'user@host:~$ npm run dev',
      '> app@1.0.0 dev',
      '> vite',
      '',
      'Error: port 3000 already in use',
      'user@host:~$ ',
    ];
    const term = createMockTerminal(lines);
    registerTerminal(1, term as any, '/test');
    setActiveWorkspace('/test');

    const result = getTerminalLastCommand();
    expect(result).toBe(
      'user@host:~$ npm run dev\n' +
      '> app@1.0.0 dev\n' +
      '> vite\n' +
      '\n' +
      'Error: port 3000 already in use'
    );
  });

  it('returns content from last prompt to bottom when no idle prompt', () => {
    const lines = [
      'some older output',
      '$ npm run dev',
      'Server started on port 3000',
      'GET / 200 OK',
    ];
    const term = createMockTerminal(lines);
    registerTerminal(1, term as any, '/test');
    setActiveWorkspace('/test');

    const result = getTerminalLastCommand();
    expect(result).toBe(
      '$ npm run dev\n' +
      'Server started on port 3000\n' +
      'GET / 200 OK'
    );
  });

  it('returns only the last command when multiple commands exist', () => {
    const lines = [
      '$ git status',
      'On branch main',
      '$ npm test',
      'PASS all tests',
      '$ ',
    ];
    const term = createMockTerminal(lines);
    registerTerminal(1, term as any, '/test');
    setActiveWorkspace('/test');

    const result = getTerminalLastCommand();
    expect(result).toBe(
      '$ npm test\n' +
      'PASS all tests'
    );
  });

  it('falls back to full buffer when no prompt is detected', () => {
    const lines = [
      'some random output',
      'more output',
      'no prompt here',
    ];
    const term = createMockTerminal(lines);
    registerTerminal(1, term as any, '/test');
    setActiveWorkspace('/test');

    const result = getTerminalLastCommand();
    expect(result).toBe(
      'some random output\n' +
      'more output\n' +
      'no prompt here'
    );
  });

  it('handles empty buffer', () => {
    const term = createMockTerminal(['', '', '']);
    registerTerminal(1, term as any, '/test');
    setActiveWorkspace('/test');

    expect(getTerminalLastCommand()).toBeNull();
  });

  it('recognizes various prompt styles', () => {
    const lines = [
      '❯ ls -la',
      'total 42',
      'drwxr-xr-x 5 user user 4096 file.txt',
      '❯ ',
    ];
    const term = createMockTerminal(lines);
    registerTerminal(2, term as any, '/test');
    setActiveWorkspace('/test');

    const result = getTerminalLastCommand();
    expect(result).toBe(
      '❯ ls -la\n' +
      'total 42\n' +
      'drwxr-xr-x 5 user user 4096 file.txt'
    );
  });

  it('recognizes root prompt with #', () => {
    const lines = [
      '# apt update',
      'Hit:1 http://archive.ubuntu.com',
      '# ',
    ];
    const term = createMockTerminal(lines);
    registerTerminal(3, term as any, '/test');
    setActiveWorkspace('/test');

    const result = getTerminalLastCommand();
    expect(result).toBe(
      '# apt update\n' +
      'Hit:1 http://archive.ubuntu.com'
    );
  });

  it('recognizes % prompt (csh/tcsh)', () => {
    const lines = [
      '% make build',
      'Building...',
      'Done.',
      '% ',
    ];
    const term = createMockTerminal(lines);
    registerTerminal(4, term as any, '/test');
    setActiveWorkspace('/test');

    const result = getTerminalLastCommand();
    expect(result).toBe(
      '% make build\n' +
      'Building...\n' +
      'Done.'
    );
  });
});
