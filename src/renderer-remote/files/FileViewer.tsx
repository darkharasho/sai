import { useEffect, useState } from 'react';
import { highlightToHtml } from './shiki';
import { isImage } from './lang';

interface Props {
  cwd: string;
  path: string;
  content?: string;
  signedUrl?: string;
  encoding: 'text' | 'binary';
  size: number;
  lang?: string;
  mime?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function FileViewer({ path, content, signedUrl, encoding, size, lang, mime }: Props) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (encoding === 'text' && content != null) {
      const display = content.length > 50_000 ? content.slice(0, 50_000) + '\n... (truncated)' : content;
      highlightToHtml(display, lang ?? null).then((h) => { if (!cancelled) setHtml(h); });
    } else {
      setHtml(null);
    }
    return () => { cancelled = true; };
  }, [content, encoding, lang]);

  if (encoding === 'binary') {
    if (signedUrl && isImage(path)) {
      return (
        <div style={{ padding: 12 }}>
          <img
            src={signedUrl}
            alt={path}
            style={{ maxWidth: '100%', height: 'auto', display: 'block', borderRadius: 8, border: '1px solid var(--border)' }}
          />
        </div>
      );
    }
    return (
      <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13, fontFamily: '"Geist Mono", ui-monospace, monospace' }}>
        Binary file ({mime ?? 'unknown'}, {formatSize(size)})
        {signedUrl && (
          <>
            {' · '}
            <a href={signedUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>open raw</a>
          </>
        )}
      </div>
    );
  }

  if (!html) {
    return (
      <pre style={{ margin: 0, padding: 12, color: 'var(--text-muted)', fontSize: 12 }}>
        {content ?? ''}
      </pre>
    );
  }

  return (
    <div
      style={{
        margin: 0,
        padding: 12,
        background: 'var(--bg-input)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        fontFamily: '"Geist Mono", ui-monospace, monospace',
        fontSize: 12,
        lineHeight: 1.5,
        overflow: 'auto',
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
