import { useEffect, useMemo, useState } from 'react';
import { getShikiHighlighter, getActiveHighlightTheme } from '../../themes';
import { formatBashCommand, type BashBlock } from './bashFormat';

/** Shiki's token spans for `code`, without the surrounding <pre><code>. */
export function shikiInnerHtml(highlighter: any, code: string, lang: string, theme: string): string | null {
  if (!code || lang === 'text') return null;
  try {
    const html: string = highlighter.codeToHtml(code, { lang, theme });
    return html.match(/<code[^>]*>([\s\S]*)<\/code>/)?.[1] ?? null;
  } catch {
    return null; // language not loaded
  }
}

function Code({ code, html }: { code: string; html: string | null | undefined }) {
  return html
    ? <code className="bash-cmd-code" dangerouslySetInnerHTML={{ __html: html }} />
    : <code className="bash-cmd-code">{code}</code>;
}

/**
 * The full command in a Bash card's IN row: shell highlighted as bash, one
 * top-level command per line, heredoc bodies in nested panels highlighted in
 * their own language.
 */
export function BashCommandView({ command }: { command: string }) {
  const blocks = useMemo(() => formatBashCommand(command), [command]);
  const [theme, setTheme] = useState(getActiveHighlightTheme());
  const [htmls, setHtmls] = useState<(string | null)[]>([]);

  useEffect(() => {
    const handler = () => setTheme(getActiveHighlightTheme());
    window.addEventListener('sai-highlight-theme-change', handler);
    return () => window.removeEventListener('sai-highlight-theme-change', handler);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getShikiHighlighter().then(hl => {
      if (cancelled) return;
      setHtmls(blocks.map((b: BashBlock) =>
        b.kind === 'shell' ? shikiInnerHtml(hl, b.text, 'bash', theme) : shikiInnerHtml(hl, b.body, b.lang, theme)));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [blocks, theme]);

  return (
    <>
      {blocks.map((b, i) => b.kind === 'shell' ? (
        <div key={i} className="bash-cmd-shell"><Code code={b.text} html={htmls[i]} /></div>
      ) : (
        <div key={i} className="bash-cmd-heredoc-wrap">
          <div className="bash-cmd-heredoc" data-lang={b.lang === 'text' ? undefined : b.lang}>
            <Code code={b.body} html={htmls[i]} />
          </div>
          {b.terminator !== null && <div className="bash-cmd-heredoc-end">{b.terminator}</div>}
        </div>
      ))}
    </>
  );
}
