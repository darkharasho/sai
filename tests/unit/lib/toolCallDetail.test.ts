import { describe, it, expect } from 'vitest';
import { toolCallDetail, shortenPathLeft } from '@/lib/toolCallDetail';

const tc = (name: string, input: unknown, type = 'other') =>
  ({ name, type, input: typeof input === 'string' ? input : JSON.stringify(input) }) as any;

describe('shortenPathLeft', () => {
  it('keeps short paths intact', () => {
    expect(shortenPathLeft('src/App.tsx', 40)).toBe('src/App.tsx');
  });
  it('truncates from the left preserving the basename', () => {
    const p = 'src/components/Chat/GitHubWatcherCard.tsx';
    const out = shortenPathLeft(p, 30);
    expect(out.startsWith('…')).toBe(true);
    expect(out.endsWith('GitHubWatcherCard.tsx')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(30);
  });
  it('hard-cuts a basename longer than the budget', () => {
    expect(shortenPathLeft('averyveryverylongfilename.tsx', 12)).toBe('…ilename.tsx');
  });
});

describe('toolCallDetail', () => {
  it('Bash → first line of the command', () => {
    expect(toolCallDetail(tc('Bash', { command: 'npm test\necho done' }))).toBe('npm test');
  });
  it('Edit/Write/Read/NotebookEdit → left-shortened file_path', () => {
    for (const name of ['Edit', 'Write', 'Read', 'NotebookEdit']) {
      expect(toolCallDetail(tc(name, { file_path: '/var/home/m/proj/src/components/Chat/ChatPanel.tsx' })))
        .toMatch(/…?.*ChatPanel\.tsx$/);
    }
  });
  it('Grep/Glob → pattern', () => {
    expect(toolCallDetail(tc('Grep', { pattern: 'detectWatchTargets' }))).toBe('detectWatchTargets');
    expect(toolCallDetail(tc('Glob', { pattern: '**/*.test.ts' }))).toBe('**/*.test.ts');
  });
  it('WebFetch → host; WebSearch → query', () => {
    expect(toolCallDetail(tc('WebFetch', { url: 'https://docs.github.com/en/rest' }))).toBe('docs.github.com');
    expect(toolCallDetail(tc('WebSearch', { query: 'electron capturePage' }))).toBe('electron capturePage');
  });
  it('Task/Agent → description; Skill → skill name', () => {
    expect(toolCallDetail(tc('Task', { description: 'Fix flaky test' }))).toBe('Fix flaky test');
    expect(toolCallDetail(tc('Agent', { description: 'Explore repo', prompt: 'x' }))).toBe('Explore repo');
    expect(toolCallDetail(tc('Skill', { skill: 'commit', args: '' }))).toBe('commit');
  });
  it('mcp__ tools → first string-valued input property', () => {
    expect(toolCallDetail(tc('mcp__swarm__sai_render_html', { html: '<b>x</b>', width: 360 }))).toBe('<b>x</b>');
  });
  it('unknown tools → null', () => {
    expect(toolCallDetail(tc('TodoWrite', { todos: [] }))).toBeNull();
  });
  it('malformed/empty input → null', () => {
    expect(toolCallDetail(tc('Bash', '{"command": "npm'))).toBeNull();
    expect(toolCallDetail(tc('Bash', ''))).toBeNull();
    expect(toolCallDetail(tc('Bash', { other: 1 }))).toBeNull();
  });
  it('caps long details at a word boundary with ellipsis', () => {
    const long = 'echo ' + 'word '.repeat(40);
    const out = toolCallDetail(tc('Bash', { command: long }))!;
    expect(out.length).toBeLessThanOrEqual(81); // 80 + ellipsis char
    expect(out.endsWith('…')).toBe(true);
  });
  it('invalid url in WebFetch → null', () => {
    expect(toolCallDetail(tc('WebFetch', { url: 'not a url' }))).toBeNull();
  });
});
