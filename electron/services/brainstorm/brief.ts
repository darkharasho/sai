export interface StackItem { name: string; rationale: string }

export interface ProjectBrief {
  projectName: string | null;
  summary: string | null;
  goals: string[];
  nonGoals: string[];
  stack: StackItem[];
  openQuestions: string[];
  ready: boolean;
}

export function createEmptyBrief(): ProjectBrief {
  return { projectName: null, summary: null, goals: [], nonGoals: [], stack: [], openQuestions: [], ready: false };
}

export type BriefUpdateResult =
  | { ok: true; brief: ProjectBrief }
  | { ok: false; errors: string[] };

const KEBAB = /^[a-z][a-z0-9-]*$/;

function validStringArray(v: unknown, field: string, errors: string[]): v is string[] {
  if (!Array.isArray(v) || v.some(s => typeof s !== 'string' || !s.trim())) {
    errors.push(`${field} must be an array of non-empty strings`);
    return false;
  }
  return true;
}

/**
 * All-or-nothing validated merge. Fields present in the patch replace the
 * current value (arrays wholesale); absent fields are kept; unknown keys are
 * ignored. Any invalid field fails the whole patch — the error strings go
 * back to the model through the tool result so it can correct itself.
 */
export function applyBriefUpdate(current: ProjectBrief, patch: unknown): BriefUpdateResult {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    return { ok: false, errors: ['patch must be an object'] };
  }
  const p = patch as Record<string, unknown>;
  const errors: string[] = [];
  const next: ProjectBrief = {
    ...current,
    goals: [...current.goals],
    nonGoals: [...current.nonGoals],
    stack: current.stack.map(s => ({ ...s })),
    openQuestions: [...current.openQuestions],
  };

  if ('projectName' in p) {
    const v = p.projectName;
    if (typeof v !== 'string' || !KEBAB.test(v) || v.length > 40) {
      errors.push('projectName must be kebab-case (/^[a-z][a-z0-9-]*$/) and at most 40 characters');
    } else next.projectName = v;
  }
  if ('summary' in p) {
    if (typeof p.summary !== 'string' || !p.summary.trim()) {
      errors.push('summary must be a non-empty string');
    } else next.summary = p.summary.trim();
  }
  for (const field of ['goals', 'nonGoals', 'openQuestions'] as const) {
    if (field in p && validStringArray(p[field], field, errors)) {
      next[field] = (p[field] as string[]).map(s => s.trim());
    }
  }
  if ('stack' in p) {
    const v = p.stack;
    const valid = Array.isArray(v) && v.every(item =>
      typeof item === 'object' && item !== null &&
      typeof (item as any).name === 'string' && (item as any).name.trim() &&
      typeof (item as any).rationale === 'string' && (item as any).rationale.trim());
    if (!valid) errors.push('stack must be an array of { name, rationale } with non-empty strings');
    else next.stack = (v as StackItem[]).map(s => ({ name: s.name.trim(), rationale: s.rationale.trim() }));
  }
  if ('ready' in p) {
    if (typeof p.ready !== 'boolean') errors.push('ready must be a boolean');
    else next.ready = p.ready;
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, brief: next };
}

export function briefIsCreatable(brief: ProjectBrief): boolean {
  return !!(brief.projectName && brief.summary);
}

function bullets(items: string[]): string {
  return items.map(i => `- ${i}`).join('\n');
}

function section(title: string, body: string): string {
  return body ? `## ${title}\n\n${body}\n\n` : '';
}

/**
 * The seed becomes the FIRST USER MESSAGE of the new project's chat
 * (auto-sent by ChatPanel's one-shot seed consumption), so it opens with the
 * kickoff instruction and reads as a request, not a document dump.
 */
export function renderSeedMarkdown(brief: ProjectBrief, transcript: string): string {
  let md = 'This project was just created from a brainstorm. Read the brief below, ' +
    'propose an implementation plan, and flag the open questions before writing code.\n\n';
  md += `# Project brief: ${brief.projectName ?? 'untitled'}\n\n`;
  if (brief.summary) md += `${brief.summary}\n\n`;
  md += section('Goals', bullets(brief.goals));
  md += section('Out of scope', bullets(brief.nonGoals));
  md += section('Suggested stack', brief.stack.map(s => `- **${s.name}** — ${s.rationale}`).join('\n'));
  md += section('Open questions', bullets(brief.openQuestions));
  md += section('Brainstorm transcript', transcript.trim());
  return md.trimEnd() + '\n';
}

export function renderClaudeMdContext(brief: ProjectBrief): string {
  let md = `## Project Context\n\n${brief.summary ?? '_No context provided._'}\n\n`;
  md += section('Goals', bullets(brief.goals));
  md += section('Out of scope', bullets(brief.nonGoals));
  md += section('Suggested stack', brief.stack.map(s => `- **${s.name}** — ${s.rationale}`).join('\n'));
  return md.trimEnd() + '\n';
}
