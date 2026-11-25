import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CanvasToolCard, summarizeCanvasCall } from '../../../../src/components/Chat/CanvasToolCard';
import { renderToolCallFor } from '../../../../src/components/Chat/renderToolCallFor';
import type { ToolCall } from '../../../../src/types';

const tc = (input: object, output?: string): ToolCall => ({
  type: 'mcp', name: 'mcp__sai__sai_canvas', input: JSON.stringify(input), output,
});
const MD = '# Shop mod test\n\n- [x] one\n- [!] two\n- [ ] three\n';

describe('summarizeCanvasCall', () => {
  it('write: title from the content heading, checklist progress, Created vs Updated', () => {
    const s = summarizeCanvasCall(tc({ action: 'write', name: 'shop', content: MD }, JSON.stringify({ ok: true, created: true })));
    expect(s).toMatchObject({ verb: 'Created', name: 'shop', title: 'Shop mod test', progress: '1 of 3 · 1 failed', error: null, running: false });
    expect(summarizeCanvasCall(tc({ action: 'write', name: 'shop', content: MD }, '{"ok":true,"created":false}')).verb).toBe('Updated');
  });

  it('running call: present-tense verb, no error', () => {
    expect(summarizeCanvasCall(tc({ action: 'write', name: 'shop', content: MD }))).toMatchObject({ verb: 'Writing', running: true, error: null });
  });

  it('errors: {ok:false}, MCP-wrapped text, plain thrown text; truncated success is not an error', () => {
    expect(summarizeCanvasCall(tc({ action: 'open', name: 'x' }, '{"ok":false,"error":"no canvas named \\"x\\""}')).error).toBe('no canvas named "x"');
    expect(summarizeCanvasCall(tc({ action: 'open', name: 'x' }, JSON.stringify([{ type: 'text', text: 'Error: no canvas named "x"' }]))).error).toBe('no canvas named "x"');
    expect(summarizeCanvasCall(tc({ action: 'open', name: 'x' }, 'no canvas named "x"')).error).toBe('no canvas named "x"');
    expect(summarizeCanvasCall(tc({ action: 'read', name: 'x' }, '{"ok":true,"content":"# Tru')).error).toBeNull();
  });

  it('read takes the title from the returned content; list counts canvases', () => {
    expect(summarizeCanvasCall(tc({ action: 'read', name: 'shop' }, JSON.stringify({ ok: true, content: MD }))).title).toBe('Shop mod test');
    expect(summarizeCanvasCall(tc({ action: 'list' }, JSON.stringify({ ok: true, canvases: [{}, {}] }))).progress).toBe('2 canvases');
  });
});

describe('CanvasToolCard', () => {
  it('clicking shows the canvas by name; not clickable without a handler or on error', () => {
    const open = vi.fn();
    const { unmount } = render(<CanvasToolCard tc={tc({ action: 'write', name: 'shop', content: MD }, '{"ok":true}')} onOpenCanvas={open} />);
    fireEvent.click(screen.getByRole('button'));
    expect(open).toHaveBeenCalledWith('shop');
    expect(screen.getByTestId('canvas-toolcard').textContent).not.toContain('- [x]');
    unmount();
    render(<CanvasToolCard tc={tc({ action: 'open', name: 'x' }, '{"ok":false,"error":"nope"}')} onOpenCanvas={open} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('nope')).toBeTruthy();
  });

  it('renderToolCallFor routes sai_canvas calls to the compact card', () => {
    const open = vi.fn();
    const node = renderToolCallFor('/p', vi.fn(), open)(tc({ action: 'open', name: 'shop' }, '{"ok":true}'), false);
    render(<>{node}</>);
    fireEvent.click(screen.getByTestId('canvas-toolcard'));
    expect(open).toHaveBeenCalledWith('shop');
  });
});
