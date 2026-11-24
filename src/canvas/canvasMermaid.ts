/**
 * Render-time dressing for canvas diagrams. Nothing here is ever written to the canvas file:
 * the view passes the prepared source to mermaid, the file keeps the agent's/user's source.
 *
 * - A theme directive tuned to SAI's dark palette (unless the source brings its own init).
 * - classDefs for the result classes `pass` / `fail` / `current` (`class A,B pass`, `A:::fail`),
 *   for flowcharts only (classDef is flowchart syntax), skipping any class the source defines.
 */
export const RESULT_CLASSES = ['pass', 'fail', 'current'] as const;

const DEFAULT_ACCENT = '#d4a017';

const THEME = {
  theme: 'base',
  themeVariables: {
    darkMode: true,
    background: 'transparent',
    fontFamily: 'Onest, Inter, -apple-system, "Segoe UI", sans-serif',
    fontSize: '13px',
    primaryColor: '#1c1c21',
    primaryBorderColor: '#3a3a44',
    primaryTextColor: '#e4e4e7',
    secondaryColor: '#1c1c21',
    secondaryBorderColor: '#3a3a44',
    secondaryTextColor: '#e4e4e7',
    tertiaryColor: '#18181c',
    tertiaryBorderColor: '#32323a',
    tertiaryTextColor: '#e4e4e7',
    nodeBorder: '#3a3a44',
    mainBkg: '#1c1c21',
    textColor: '#c8c8d0',
    lineColor: '#5c5c66',
    edgeLabelBackground: '#141418',
    clusterBkg: '#18181c',
    clusterBorder: '#32323a',
    titleColor: '#e4e4e7',
    noteBkgColor: '#1c1c21',
    noteBorderColor: '#3a3a44',
    noteTextColor: '#c8c8d0',
    actorBkg: '#1c1c21',
    actorBorder: '#3a3a44',
    actorTextColor: '#e4e4e7',
    signalColor: '#8b8b96',
    signalTextColor: '#c8c8d0',
  },
  flowchart: { padding: 14, nodeSpacing: 36, rankSpacing: 40 },
};

function classDefs(accent: string): Record<(typeof RESULT_CLASSES)[number], string> {
  return {
    pass: 'fill:#14271c,stroke:#2f6b45,color:#d1fadf',
    fail: 'fill:#2c1619,stroke:#7c3b3b,color:#fde2e2',
    current: `fill:#1c1c21,stroke:${accent},stroke-width:1.5px,color:#f4f4f5`,
  };
}

const FLOWCHART_RE = /^\s*(?:flowchart|graph)\b/;

/** First line that is not blank, a `%%` comment, or a directive. */
function headerLine(src: string): string {
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('%%')) continue;
    return t;
  }
  return '';
}

export function prepareCanvasDiagram(source: string, accent: string): string {
  const color = /^#[0-9a-f]{3,8}$|^rgba?\([\d\s.,%]+\)$/i.test(accent.trim()) ? accent.trim() : DEFAULT_ACCENT;
  let out = source;
  if (FLOWCHART_RE.test(headerLine(source))) {
    const defs = classDefs(color);
    const missing = RESULT_CLASSES.filter((c) => !new RegExp(`^\\s*classDef\\s+(?:[\\w-]+\\s*,\\s*)*${c}\\b`, 'm').test(source));
    if (missing.length) {
      out = `${out.replace(/\s*$/, '')}\n${missing.map((c) => `  classDef ${c} ${defs[c]}`).join('\n')}\n`;
    }
  }
  if (!/%%\{\s*init(?:ialize)?\s*:/.test(source)) out = `%%{init: ${JSON.stringify(THEME)}}%%\n${out}`;
  return out;
}
