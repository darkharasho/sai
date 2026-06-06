import { describe, it, expect } from 'vitest';
import { extractEditToolUses, successfulToolResultIds } from '../../../../src/components/CodePanel/detectFileEdits';

const root = '/home/u/proj';

describe('extractEditToolUses', () => {
  it('returns an absolute Write file_path unchanged', () => {
    const content = [{ type: 'tool_use', id: 'a1', name: 'Write', input: { file_path: '/home/u/proj/src/a.ts', content: 'x' } }];
    expect(extractEditToolUses(content, root)).toEqual([{ id: 'a1', path: '/home/u/proj/src/a.ts' }]);
  });

  it('resolves a relative Edit file_path against the project root', () => {
    const content = [{ type: 'tool_use', id: 'a2', name: 'Edit', input: { file_path: 'src/b.ts' } }];
    expect(extractEditToolUses(content, root)).toEqual([{ id: 'a2', path: '/home/u/proj/src/b.ts' }]);
  });

  it('returns a NotebookEdit notebook_path', () => {
    const content = [{ type: 'tool_use', id: 'a3', name: 'NotebookEdit', input: { notebook_path: '/abs/n.ipynb' } }];
    expect(extractEditToolUses(content, root)).toEqual([{ id: 'a3', path: '/abs/n.ipynb' }]);
  });

  it('excludes non-edit tools and pathless edit blocks', () => {
    const content = [
      { type: 'tool_use', id: 'r', name: 'Read', input: { file_path: '/x' } },
      { type: 'tool_use', id: 'w', name: 'Write', input: {} },
      { type: 'text', text: 'hi' },
    ];
    expect(extractEditToolUses(content, root)).toEqual([]);
  });

  it('returns every edit in a content array, in order', () => {
    const content = [
      { type: 'tool_use', id: 'a', name: 'Write', input: { file_path: '/p/a' } },
      { type: 'tool_use', id: 'b', name: 'Edit', input: { file_path: '/p/b' } },
    ];
    expect(extractEditToolUses(content, root).map(e => e.id)).toEqual(['a', 'b']);
  });

  it('returns [] for non-array content', () => {
    expect(extractEditToolUses(undefined, root)).toEqual([]);
    expect(extractEditToolUses('nope', root)).toEqual([]);
  });
});

describe('successfulToolResultIds', () => {
  it('returns ids of non-error tool_result blocks', () => {
    const content = [
      { type: 'tool_result', tool_use_id: 'ok1', is_error: false },
      { type: 'tool_result', tool_use_id: 'ok2' },
    ];
    expect(successfulToolResultIds(content)).toEqual(['ok1', 'ok2']);
  });

  it('excludes is_error results', () => {
    const content = [
      { type: 'tool_result', tool_use_id: 'bad', is_error: true },
      { type: 'tool_result', tool_use_id: 'good', is_error: false },
    ];
    expect(successfulToolResultIds(content)).toEqual(['good']);
  });

  it('returns [] for non-array content', () => {
    expect(successfulToolResultIds(null)).toEqual([]);
    expect(successfulToolResultIds(undefined)).toEqual([]);
  });
});
