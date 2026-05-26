import { useEffect, useMemo, useState } from 'react';
import type { WireClient } from '../wire';

interface Props {
  client: WireClient;
  cwd: string;
  path: string;
  initialContent: string;
  initialMtime: number;
  initialSha: string;
  onSave: (meta: { mtime: number; sha: string }) => void;
  onCancel: () => void;
}

export default function FileEditor(props: Props) {
  const { path, initialContent } = props;
  const [content, setContent] = useState(initialContent);
  const dirty = useMemo(() => content !== initialContent, [content, initialContent]);
  const [mtime, setMtime] = useState(props.initialMtime);
  const [sha, setSha] = useState(props.initialSha);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doSave(force = false) {
    setSaving(true); setError(null);
    try {
      const result = await props.client.writeFile(
        props.cwd, props.path, content,
        force ? null : mtime,
        force ? null : sha,
      );
      setMtime(result.mtime);
      setSha(result.sha);
      setSaving(false);
      props.onSave(result);
    } catch (err: any) {
      setSaving(false);
      // Stale handling lands in Task 10; for now surface a generic error.
      setError(String(err?.message ?? err));
    }
  }

  // iOS PWA: track visualViewport so the editor shrinks above the keyboard.
  const [viewportH, setViewportH] = useState<number | null>(() =>
    typeof window !== 'undefined' && (window as any).visualViewport
      ? (window as any).visualViewport.height : null,
  );
  useEffect(() => {
    const vv = (window as any).visualViewport as VisualViewport | undefined;
    if (!vv) return;
    const onResize = () => setViewportH(vv.height);
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: viewportH ? `${viewportH}px` : '100%',
      maxHeight: viewportH ? `${viewportH}px` : '100%',
      minHeight: 0,
      background: 'var(--bg-primary)',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 8, padding: '8px 12px',
        background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)',
      }}>
        <button
          onClick={() => props.onCancel()}
          style={{ padding: '6px 10px', background: 'transparent', color: 'var(--text)',
                   border: 'none', cursor: 'pointer', fontSize: 14 }}
        >Cancel</button>
        <div style={{
          flex: 1, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)',
          fontFamily: '"Geist Mono", ui-monospace, monospace',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{path}</div>
        <button
          disabled={!dirty || saving}
          onClick={() => { void doSave(false); }}
          style={{
            padding: '6px 12px',
            background: dirty ? 'var(--accent)' : 'var(--bg-elevated)',
            color: dirty ? '#000' : 'var(--text-muted)',
            border: '1px solid var(--border)', borderRadius: 6, cursor: dirty ? 'pointer' : 'not-allowed',
            fontSize: 14,
          }}
        >{saving ? 'Saving…' : 'Save'}</button>
      </div>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        inputMode="text"
        wrap="off"
        style={{
          flex: 1,
          minHeight: 0,
          width: '100%',
          padding: 12,
          background: 'var(--bg-input)',
          color: 'var(--text)',
          border: 'none',
          outline: 'none',
          resize: 'none',
          fontFamily: '"Geist Mono", ui-monospace, monospace',
          fontSize: 13,
          lineHeight: 1.5,
          tabSize: 2,
          whiteSpace: 'pre',
        }}
      />
      {error && (
        <div style={{
          padding: '8px 12px',
          background: 'var(--bg-elevated)', color: 'var(--red, #f88)',
          borderTop: '1px solid var(--border)', fontSize: 12,
        }}>{error}</div>
      )}
    </div>
  );
}
