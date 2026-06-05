import { describe, it, expect } from 'vitest';
import { classifyTool, isReadTool, isWriteTool } from '@/lib/swarmToolTaxonomy';

describe('swarmToolTaxonomy', () => {
  it('classifies real provider read tools', () => {
    for (const t of ['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'NotebookRead']) {
      expect(classifyTool(t)).toBe('read');
      expect(isReadTool(t)).toBe(true);
      expect(isWriteTool(t)).toBe(false);
    }
  });

  it('classifies real provider write tools', () => {
    for (const t of ['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Bash']) {
      expect(classifyTool(t)).toBe('write');
      expect(isWriteTool(t)).toBe(true);
      expect(isReadTool(t)).toBe(false);
    }
  });

  it('still classifies legacy snake_case aliases', () => {
    expect(classifyTool('read_file')).toBe('read');
    expect(classifyTool('list_files')).toBe('read');
    expect(classifyTool('search')).toBe('read');
    expect(classifyTool('edit_file')).toBe('write');
    expect(classifyTool('write_file')).toBe('write');
    expect(classifyTool('apply_patch')).toBe('write');
    expect(classifyTool('str_replace')).toBe('write');
    expect(classifyTool('create_file')).toBe('write');
    expect(classifyTool('bash')).toBe('write');
  });

  it('is case-insensitive', () => {
    expect(classifyTool('read')).toBe('read');
    expect(classifyTool('EDIT')).toBe('write');
    expect(classifyTool('bAsH')).toBe('write');
  });

  it('returns "other" for unknown tools and falsy input', () => {
    expect(classifyTool('AskUserQuestion')).toBe('other');
    expect(classifyTool('')).toBe('other');
    expect(classifyTool(undefined as unknown as string)).toBe('other');
    expect(isReadTool('AskUserQuestion')).toBe(false);
    expect(isWriteTool('AskUserQuestion')).toBe(false);
  });
});
