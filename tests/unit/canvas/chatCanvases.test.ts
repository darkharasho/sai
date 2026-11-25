import { describe, it, expect } from 'vitest';
import { deriveChatCanvases, deriveChatCanvasTouches } from '../../../src/canvas/chatCanvases';
import type { ChatMessage, ToolCall } from '../../../src/types';

const P = '/var/home/u/proj';
const tc = (name: string, input: unknown, type: ToolCall['type'] = 'mcp'): ToolCall =>
  ({ name, type, input: typeof input === 'string' ? input : JSON.stringify(input) });
const asst = (id: string, toolCalls: ToolCall[], timestamp = 1): ChatMessage =>
  ({ id, role: 'assistant', content: '', timestamp, toolCalls });

describe('deriveChatCanvases', () => {
  it('collects sai_canvas write/open calls in first-touch order, deduped, as canvasKey paths', () => {
    const msgs = [
      asst('a', [tc('mcp__sai__sai_canvas', { action: 'write', name: 'plan', content: 'x' })]),
      asst('b', [
        tc('mcp__sai__sai_canvas', { action: 'read', name: 'other' }),
        tc('mcp__sai__sai_canvas', { action: 'write', name: 'steps.md', content: 'y' }),
        tc('mcp__sai__sai_canvas', { action: 'open', name: 'plan' }),
      ]),
    ];
    expect(deriveChatCanvases(msgs, P)).toEqual(['/home/u/proj/.sai/canvas/plan.md', '/home/u/proj/.sai/canvas/steps.md']);
  });

  it('accepts the codex/socket spelling of the tool name', () => {
    const msgs = [asst('a', [tc('sai_canvas', { action: 'write', name: 'x', content: '' })])];
    expect(deriveChatCanvases(msgs, P)).toEqual(['/home/u/proj/.sai/canvas/x.md']);
  });

  it('picks up plain file writes and edits of project canvases (providers without the tool)', () => {
    const msgs = [
      asst('a', [
        tc('Write', { file_path: '/home/u/proj/.sai/canvas/w.md', content: 'x' }, 'file_edit'),
        tc('Edit', { file_path: `${P}/.sai/canvas/e.md`, old_string: 'a', new_string: 'b' }, 'file_edit'),
        tc('write_file', { path: '.sai/canvas/rel.md', content: 'x' }, 'file_edit'),
        tc('Read', { file_path: `${P}/.sai/canvas/r.md` }, 'file_read'),
        tc('Write', { file_path: '/elsewhere/.sai/canvas/no.md', content: 'x' }, 'file_edit'),
        tc('Write', { file_path: `${P}/.sai/canvas/sub/deep.md`, content: 'x' }, 'file_edit'),
      ]),
    ];
    expect(deriveChatCanvases(msgs, P)).toEqual([
      '/home/u/proj/.sai/canvas/w.md',
      '/home/u/proj/.sai/canvas/e.md',
      '/home/u/proj/.sai/canvas/rel.md',
    ]);
  });

  it('ignores bad input, bad names, and user messages', () => {
    const msgs: ChatMessage[] = [
      { id: 'u', role: 'user', content: '[Canvas update] .sai/canvas/u.md', timestamp: 1 },
      asst('a', [tc('mcp__sai__sai_canvas', '{not json'), tc('mcp__sai__sai_canvas', { action: 'write', name: '../x' })]),
    ];
    expect(deriveChatCanvases(msgs, P)).toEqual([]);
  });

  it('touches carry the timestamp of the first message that touched each canvas', () => {
    const w = (n: string) => tc('mcp__sai__sai_canvas', { action: 'write', name: n, content: '' });
    expect(deriveChatCanvasTouches([asst('a', [w('x')], 10), asst('b', [w('x'), w('y')], 20)], P)).toEqual([
      { path: '/home/u/proj/.sai/canvas/x.md', at: 10 },
      { path: '/home/u/proj/.sai/canvas/y.md', at: 20 },
    ]);
  });
});
