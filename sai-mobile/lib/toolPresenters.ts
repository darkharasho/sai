export interface ToolPresenter {
  label: string;
  summary(input: unknown): string;
}

const TOOL_PRESENTERS: Record<string, ToolPresenter> = {
  bash: { label: 'Bash', summary: (i: any) => i?.command ?? '' },
  read: { label: 'Read', summary: (i: any) => i?.path ?? i?.file_path ?? '' },
  edit: { label: 'Edit', summary: (i: any) => i?.path ?? i?.file_path ?? '' },
  write: { label: 'Write', summary: (i: any) => i?.path ?? i?.file_path ?? '' },
  grep: { label: 'Grep', summary: (i: any) => i?.pattern ?? '' },
  glob: { label: 'Glob', summary: (i: any) => i?.pattern ?? '' },
};

export function presentTool(toolName?: string, input?: unknown): { label: string; summary: string } {
  const p = TOOL_PRESENTERS[(toolName ?? '').toLowerCase()];
  if (!p) return { label: toolName ?? 'Tool', summary: typeof input === 'string' ? input : '' };
  return { label: p.label, summary: p.summary(input) };
}
