import { describe, it, expect } from 'vitest';
import { formatBashCommand, detectHeredocLang } from '../../../../src/components/Chat/bashFormat';

const shellText = (cmd: string) => formatBashCommand(cmd).map(b => (b.kind === 'shell' ? b.text : `[${b.lang}]`)).join('|');

describe('formatBashCommand line splitting', () => {
  it('puts each top-level command on its own line', () => {
    expect(shellText('cd /x && npm test; echo done || true')).toBe('cd /x &&\nnpm test;\necho done ||\ntrue');
  });

  it('leaves operators inside quotes, $(), subshells and [[ ]] alone', () => {
    for (const cmd of [
      `echo "a; b && c"`,
      `echo 'a; b'`,
      `x=$(foo; bar)`,
      `(cd a && make)`,
      `[[ -f a && -f b ]]`,
    ]) expect(shellText(cmd)).toBe(cmd);
  });

  it('does not split inside (( ))', () => {
    expect(shellText('for ((i=0;i<3;i++)); do :; done')).toBe('for ((i=0;i<3;i++)); do\n  :;\ndone');
  });

  it('keeps `; do` / `; then` on the line and indents the body', () => {
    expect(shellText('for i in 0 1; do npx tsx run.ts $i.json; echo "exit $i: $?"; done'))
      .toBe('for i in 0 1; do\n  npx tsx run.ts $i.json;\n  echo "exit $i: $?";\ndone');
    expect(shellText('if [ -f a ]; then echo yes; else echo no; fi'))
      .toBe('if [ -f a ]; then\n  echo yes;\nelse\n  echo no;\nfi');
  });

  it('does not split after a trailing operator or before a comment', () => {
    expect(shellText('a &&\nb')).toBe('a &&\nb');
    expect(shellText('a; # note')).toBe('a; # note');
    expect(shellText('echo "x" # a; b && c')).toBe('echo "x" # a; b && c');
  });

  it('does not treat a word ending in a keyword as one', () => {
    expect(shellText('echo done; echo fi')).toBe('echo done;\necho fi');
  });
});

describe('formatBashCommand heredocs', () => {
  it('splits heredoc bodies out with their language and closing marker', () => {
    const cmd = [
      "cd /repo; python3 - <<'EOF'",
      "import os",
      "print(1)",
      "EOF",
      "cat > /tmp/run.ts <<'EOF'",
      "const x: number = 1",
      "EOF",
      "npx tsx /tmp/run.ts",
    ].join('\n');
    expect(formatBashCommand(cmd)).toEqual([
      { kind: 'shell', text: "cd /repo;\npython3 - <<'EOF'" },
      { kind: 'heredoc', lang: 'python', body: 'import os\nprint(1)', terminator: 'EOF' },
      { kind: 'shell', text: "cat > /tmp/run.ts <<'EOF'" },
      { kind: 'heredoc', lang: 'typescript', body: 'const x: number = 1', terminator: 'EOF' },
      { kind: 'shell', text: 'npx tsx /tmp/run.ts' },
    ]);
  });

  it('leaves an unterminated (still streaming) heredoc open', () => {
    expect(formatBashCommand('node <<EOF\nconsole.log(1)')).toEqual([
      { kind: 'shell', text: 'node <<EOF' },
      { kind: 'heredoc', lang: 'javascript', body: 'console.log(1)', terminator: null },
    ]);
  });

  it('honours <<- tab stripping and does not split before the body', () => {
    const blocks = formatBashCommand('cat <<-END > a.json && echo ok\n\t{"a":1}\n\tEND');
    expect(blocks).toEqual([
      { kind: 'shell', text: 'cat <<-END > a.json && echo ok' },
      { kind: 'heredoc', lang: 'json', body: '\t{"a":1}', terminator: '\tEND' },
    ]);
  });

  it('ignores here-strings and heredoc markers inside quotes', () => {
    expect(formatBashCommand('grep x <<< "$v"; echo "<<EOF"')).toEqual([
      { kind: 'shell', text: 'grep x <<< "$v";\necho "<<EOF"' },
    ]);
  });

  it('round-trips the command apart from inserted line breaks', () => {
    const cmd = "cd a && cat <<'X' | python3\nprint('a; b')\nX\nls; pwd";
    const text = formatBashCommand(cmd).map(b => (b.kind === 'shell' ? b.text : `${b.body}\n${b.terminator}`)).join('\n');
    expect(text.replace(/\n\s*/g, ' ')).toBe(cmd.replace(/\n\s*/g, ' '));
  });
});

describe('detectHeredocLang', () => {
  it.each([
    ["python3 - <<'EOF'", '', 'python'],
    ['sudo -E python3.12 <<EOF', '', 'python'],
    ['npx tsx <<EOF', '', 'typescript'],
    ['cat <<EOF | bash', '', 'bash'],
    ['psql -d db <<SQL', '', 'sql'],
    ["cat > src/a.rs <<'EOF'", '', 'rust'],
    ["cat <<'EOF' > notes.md", '', 'markdown'],
    ['tee -a cfg.yaml <<EOF', '', 'yaml'],
    ['git commit -F - <<EOF', '', 'markdown'],
    ['gh release create v1 --notes-file - <<NOTES', '', 'markdown'],
    ['git apply <<EOF', '', 'diff'],
    ['cat <<EOF', '{"a": [1, 2]}', 'json'],
    ['cat <<EOF', '#!/usr/bin/env python3\nprint(1)', 'python'],
    ['cat <<EOF', 'just some words', 'text'],
  ])('%s → %s', (stmt, body, lang) => {
    expect(detectHeredocLang(stmt, body)).toBe(lang);
  });
});
