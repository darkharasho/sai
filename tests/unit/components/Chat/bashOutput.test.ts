import { describe, it, expect } from 'vitest';
import { prepareBashOutput, classifyLine, readLang, segmentOutput } from '../../../../src/components/Chat/bashOutput';

const kind = (line: string, diff = false) => classifyLine(line, diff).kind;

describe('prepareBashOutput', () => {
  it('keeps indentation and single blank lines, collapses blank runs, trims the ends', () => {
    expect(prepareBashOutput('ls', '\n\n  a\n\n\n\n    b  \n\n').lines).toEqual(['  a', '', '    b']);
  });

  it('strips ANSI colour codes', () => {
    expect(prepareBashOutput('x', '\x1b[31mred\x1b[0m done').lines).toEqual(['red done']);
  });

  it('highlights JSON output and pretty-prints long one-line JSON', () => {
    const json = JSON.stringify({ name: 'sai', version: '1.40.3', description: 'x'.repeat(100) });
    const p = prepareBashOutput('gh api repos/x', json);
    expect(p.lang).toBe('json');
    expect(p.lines.length).toBeGreaterThan(3);
    expect(prepareBashOutput('echo', '{"a":1}').lines).toEqual(['{"a":1}']);
  });

  it('marks unified diffs', () => {
    expect(prepareBashOutput('git diff', 'diff --git a/x b/x\n@@ -1,2 +1,2 @@\n-a\n+b').diff).toBe(true);
    expect(prepareBashOutput('cat notes', '- a list\n- item').diff).toBe(false);
  });
});

describe('readLang', () => {
  it('uses the file extension of a single-file read', () => {
    expect(readLang('cat src/a.ts')).toBe('typescript');
    expect(readLang("sed -n '1,40p' scripts/x.py")).toBe('python');
    expect(readLang('head -50 .github/workflows/release.yml')).toBe('yaml');
    expect(readLang('cat package.json | head -20')).toBe('json');
    expect(readLang('git show HEAD:src/a.tsx')).toBe('typescript');
  });

  it('gives up on anything that is not one file read', () => {
    for (const cmd of ['cat a.ts b.ts', 'cat -n a.ts', 'cd x && cat a.ts', 'cat a.ts | grep foo', 'grep -n x a.ts', 'cat README']) {
      expect(readLang(cmd)).toBeNull();
    }
  });
});

describe('classifyLine', () => {
  it('flags errors', () => {
    for (const l of [
      'src/a.ts(12,3): error TS2322: Type x',
      'Error: expect(locator).toBeVisible() failed',
      '  FileNotFoundError: [Errno 2] No such file',
      'Traceback (most recent call last):',
      ' FAIL  tests/unit/a.test.ts > b',
      '      Tests  2 failed | 3831 passed (3833)',
      '       × keeps the tab 6ms',
      'Exit code 127',
      'exit 1: 2',
      'bash: foo: command not found',
    ]) expect(kind(l), l).toBe('error');
  });

  it('flags warnings and successes', () => {
    expect(kind('Fontconfig warning: "/etc/fonts/x.conf", line 3')).toBe('warn');
    expect(kind('      Tests  4679 passed | 7 skipped (4686)')).toBe('ok');
    expect(kind('   ✓ renders the card 12ms')).toBe('ok');
    expect(kind('exit 1: 0')).toBe('ok');
  });

  it('leaves code and ordinary text alone', () => {
    for (const l of [
      '  res = jsonResponse(500, { error: "internal" });',
      '  result = { ok: false, error: errText(err) };',
      '    process.exit(1)',
      'To https://github.com/darkharasho/sai.git',
      'Already up to date.',
    ]) expect(kind(l), l).toBe('plain');
  });

  it('dims grep locations and does not tint the matched content', () => {
    expect(classifyLine('src/a.ts:12:  throw new Error("x")', false)).toEqual({ kind: 'plain', prefix: 'src/a.ts:12:'.length });
    expect(classifyLine('src/a.ts-13-  // context', false)).toEqual({ kind: 'plain', prefix: 'src/a.ts-13-'.length });
    expect(classifyLine('25:Rulings:', false)).toEqual({ kind: 'plain', prefix: 3 });
  });

  it('marks harness notes', () => {
    expect(kind('Shell cwd was reset to /home/x')).toBe('meta');
    expect(kind('(Bash completed with no output)')).toBe('meta');
  });

  it('tints diff lines in diff mode only', () => {
    expect(kind('+added', true)).toBe('add');
    expect(kind('-removed', true)).toBe('del');
    expect(kind('@@ -1 +1 @@', true)).toBe('hunk');
    expect(kind('+++ b/x', true)).toBe('diffmeta');
    expect(kind('-removed', false)).toBe('plain');
  });
});

describe('segmentOutput', () => {
  it('finds one-line and pretty-printed JSON inside mixed output', () => {
    const lines = ['{"ok":true,"warnings":[]}', 'exit 0: 0', '{', '  "a": [1, 2]', '}', 'done'];
    expect(segmentOutput(lines, false)).toEqual([
      { kind: 'json', text: '{"ok":true,"warnings":[]}' },
      { kind: 'line', line: 'exit 0: 0' },
      { kind: 'json', text: '{\n  "a": [1, 2]\n}' },
      { kind: 'line', line: 'done' },
    ]);
  });

  it('joins consecutive JSON lines (JSONL) into one block', () => {
    expect(segmentOutput(['{"a":1}', '{"b":2}', 'x'], false)).toEqual([
      { kind: 'json', text: '{"a":1}\n{"b":2}' },
      { kind: 'line', line: 'x' },
    ]);
  });

  it('leaves bracketed text, code blocks and diffs as lines', () => {
    for (const lines of [['[1/3] Building'], ['[ok] done]'], ['{', '  foo();', '}']]) {
      expect(segmentOutput(lines, false).every(s => s.kind === 'line'), lines.join('|')).toBe(true);
    }
    expect(segmentOutput(['{"a":1}'], true)).toEqual([{ kind: 'line', line: '{"a":1}' }]);
  });
});
