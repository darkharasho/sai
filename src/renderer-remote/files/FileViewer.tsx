import { useEffect, useState } from 'react';
import { highlightToHtml } from './shiki';
import { isImage } from './lang';
import type { WireClient } from '../wire';
import FileEditor from './FileEditor';

interface Props {
  client: WireClient;
  cwd: string;
  path: string;
  content?: string;
  signedUrl?: string;
  encoding: 'text' | 'binary';
  size: number;
  lang?: string;
  mime?: string;
  mtime?: number;
  sha?: string;
  /** Re-fetch from the bridge and replace the current viewer state. Called after a successful save. */
  onRefetch?: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function FileViewer(props: Props) {
  const { path, content, signedUrl, encoding, size, lang, mime } = props;
  const [html, setHtml] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'edit'>('view');

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

  const editable = encoding === 'text' && size <= 256 * 1024 && !signedUrl
    && typeof content === 'string' && typeof props.mtime === 'number' && typeof props.sha === 'string';

  if (mode === 'edit' && editable) {
    return (
      <FileEditor
        client={props.client}
        cwd={props.cwd}
        path={props.path}
        initialContent={content!}
        initialMtime={props.mtime!}
        initialSha={props.sha!}
        onSave={() => { setMode('view'); props.onRefetch?.(); }}
        onCancel={() => setMode('view')}
      />
    );
  }

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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
        {editable && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={() => setMode('edit')}
              style={{ padding: '4px 10px', background: 'var(--bg-elevated)', color: 'var(--text)',
                       border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
            >Edit</button>
          </div>
        )}
        <pre style={{ margin: 0, color: 'var(--text-muted)', fontSize: 12 }}>
          {content ?? ''}
        </pre>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
      {editable && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => setMode('edit')}
            style={{ padding: '4px 10px', background: 'var(--bg-elevated)', color: 'var(--text)',
                     border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
          >Edit</button>
        </div>
      )}
      <div
        style={{
          margin: 0,
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
    </div>
  );
}
