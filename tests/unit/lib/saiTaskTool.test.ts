import { describe, it, expect } from 'vitest';
import { SAI_TASK_TOOL, validateSaiTaskInput, isSaiTaskToolName } from '../../../src/lib/saiTaskTool';
import { SAI_TOOL_SCHEMA } from '../../../src/lib/saiTools';

describe('saiTaskTool', () => {
  it('is a chat tool named task and not in SAI_TOOL_SCHEMA', () => {
    expect(SAI_TASK_TOOL.name).toBe('task');
    expect(SAI_TASK_TOOL.toolset).toBe('chat');
    expect(SAI_TOOL_SCHEMA.some((t) => t.name === 'task')).toBe(false);
  });

  it('accepts a valid create and a valid update', () => {
    expect(validateSaiTaskInput({ action: 'create', tasks: [{ id: 'a', title: 'A', steps: ['x', 'y'] }] })).toEqual({ ok: true });
    expect(validateSaiTaskInput({ action: 'update', id: 'a', status: 'running', step: 1 })).toEqual({ ok: true });
  });

  it('rejects create without tasks, update without id, non-numeric step', () => {
    const a = validateSaiTaskInput({ action: 'create' });
    expect(a.ok).toBe(false);
    expect((a as any).error).toMatch(/tasks/);
    const b = validateSaiTaskInput({ action: 'update', status: 'done' });
    expect(b.ok).toBe(false);
    expect((b as any).error).toMatch(/id/);
    const c = validateSaiTaskInput({ action: 'update', id: 'a', step: 'two' });
    expect(c.ok).toBe(false);
    expect((c as any).error).toMatch(/step/);
    expect(validateSaiTaskInput(null).ok).toBe(false);
    expect(validateSaiTaskInput({ action: 'nope' }).ok).toBe(false);
  });

  it('isSaiTaskToolName matches mcp__sai__sai_task and task only', () => {
    expect(isSaiTaskToolName('mcp__sai__sai_task')).toBe(true);
    expect(isSaiTaskToolName('task')).toBe(true);
    expect(isSaiTaskToolName('Task')).toBe(false);
    expect(isSaiTaskToolName('TaskCreate')).toBe(false);
    expect(isSaiTaskToolName('mcp__sai__sai_render_html')).toBe(false);
    expect(isSaiTaskToolName('sai_task')).toBe(true);
    expect(isSaiTaskToolName('mcp__evil__sai_task')).toBe(false);
    expect(isSaiTaskToolName('not_sai_task')).toBe(false);
  });
  it('steps are optional on create but must be an array when present', () => {
    expect(validateSaiTaskInput({ action: 'create', tasks: [{ id: 't1', title: 'A' }] }).ok).toBe(true);
    expect(validateSaiTaskInput({ action: 'create', tasks: [{ id: 't1', title: 'A', steps: 'x' }] }).ok).toBe(false);
    const items = (SAI_TASK_TOOL.input_schema as any).properties.tasks.items;
    expect(items.required).toEqual(['id', 'title']);
  });
});
