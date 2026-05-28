import type { Highlighter } from 'shiki';

let cached: Promise<Highlighter> | null = null;

export function getHighlighter(): Promise<Highlighter> {
  if (!cached) {
    cached = (async () => {
      const { createHighlighter } = await import('shiki');
      return await createHighlighter({
        themes: ['github-dark'],
        langs: [
          'typescript', 'tsx', 'javascript', 'jsx',
          'python', 'rust', 'go', 'java', 'ruby',
          'c', 'cpp', 'csharp', 'swift', 'kotlin',
          'json', 'toml', 'yaml', 'markdown', 'mdx',
          'html', 'css', 'scss', 'bash', 'sql',
          'graphql', 'xml', 'diff',
        ],
      });
    })();
  }
  return cached;
}

export async function highlightToHtml(code: string, lang: string | null | undefined): Promise<string> {
  const h = await getHighlighter();
  const loaded = h.getLoadedLanguages() as string[];
  const effective = lang && loaded.includes(lang) ? lang : 'text';
  try {
    return h.codeToHtml(code, { lang: effective as any, theme: 'github-dark' });
  } catch {
    const esc = code.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
    return `<pre><code>${esc}</code></pre>`;
  }
}
