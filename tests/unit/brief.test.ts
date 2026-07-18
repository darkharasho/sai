import { describe, it, expect } from 'vitest';
import {
  createEmptyBrief, applyBriefUpdate, briefIsCreatable,
  renderSeedMarkdown, renderClaudeMdContext, type ProjectBrief,
} from '../../electron/services/brainstorm/brief';

const full = (): ProjectBrief => ({
  projectName: 'folder-janitor',
  summary: 'A tray app that sorts downloads by rules.',
  goals: ['Watch Downloads', 'Editable rules'],
  nonGoals: ['Cloud sync'],
  stack: [{ name: 'Tauri', rationale: 'tiny footprint' }],
  openQuestions: ['Conflict behavior?'],
  ready: true,
});

describe('createEmptyBrief', () => {
  it('starts null/empty/not-ready', () => {
    expect(createEmptyBrief()).toEqual({
      projectName: null, summary: null, goals: [], nonGoals: [],
      stack: [], openQuestions: [], ready: false,
    });
  });
});

describe('applyBriefUpdate', () => {
  it('merges provided fields and keeps the rest', () => {
    const r = applyBriefUpdate(full(), { summary: 'New summary.', ready: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.brief.summary).toBe('New summary.');
    expect(r.brief.ready).toBe(false);
    expect(r.brief.projectName).toBe('folder-janitor');
    expect(r.brief.goals).toEqual(['Watch Downloads', 'Editable rules']);
  });

  it('does not mutate the input brief', () => {
    const cur = full();
    applyBriefUpdate(cur, { summary: 'changed' });
    expect(cur.summary).toBe('A tray app that sorts downloads by rules.');
  });

  it('replaces arrays wholesale (no append)', () => {
    const r = applyBriefUpdate(full(), { goals: ['Only goal'] });
    expect(r.ok && r.brief.goals).toEqual(['Only goal']);
  });

  it('ignores unknown keys', () => {
    const r = applyBriefUpdate(full(), { bogus: 1, summary: 'ok then' });
    expect(r.ok && r.brief.summary).toBe('ok then');
    expect(r.ok && (r.brief as any).bogus).toBeUndefined();
  });

  it.each([
    ['UpperCase', { projectName: 'FolderJanitor' }],
    ['spaces', { projectName: 'folder janitor' }],
    ['leading digit', { projectName: '1janitor' }],
    ['too long', { projectName: 'a'.repeat(41) }],
    ['empty', { projectName: '' }],
  ])('rejects bad projectName (%s)', (_label, patch) => {
    const r = applyBriefUpdate(createEmptyBrief(), patch);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(' ')).toMatch(/projectName/);
  });

  it('rejects non-string summary and empty-string array entries, listing every error', () => {
    const r = applyBriefUpdate(createEmptyBrief(), { summary: 42, goals: ['ok', ''] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBe(2);
  });

  it('rejects malformed stack entries', () => {
    const r = applyBriefUpdate(createEmptyBrief(), { stack: [{ name: 'Tauri' }] });
    expect(r.ok).toBe(false);
  });

  it('rejects non-object patches', () => {
    expect(applyBriefUpdate(createEmptyBrief(), 'nope').ok).toBe(false);
    expect(applyBriefUpdate(createEmptyBrief(), null).ok).toBe(false);
  });

  it('accepts a valid full patch onto an empty brief', () => {
    const r = applyBriefUpdate(createEmptyBrief(), full());
    expect(r.ok && r.brief).toEqual(full());
  });
});

describe('briefIsCreatable', () => {
  it('requires projectName and summary', () => {
    expect(briefIsCreatable(createEmptyBrief())).toBe(false);
    expect(briefIsCreatable({ ...createEmptyBrief(), projectName: 'x' })).toBe(false);
    expect(briefIsCreatable({ ...createEmptyBrief(), projectName: 'x', summary: 's' })).toBe(true);
  });
});

describe('renderSeedMarkdown', () => {
  it('contains kickoff instruction, brief sections, open questions, and transcript', () => {
    const md = renderSeedMarkdown(full(), '**User:** hi\n\n**Assistant:** hello');
    expect(md).toMatch(/propose an implementation plan/i);
    expect(md).toContain('# Project brief: folder-janitor');
    expect(md).toContain('A tray app that sorts downloads by rules.');
    expect(md).toContain('- Watch Downloads');
    expect(md).toContain('## Out of scope');
    expect(md).toContain('**Tauri** — tiny footprint');
    expect(md).toContain('## Open questions');
    expect(md).toContain('Conflict behavior?');
    expect(md).toContain('## Brainstorm transcript');
    expect(md).toContain('**User:** hi');
  });

  it('omits empty sections and the transcript when blank', () => {
    const md = renderSeedMarkdown(
      { ...createEmptyBrief(), projectName: 'x', summary: 'S.' }, '');
    expect(md).not.toContain('## Out of scope');
    expect(md).not.toContain('## Open questions');
    expect(md).not.toContain('## Brainstorm transcript');
  });
});

describe('renderClaudeMdContext', () => {
  it('renders Project Context plus brief sections', () => {
    const md = renderClaudeMdContext(full());
    expect(md).toContain('## Project Context');
    expect(md).toContain('A tray app that sorts downloads by rules.');
    expect(md).toContain('## Goals');
    expect(md).toContain('## Out of scope');
    expect(md).toContain('## Suggested stack');
    expect(md).not.toContain('## Open questions'); // open questions live in the seed, not CLAUDE.md
  });
});
