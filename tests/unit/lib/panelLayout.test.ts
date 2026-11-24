import { describe, it, expect } from 'vitest';
import { expandEditorPanel } from '../../../src/lib/panelLayout';

describe('expandEditorPanel', () => {
  it('leaves the layout alone when the editor is already expanded', () => {
    const prev = ['editor', 'terminal'] as const;
    expect(expandEditorPanel([...prev], false)).toEqual(prev);
  });
  it('default (user-initiated) open: the oldest panel gives way, as before', () => {
    expect(expandEditorPanel(['chat', 'terminal'], false)).toEqual(['terminal', 'editor']);
    expect(expandEditorPanel(['chat'], false)).toEqual(['chat', 'editor']);
  });
  it('D3: keepChat expands the editor beside an expanded chat instead of collapsing it', () => {
    expect(expandEditorPanel(['chat', 'terminal'], true)).toEqual(['chat', 'editor']);
    expect(expandEditorPanel(['terminal', 'chat'], true)).toEqual(['chat', 'editor']);
    expect(expandEditorPanel(['chat'], true)).toEqual(['chat', 'editor']);
  });
  it('keepChat never re-expands a chat the user collapsed', () => {
    expect(expandEditorPanel(['terminal'], true)).toEqual(['terminal', 'editor']);
  });
  it('returns the same array when nothing changes', () => {
    const prev: ('chat' | 'editor' | 'terminal')[] = ['chat', 'editor'];
    expect(expandEditorPanel(prev, true)).toBe(prev);
  });
});
