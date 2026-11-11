import { describe, it, expect } from 'vitest';
import { buildTailLines } from '../../../../../src/components/Chat/tasks/tailLines';
import type { ChatMessage } from '../../../../../src/types';

const tool = (name: string, input: object, output?: string) => ({
  type: 'other' as const, name, input: JSON.stringify(input), output,
});
const msg = (...toolCalls: any[]): ChatMessage => ({ id: 'm', role: 'assistant', content: '', timestamp: 0, toolCalls });

describe('buildTailLines', () => {
  it('formats bash, read, edit and search lines', () => {
    const lines = buildTailLines([msg(
      tool('Bash', { command: 'vitest run\nsecond' }, 'x'),
      tool('Read', { file_path: '/src/lib/imageStore.ts' }, 'x'),
      tool('Edit', { file_path: '/x/a.ts' }, 'x'),
      tool('Grep', { pattern: 'foo' }, 'x'),
    )]);
    expect(lines.map(l => l.text)).toEqual(['$ vitest run', 'read imageStore.ts', 'edit a.ts', 'search foo']);
  });

  it('marks errored tool as error and pending last tool as live', () => {
    const lines = buildTailLines([msg(
      tool('Bash', { command: 'a' }, 'Error: boom'),
      tool('Read', { file_path: '/a/b' }, 'fine <tool_use_error>x'),
      tool('mcp__x__do_thing', {}),
    )]);
    expect(lines.map(l => l.tone)).toEqual(['error', 'error', 'live']);
    expect(lines[2].text).toBe('do_thing');
  });

  it('keeps only the last max lines', () => {
    const tools = [1, 2, 3, 4, 5, 6].map(n => tool('Bash', { command: `c${n}` }, 'ok'));
    const lines = buildTailLines([msg(...tools)], 4);
    expect(lines.map(l => l.text)).toEqual(['$ c3', '$ c4', '$ c5', '$ c6']);
  });

  it('uses the first line of assistant text, cut to 80 chars', () => {
    const lines = buildTailLines([{ id: 'm', role: 'assistant', content: 'x'.repeat(100) + '\nmore', timestamp: 0 }]);
    expect(lines[0].text).toHaveLength(80);
  });
});
