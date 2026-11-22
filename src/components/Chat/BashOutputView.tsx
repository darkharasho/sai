import { useEffect, useMemo, useState } from 'react';
import { getShikiHighlighter, getActiveHighlightTheme } from '../../themes';
import { prepareBashOutput, classifyLine, segmentOutput } from './bashOutput';
import { shikiInnerHtml } from './BashCommandView';

const HEAD = 4;
const TAIL = 8;
const LIVE_TAIL = 10;

/**
 * The OUT row of a Bash card. Long output shows its start and its end (where
 * results and errors are); live output shows its newest lines.
 */
export function BashOutputView({ command, output, live, showAll, onToggleShowAll }: {
  command?: string;
  output: string;
  live: boolean;
  showAll: boolean;
  onToggleShowAll: () => void;
}) {
  const prepared = useMemo(() => prepareBashOutput(command, output), [command, output]);
  const { lines, lang, diff } = prepared;
  const total = lines.length;

  let head: string[] = lines;
  let tail: string[] = [];
  let hidden = 0;
  if (!showAll && live && total > LIVE_TAIL) {
    head = [];
    tail = lines.slice(-LIVE_TAIL);
    hidden = total - LIVE_TAIL;
  } else if (!showAll && total > HEAD + TAIL + 2) {
    head = lines.slice(0, HEAD);
    tail = lines.slice(-TAIL);
    hidden = total - HEAD - TAIL;
  }

  const more = hidden > 0 && (
    <button type="button" className="bash-out-more" onClick={onToggleShowAll}>
      {live && !head.length ? `⋯ ${hidden} earlier line${hidden === 1 ? '' : 's'}` : `⋯ ${hidden} more line${hidden === 1 ? '' : 's'}`}
    </button>
  );
  const less = showAll && total > HEAD + TAIL + 2 && (
    <button type="button" className="bash-out-more" onClick={onToggleShowAll}>Show less</button>
  );

  return (
    <div className="bash-out-body">
      <Chunk lines={head} lang={lang} diff={diff} />
      {more}
      <Chunk lines={tail} lang={lang} diff={diff} />
      {less}
    </div>
  );
}

function Chunk({ lines, lang, diff }: { lines: string[]; lang: string | null; diff: boolean }) {
  const segments = useMemo(() => (lang ? [] : segmentOutput(lines, diff)), [lines, lang, diff]);
  if (!lines.length) return null;
  if (lang) return <Highlighted text={lines.join('\n')} lang={lang} />;
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === 'json') return <Highlighted key={i} text={seg.text} lang="json" />;
        const { line } = seg;
        const { kind, prefix } = classifyLine(line, diff);
        return (
          <div key={i} className={`bash-out-line${kind === 'plain' ? '' : ` bash-out-${kind}`}`}>
            {prefix > 0 && <span className="bash-out-loc">{line.slice(0, prefix)}</span>}
            {prefix > 0 ? line.slice(prefix) : line}
          </div>
        );
      })}
    </>
  );
}

function Highlighted({ text, lang }: { text: string; lang: string }) {
  const html = useShiki(text, lang);
  return html
    ? <code className="bash-out-code" dangerouslySetInnerHTML={{ __html: html }} />
    : <code className="bash-out-code">{text}</code>;
}

function useShiki(text: string, lang: string | null): string | null {
  const [theme, setTheme] = useState(getActiveHighlightTheme());
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    if (!lang) return;
    const handler = () => setTheme(getActiveHighlightTheme());
    window.addEventListener('sai-highlight-theme-change', handler);
    return () => window.removeEventListener('sai-highlight-theme-change', handler);
  }, [lang]);

  useEffect(() => {
    setHtml(null);
    if (!lang || !text) return;
    let cancelled = false;
    getShikiHighlighter().then(hl => {
      if (!cancelled) setHtml(shikiInnerHtml(hl, text, lang, theme));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [text, lang, theme]);

  return html;
}
