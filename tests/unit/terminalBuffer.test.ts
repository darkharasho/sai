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
  getTerminalContent,
  setActiveTerminalId,
  getActiveTerminalId,
  updateTerminalName,
  getTerminalById,
  getTerminalByName,
  getTerminalByIndex,
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

describe('active terminal tracking', () => {
  beforeEach(() => {
    for (let i = 0; i < 100; i++) unregisterTerminal(i);
    setActiveWorkspace(null);
  });

  it('setActiveTerminalId and getActiveTerminalId round-trip', () => {
    registerTerminal(10, createMockTerminal(['line1']) as any, '/proj');
    setActiveWorkspace('/proj');
    setActiveTerminalId('/proj', 10);
    expect(getActiveTerminalId()).toBe(10);
  });

  it('getActiveTerminalId returns null when no terminals registered', () => {
    setActiveWorkspace('/proj');
    expect(getActiveTerminalId()).toBeNull();
  });

  it('getTerminalContent uses explicitly set active terminal, not just last registered', () => {
    const term10 = createMockTerminal(['terminal ten output']);
    const term20 = createMockTerminal(['terminal twenty output']);
    registerTerminal(10, term10 as any, '/proj');
    registerTerminal(20, term20 as any, '/proj');
    setActiveWorkspace('/proj');

    // Set terminal 10 as explicitly active
    setActiveTerminalId('/proj', 10);

    const content = getTerminalContent();
    expect(content).toBe('terminal ten output');
  });

  it('unregisterTerminal cleans up active terminal tracking', () => {
    const term10 = createMockTerminal(['output']);
    registerTerminal(10, term10 as any, '/proj');
    setActiveWorkspace('/proj');
    setActiveTerminalId('/proj', 10);
    expect(getActiveTerminalId()).toBe(10);

    unregisterTerminal(10);
    // After unregistering, the active terminal ID for workspace should be cleared
    expect(getActiveTerminalId()).toBeNull();
  });

  it('unregisterTerminal cleans up terminal name', () => {
    const term10 = createMockTerminal(['output']);
    registerTerminal(10, term10 as any, '/proj');
    updateTerminalName(10, 'my-server');
    unregisterTerminal(10);
    expect(getTerminalByName('my-server', '/proj')).toBeNull();
  });
});

describe('getTerminalById', () => {
  beforeEach(() => {
    for (let i = 0; i < 100; i++) unregisterTerminal(i);
    setActiveWorkspace(null);
  });

  it('returns buffer content for a known terminal ID', () => {
    const term = createMockTerminal(['hello from id 5']);
    registerTerminal(5, term as any, '/proj');
    expect(getTerminalById(5)).toBe('hello from id 5');
  });

  it('returns null for an unknown terminal ID', () => {
    expect(getTerminalById(999)).toBeNull();
  });

  it('respects maxLines parameter', () => {
    const lines = ['line1', 'line2', 'line3', 'line4', 'line5'];
    const term = createMockTerminal(lines);
    registerTerminal(5, term as any, '/proj');
    const content = getTerminalById(5, 3);
    expect(content).toBe('line3\nline4\nline5');
  });
});

describe('getTerminalByName', () => {
  beforeEach(() => {
    for (let i = 0; i < 100; i++) unregisterTerminal(i);
    setActiveWorkspace(null);
  });

  it('returns content when name matches', () => {
    const term = createMockTerminal(['named terminal output']);
    registerTerminal(7, term as any, '/proj');
    updateTerminalName(7, 'my-app');
    expect(getTerminalByName('my-app', '/proj')).toBe('named terminal output');
  });

  it('returns null when no terminal has that name', () => {
    expect(getTerminalByName('nonexistent', '/proj')).toBeNull();
  });

  it('returns null when name matches but workspace does not', () => {
    const term = createMockTerminal(['output']);
    registerTerminal(7, term as any, '/proj-a');
    updateTerminalName(7, 'my-app');
    expect(getTerminalByName('my-app', '/proj-b')).toBeNull();
  });

  it('updateTerminalName with null clears the name', () => {
    const term = createMockTerminal(['output']);
    registerTerminal(7, term as any, '/proj');
    updateTerminalName(7, 'my-app');
    updateTerminalName(7, null);
    expect(getTerminalByName('my-app', '/proj')).toBeNull();
  });
});

describe('getTerminalByIndex', () => {
  beforeEach(() => {
    for (let i = 0; i < 100; i++) unregisterTerminal(i);
    setActiveWorkspace(null);
  });

  it('returns content at 1-based index from orderedIds', () => {
    const termA = createMockTerminal(['terminal A']);
    const termB = createMockTerminal(['terminal B']);
    const termC = createMockTerminal(['terminal C']);
    registerTerminal(10, termA as any, '/proj');
    registerTerminal(20, termB as any, '/proj');
    registerTerminal(30, termC as any, '/proj');

    expect(getTerminalByIndex(1, [10, 20, 30])).toBe('terminal A');
    expect(getTerminalByIndex(2, [10, 20, 30])).toBe('terminal B');
    expect(getTerminalByIndex(3, [10, 20, 30])).toBe('terminal C');
  });

  it('returns null for out-of-range index', () => {
    const term = createMockTerminal(['output']);
    registerTerminal(10, term as any, '/proj');
    expect(getTerminalByIndex(0, [10])).toBeNull();
    expect(getTerminalByIndex(2, [10])).toBeNull();
  });

  it('returns null for empty orderedIds', () => {
    expect(getTerminalByIndex(1, [])).toBeNull();
  });

  it('returns null when ID at index is not registered', () => {
    expect(getTerminalByIndex(1, [999])).toBeNull();
  });

  it('respects maxLines parameter', () => {
    const lines = ['a', 'b', 'c', 'd'];
    const term = createMockTerminal(lines);
    registerTerminal(10, term as any, '/proj');
    expect(getTerminalByIndex(1, [10], 2)).toBe('c\nd');
  });
});
