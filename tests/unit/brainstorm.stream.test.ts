import { describe, it, expect, vi } from 'vitest';
import { processStreamLine } from '../../electron/services/brainstorm';

describe('processStreamLine', () => {
  it('captures session_id from system init', () => {
    const onChunk = vi.fn();
    const out = { fullText: '', sessionId: undefined as string | undefined };
    processStreamLine(
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-1' }),
      out, onChunk,
    );
    expect(out.sessionId).toBe('sess-1');
    expect(onChunk).not.toHaveBeenCalled();
  });

  it('appends assistant text deltas and notifies onChunk', () => {
    const onChunk = vi.fn();
    const out = { fullText: '', sessionId: undefined as string | undefined };
    processStreamLine(
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } }),
      out, onChunk,
    );
    processStreamLine(
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: ' world' }] } }),
      out, onChunk,
    );
    expect(out.fullText).toBe('Hello world');
    expect(onChunk).toHaveBeenNthCalledWith(1, 'Hello');
    expect(onChunk).toHaveBeenNthCalledWith(2, ' world');
  });

  it('ignores unknown line types', () => {
    const onChunk = vi.fn();
    const out = { fullText: '', sessionId: undefined as string | undefined };
    processStreamLine(JSON.stringify({ type: 'something-else' }), out, onChunk);
    expect(out.fullText).toBe('');
    expect(onChunk).not.toHaveBeenCalled();
  });

  it('silently skips malformed JSON', () => {
    const onChunk = vi.fn();
    const out = { fullText: '', sessionId: undefined as string | undefined };
    expect(() => processStreamLine('not json', out, onChunk)).not.toThrow();
    expect(out.fullText).toBe('');
  });
});
