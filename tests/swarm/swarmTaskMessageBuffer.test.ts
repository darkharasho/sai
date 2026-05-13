import { describe, it, expect } from 'vitest';
import {
  convertAssistantEnvelope,
  appendAssistantChunk,
  mergePersistedWithBuffer,
} from '../../src/lib/swarmTaskMessageBuffer';
import type { ChatMessage } from '../../src/types';

describe('convertAssistantEnvelope', () => {
  it('returns null for non-assistant messages', () => {
    expect(convertAssistantEnvelope({ type: 'done' })).toBeNull();
    expect(convertAssistantEnvelope(null)).toBeNull();
    expect(convertAssistantEnvelope({ type: 'assistant' })).toBeNull();
  });

  it('extracts text from text blocks', () => {
    const out = convertAssistantEnvelope({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }] },
    });
    expect(out).toEqual({ text: 'hello world', tools: [], isDelta: false });
  });

  it('marks delta when any text block is a delta', () => {
    const out = convertAssistantEnvelope({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'chunk', delta: true }] },
    });
    expect(out?.isDelta).toBe(true);
  });

  it('captures tool_use blocks with classified type', () => {
    const out = convertAssistantEnvelope({
      type: 'assistant',
      message: { content: [
        { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } },
        { type: 'tool_use', id: 'tu2', name: 'Read', input: { file_path: '/x' } },
      ] },
    });
    expect(out?.tools).toHaveLength(2);
    expect(out?.tools[0].type).toBe('terminal_command');
    expect(out?.tools[1].type).toBe('file_read');
    expect(out?.tools[0].input).toContain('"command"');
  });

  it('handles string content', () => {
    const out = convertAssistantEnvelope({ type: 'assistant', message: { content: 'plain' } });
    expect(out).toEqual({ text: 'plain', tools: [], isDelta: false });
  });

  it('returns null when no usable content', () => {
    expect(convertAssistantEnvelope({ type: 'assistant', message: { content: [] } })).toBeNull();
    expect(convertAssistantEnvelope({ type: 'assistant', message: { content: [{ type: 'text', text: '' }] } })).toBeNull();
  });
});

describe('appendAssistantChunk', () => {
  const now = 1000;
  const id = (() => {
    let n = 0;
    return () => `id-${++n}`;
  })();

  it('appends a new assistant message when buffer is empty', () => {
    const out = appendAssistantChunk(
      [],
      { text: 'hi', tools: [], isDelta: false },
      now,
      () => 'id-1',
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'id-1', role: 'assistant', content: 'hi' });
  });

  it('replaces last assistant text bubble when not a delta', () => {
    const buf: ChatMessage[] = [{ id: 'a', role: 'assistant', content: 'old', timestamp: 0 }];
    const out = appendAssistantChunk(buf, { text: 'new', tools: [], isDelta: false }, now, id);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe('new');
  });

  it('appends to last assistant text bubble when delta', () => {
    const buf: ChatMessage[] = [{ id: 'a', role: 'assistant', content: 'old', timestamp: 0 }];
    const out = appendAssistantChunk(buf, { text: ' more', tools: [], isDelta: true }, now, id);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe('old more');
  });

  it('pushes a new message when previous had tool calls', () => {
    const buf: ChatMessage[] = [{
      id: 'a', role: 'assistant', content: '', timestamp: 0,
      toolCalls: [{ type: 'other', name: 'X', input: '' }],
    }];
    const out = appendAssistantChunk(buf, { text: 'reply', tools: [], isDelta: false }, now, () => 'id-2');
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ id: 'id-2', content: 'reply' });
  });

  it('attaches tool calls to a fresh message', () => {
    const buf: ChatMessage[] = [{ id: 'a', role: 'assistant', content: 'text', timestamp: 0 }];
    const out = appendAssistantChunk(
      buf,
      { text: '', tools: [{ type: 'terminal_command', name: 'Bash', input: 'ls' }], isDelta: false },
      now,
      () => 'id-3',
    );
    expect(out).toHaveLength(2);
    expect(out[1].toolCalls).toHaveLength(1);
  });
});

describe('mergePersistedWithBuffer', () => {
  it('appends buffered messages to persisted prefix', () => {
    const existing: ChatMessage[] = [{ id: 'u1', role: 'user', content: 'q', timestamp: 0 }];
    const buf: ChatMessage[] = [{ id: 'a1', role: 'assistant', content: 'r', timestamp: 1 }];
    expect(mergePersistedWithBuffer(existing, buf)).toEqual([...existing, ...buf]);
  });

  it('skips buffered messages whose id is already persisted', () => {
    const existing: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'q', timestamp: 0 },
      { id: 'a1', role: 'assistant', content: 'r', timestamp: 1 },
    ];
    const buf: ChatMessage[] = [
      { id: 'a1', role: 'assistant', content: 'r', timestamp: 1 },
      { id: 'a2', role: 'assistant', content: 'r2', timestamp: 2 },
    ];
    const out = mergePersistedWithBuffer(existing, buf);
    expect(out.map(m => m.id)).toEqual(['u1', 'a1', 'a2']);
  });

  it('returns existing untouched when buffer is empty', () => {
    const existing: ChatMessage[] = [{ id: 'u1', role: 'user', content: 'q', timestamp: 0 }];
    expect(mergePersistedWithBuffer(existing, [])).toBe(existing);
  });
});
