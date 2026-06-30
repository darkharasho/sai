import { describe, it, expect } from 'vitest';
import { toMcpSuccessContent, toMcpErrorContent } from '../../../electron/services/mcpToolContent';

describe('mcpToolContent', () => {
  it('wraps a plain result as a single JSON text block', () => {
    const out = toMcpSuccessContent({ ok: true, value: 42 });
    expect(out.isError).toBeUndefined();
    expect(out.content).toEqual([{ type: 'text', text: JSON.stringify({ ok: true, value: 42 }) }]);
  });

  it('splits out __mcpImage into an image block and strips it from the text', () => {
    const out = toMcpSuccessContent({ note: 'hi', __mcpImage: { base64: 'AAA', mimeType: 'image/png' } });
    expect(out.content[0]).toEqual({ type: 'text', text: JSON.stringify({ note: 'hi', __mcpImage: undefined }) });
    expect(out.content[1]).toEqual({ type: 'image', data: 'AAA', mimeType: 'image/png' });
  });

  it('defaults image mimeType to image/png', () => {
    const out = toMcpSuccessContent({ __mcpImage: { base64: 'BBB' } });
    expect(out.content[1]).toEqual({ type: 'image', data: 'BBB', mimeType: 'image/png' });
  });

  it('ignores __mcpImage without a string base64', () => {
    const out = toMcpSuccessContent({ __mcpImage: { mimeType: 'image/png' } });
    expect(out.content).toHaveLength(1);
    expect(out.content[0].type).toBe('text');
  });

  it('wraps an error message with isError', () => {
    expect(toMcpErrorContent('boom')).toEqual({ content: [{ type: 'text', text: 'boom' }], isError: true });
  });
});
