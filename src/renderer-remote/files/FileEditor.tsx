import { useEffect, useMemo, useRef, useState } from 'react';
import type { WireClient } from '../wire';
import { isWriteStaleError } from '../wire';
import { highlightToHtml } from './shiki';
import { langFromPath } from './lang';
import EditorToolbar from './EditorToolbar';
import { useVisualViewport } from '../lib/useVisualViewport';

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

  // Syntax highlight overlay: rendered behind a transparent-text textarea.
  // Re-highlight on idle to avoid blocking input on every keystroke.
  const [highlighted, setHighlighted] = useState<string>('');
  const lang = useMemo(() => langFromPath(path) ?? null, [path]);
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      void highlightToHtml(content, lang).then((html) => {
        if (cancelled) return;
        // Strip Shiki's <pre>/<code> wrappers so the overlay's padding controls
        // alignment with the textarea (otherwise pre's default margin shifts text).
        const stripped = html
          .replace(/<pre[^>]*>/i, '')
          .replace(/<\/pre>\s*$/i, '')
          .replace(/<code[^>]*>/i, '')
          .replace(/<\/code>\s*$/i, '');
        setHighlighted(stripped);
      });
    }, 120);
    return () => { cancelled = true; clearTimeout(t); };
  }, [content, lang]);

  // Scroll sync: pre overlay follows the textarea's scroll position.
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const preRef = useRef<HTMLDivElement | null>(null);
  const onScroll = () => {
    const ta = taRef.current; const pre = preRef.current;
    if (!ta || !pre) return;
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
  };

  /** Insert text at cursor (or replace selection). Updates state + restores focus. */
  const insertAtCursor = (text: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? content.length;
    const end = ta.selectionEnd ?? content.length;
    const next = content.slice(0, start) + text + content.slice(end);
    setContent(next);
    // Restore caret after React re-renders.
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + text.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  /** Move cursor by delta. dy=lines, dx=columns within the current line. */
  const moveCursor = (dx: number, dy: number) => {
    const ta = taRef.current;
    if (!ta) return;
    const pos = ta.selectionStart ?? 0;
    let next = pos;
    if (dy !== 0) {
      const before = content.slice(0, pos);
      const lineStart = before.lastIndexOf('\n') + 1;
      const col = pos - lineStart;
      const lines = content.split('\n');
      let lineIdx = before.split('\n').length - 1;
      lineIdx = Math.max(0, Math.min(lines.length - 1, lineIdx + dy));
      const targetLine = lines[lineIdx] ?? '';
      let offset = 0;
      for (let i = 0; i < lineIdx; i++) offset += lines[i].length + 1;
      next = offset + Math.min(col, targetLine.length);
    } else {
      next = Math.max(0, Math.min(content.length, pos + dx));
    }
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(next, next);
    });
  };

  // iOS Safari: anchor the editor to the visual viewport via position:fixed
  // so the toolbar stays glued above the keyboard with no empty band below.
  // The hook reports both the visible height AND the offsetTop so we follow
  // Safari when it scrolls the layout viewport for caret visibility.
  const { height: vvHeight, offsetTop: vvOffset } = useVisualViewport();

  return (
    <div style={{
      position: 'fixed',
      left: 0,
      right: 0,
      top: vvOffset,
      height: vvHeight,
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      background: 'var(--bg-primary)',
      overflow: 'hidden',
      zIndex: 50,
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

      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {/* Highlight overlay — sits behind the textarea, paints the colors. */}
        <div
          ref={preRef}
          aria-hidden
          dangerouslySetInnerHTML={{ __html: highlighted }}
          style={{
            position: 'absolute', inset: 0,
            padding: 12,
            overflow: 'auto',
            background: 'var(--bg-input)',
            fontFamily: '"Geist Mono", ui-monospace, monospace',
            fontSize: 16,
            lineHeight: 1.5,
            tabSize: 2,
            whiteSpace: 'pre',
            pointerEvents: 'none',
            // Shiki wraps in <pre><code>; flatten margins so positions match the textarea.
          }}
        />
        <textarea
          ref={taRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onScroll={onScroll}
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="text"
          wrap="off"
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            padding: 12,
            background: 'transparent',
            color: 'transparent',
            caretColor: 'var(--text)',
            border: 'none',
            outline: 'none',
            resize: 'none',
            fontFamily: '"Geist Mono", ui-monospace, monospace',
            fontSize: 16,
            lineHeight: 1.5,
            tabSize: 2,
            whiteSpace: 'pre',
          }}
        />
      </div>
      <EditorToolbar
        onTab={() => insertAtCursor('  ')}
        onUp={() => moveCursor(0, -1)}
        onDown={() => moveCursor(0, 1)}
        onLeft={() => moveCursor(-1, 0)}
        onRight={() => moveCursor(1, 0)}
        onHome={() => {
          const ta = taRef.current; if (!ta) return;
          const pos = ta.selectionStart ?? 0;
          const lineStart = content.lastIndexOf('\n', pos - 1) + 1;
          requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(lineStart, lineStart); });
        }}
        onEnd={() => {
          const ta = taRef.current; if (!ta) return;
          const pos = ta.selectionStart ?? 0;
          const nextNewline = content.indexOf('\n', pos);
          const lineEnd = nextNewline === -1 ? content.length : nextNewline;
          requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(lineEnd, lineEnd); });
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
