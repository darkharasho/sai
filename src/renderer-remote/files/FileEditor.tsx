import { useEffect, useMemo, useState } from 'react';
import type { WireClient } from '../wire';
import { isWriteStaleError } from '../wire';

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
  const [conflict, setConflict] = useState<null | { currentMtime: number; currentSha: string }>(null);

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
      if (isWriteStaleError(err)) {
        setConflict({ currentMtime: err.currentMtime, currentSha: err.currentSha });
        return;
      }
      setError(String(err?.message ?? err));
    }
  }

  async function doReload(force = false) {
    if (dirty && !force) {
      if (!confirm('Reloading will discard your unsaved edits. Continue?')) return;
    }
    setConflict(null);
    try {
      const r = await props.client.readFile(props.cwd, props.path);
      if (r.encoding !== 'text' || typeof r.content !== 'string') {
        setError('file is no longer text-editable');
        return;
      }
      setContent(r.content);
      if (typeof r.mtime === 'number') setMtime(r.mtime);
      if (typeof r.sha === 'string') setSha(r.sha);
    } catch (err: any) {
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
      position: 'relative',
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
          onClick={() => {
            if (dirty) {
              if (!confirm('Discard your changes?')) return;
            }
            props.onCancel();
          }}
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
      {conflict && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'flex-end',
          zIndex: 10,
        }} onClick={() => setConflict(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', padding: 16,
              background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)',
              display: 'flex', flexDirection: 'column', gap: 12,
            }}
          >
            <div style={{ fontSize: 14, color: 'var(--text)' }}>
              This file changed on the desktop since you opened it.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => { setConflict(null); void doSave(true); }}
                style={{ padding: '8px 12px', background: 'var(--accent)', color: '#000',
                         border: 'none', borderRadius: 6, cursor: 'pointer' }}
              >Overwrite</button>
              <button
                onClick={() => { void doReload(false); }}
                style={{ padding: '8px 12px', background: 'var(--bg-elevated)', color: 'var(--text)',
                         border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}
              >Reload</button>
              <button
                onClick={() => setConflict(null)}
                style={{ padding: '8px 12px', background: 'transparent', color: 'var(--text-muted)',
                         border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}
              >Keep editing</button>
            </div>
          </div>
        </div>
      )}
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
