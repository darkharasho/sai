import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerChatListener,
  unregisterChatListener,
  hasChatListener,
  takeBufferedMessages,
  reconcileDrainedMessages,
  scopeMessageBuffer,
  _resetChatFrameGate,
} from '../../../src/lib/chatFrameGate';
import type { ChatMessage } from '../../../src/types';

const msg = (id: string, content: string): ChatMessage =>
  ({ id, role: 'assistant', content, timestamp: 1 }) as ChatMessage;

describe('chatFrameGate listener registry', () => {
  beforeEach(() => _resetChatFrameGate());

  it('tracks listeners with counts', () => {
    expect(hasChatListener('s1')).toBe(false);
    registerChatListener('s1');
    registerChatListener('s1');
    expect(hasChatListener('s1')).toBe(true);
    unregisterChatListener('s1');
    expect(hasChatListener('s1')).toBe(true);
    unregisterChatListener('s1');
    expect(hasChatListener('s1')).toBe(false);
  });

  it('takeBufferedMessages removes and returns the scope buffer', () => {
    scopeMessageBuffer.set('s1', [msg('a', 'hi')]);
    expect(takeBufferedMessages('s1')).toHaveLength(1);
    expect(scopeMessageBuffer.has('s1')).toBe(false);
    expect(takeBufferedMessages('s1')).toEqual([]);
  });
});

describe('reconcileDrainedMessages', () => {
  it('appends unknown ids and keeps the longer content for known ids', () => {
    const prev = [msg('a', 'I left out the two Discord-')];
    const drained = [
      msg('a', 'I left out the two Discord-embed CI fixes.'), // grown copy
      msg('b', 'follow-up'),
    ];
    const out = reconcileDrainedMessages(prev, drained);
    expect(out.map(m => m.id)).toEqual(['a', 'b']);
    expect(out[0].content).toBe('I left out the two Discord-embed CI fixes.');
  });

  it('never regresses content to a shorter copy', () => {
    const prev = [msg('a', 'full text already here')];
    const out = reconcileDrainedMessages(prev, [msg('a', 'full')]);
    expect(out[0].content).toBe('full text already here');
  });

  it('strips the transport-internal finalCopy marker on append', () => {
    const d = { ...msg('c', 'reconciled'), finalCopy: true } as ChatMessage & { finalCopy?: boolean };
    const out = reconcileDrainedMessages([], [d]);
    expect((out[0] as ChatMessage & { finalCopy?: boolean }).finalCopy).toBeUndefined();
  });

  it('returns prev untouched for an empty drain', () => {
    const prev = [msg('a', 'x')];
    expect(reconcileDrainedMessages(prev, [])).toBe(prev);
  });
});
