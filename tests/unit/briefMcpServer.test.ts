import { describe, it, expect } from 'vitest';
import { buildBriefMcpServer } from '../../electron/services/brainstorm/briefMcpServer';
import { createEmptyBrief, type ProjectBrief } from '../../electron/services/brainstorm/brief';
import { BRAINSTORM_SYSTEM_PROMPT } from '../../electron/services/brainstorm/prompts';

function makeServer() {
  let brief = createEmptyBrief();
  const server = buildBriefMcpServer({
    getBrief: () => brief,
    setBrief: (b: ProjectBrief) => { brief = b; },
  });
  const handler = (server as any).__handlersForTest.get('update_brief');
  return { handler, getBrief: () => brief };
}

describe('buildBriefMcpServer', () => {
  it('exposes exactly the update_brief handler seam', () => {
    const server = buildBriefMcpServer({ getBrief: createEmptyBrief, setBrief: () => {} });
    expect([...(server as any).__handlersForTest.keys()]).toEqual(['update_brief']);
  });

  it('applies a valid patch and returns the merged brief as text content', async () => {
    const { handler, getBrief } = makeServer();
    const res = await handler({ projectName: 'folder-janitor', summary: 'Sorts downloads.' });
    expect(getBrief().projectName).toBe('folder-janitor');
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text).projectName).toBe('folder-janitor');
  });

  it('returns isError with the validation messages and leaves the brief unchanged', async () => {
    const { handler, getBrief } = makeServer();
    const res = await handler({ projectName: 'Bad Name' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/kebab-case/);
    expect(getBrief().projectName).toBeNull();
  });
});

describe('BRAINSTORM_SYSTEM_PROMPT', () => {
  it('encodes the convergence contract', () => {
    expect(BRAINSTORM_SYSTEM_PROMPT).toMatch(/update_brief/);
    expect(BRAINSTORM_SYSTEM_PROMPT).toMatch(/one question per turn/i);
    expect(BRAINSTORM_SYSTEM_PROMPT).toMatch(/at most (5|five)/i);
    expect(BRAINSTORM_SYSTEM_PROMPT).toMatch(/ready/);
    expect(BRAINSTORM_SYSTEM_PROMPT).toMatch(/blockquote/i);
    expect(BRAINSTORM_SYSTEM_PROMPT).not.toMatch(/do not emit JSON/i); // the old self-defeating rule must not return
  });
});
