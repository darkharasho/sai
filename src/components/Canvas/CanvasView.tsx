import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Pencil } from 'lucide-react';
import './canvas.css';
import { splitBlocks, replaceBlock, toggleTask, addTaskNote, canvasTitle, type CanvasBlock } from '../../canvas/canvasBlocks';
import { mergeBlocks } from '../../canvas/canvasMerge';
import type { CanvasStore } from '../../canvas/canvasStore';
import type { RenderEntry } from '../../render/renderStore';
import { RenderedHtml, MermaidRender } from '../Chat/RenderToolCard';
import CanvasBlockEditor from './CanvasBlockEditor';
import { usePendingWrites } from './canvasPending';

export interface CanvasViewProps {
  path: string;
  store: CanvasStore;
  agentStatus: 'idle' | 'busy';
  sendIn: number | null;
  /** The target chat has an unsent update (store.hasPending). */
  pending: boolean;
  /** The target chat is this canvas's auto-send target (store.isAutoTarget). Default true. */
  autoTarget?: boolean;
  onSendNow(): void;
  onHoldToggle(): void;
  onOpenSource(): void;
  onOpenCanvas(path: string): void;
}

export function relativeTime(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(at).toLocaleDateString();
}

const fileSlug = (p: string) => p.replace(/^.*\//, '').replace(/\.md$/, '');

function fenceBody(source: string): string {
  return source.replace(/^\s*```[^\n]*\n/, '').replace(/\n?```\s*$/, '');
}

/**
 * Links open in the system browser: a plain anchor would navigate SAI's own window away.
 * No rehype-raw: raw HTML belongs in ```html blocks, which render sandboxed.
 */
const mdComponents = {
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href) window.sai?.openExternal?.(href);
      }}
    >
      {children}
    </a>
  ),
};

const Md = ({ children }: { children: string }) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={mdComponents}>{children}</ReactMarkdown>
);

interface Item { checked: boolean; text: string }

/** Top-level `- [ ] text` items of a checklist block with their continuation lines. */
function parseItems(source: string): Item[] {
  const items: Item[] = [];
  let indent = -1; // the first item's indent (0-3) marks the top level
  for (const line of source.split('\n')) {
    const m = /^( {0,3})(?:[*+-]|\d+[.)])[ \t]+\[([ xX])\][ \t]*(.*)$/.exec(line);
    if (m && (indent < 0 || m[1].length === indent)) {
      indent = m[1].length;
      items.push({ checked: m[2] !== ' ', text: m[3] });
    } else if (items.length && line.trim()) items[items.length - 1].text += '\n' + line.replace(/^\s{1,4}/, '');
  }
  return items;
}

function Checklist({ block, onToggle, onNote }: {
  block: CanvasBlock;
  onToggle: (item: number) => void;
  onNote: (item: number, note: string) => void;
}) {
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [note, setNote] = useState('');
  return (
    <ul className="canvas-checklist">
      {parseItems(block.source).map((it, i) => {
        const id = `canvas-task-${block.index}-${i}`;
        const [first, ...rest] = it.text.split('\n');
        return (
          <li key={i} className="canvas-task">
            <input id={id} type="checkbox" checked={it.checked} onChange={() => onToggle(i)} />
            <label htmlFor={id}>{first}</label>
            <button type="button" className="canvas-btn canvas-btn--ghost" onClick={() => { setNoteFor(i); setNote(''); }}>
              Add note
            </button>
            {rest.length > 0 && <div className="canvas-task__notes"><Md>{rest.join('\n')}</Md></div>}
            {noteFor === i && (
              <form
                className="canvas-task__noteform"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (note.trim()) onNote(i, note);
                  setNoteFor(null);
                }}
              >
                <input aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
                <button type="submit" className="canvas-btn">Save note</button>
              </form>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Keyed by path so editor/draft/pending state never leaks between canvases. */
export default function CanvasView(props: CanvasViewProps) {
  return <CanvasViewInner key={props.path} {...props} />;
}

function CanvasViewInner(props: CanvasViewProps) {
  const { path, store, agentStatus, sendIn, pending, autoTarget = true, onSendNow, onHoldToggle, onOpenSource, onOpenCanvas } = props;
  const state = useSyncExternalStore(store.subscribe, () => store.get(path));
  const list = useSyncExternalStore(store.subscribe, () => store.list());
  const { pendingDoc, apply, latest, error } = usePendingWrites(path, store);
  const [editing, setEditing] = useState<{ index: number; base: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const doc = pendingDoc ?? state?.content ?? '';
  const blocks = useMemo(() => splitBlocks(doc), [doc]);

  if (!state) return <div className="canvas-view canvas-view--empty">This canvas was deleted.</div>;

  const conflictAt = (i: number) => state.conflicts.find((c) => c.index === i);

  const commitEdit = (index: number, base: string, draft: string) => {
    const draftDoc = replaceBlock(base, index, draft);
    apply((cur) => {
      const r = mergeBlocks(base, draftDoc, cur);
      return { doc: r.merged, conflicts: r.conflicts };
    });
    setEditing(null);
  };

  let pill: ReactNode = null;
  if (sendIn !== null) {
    pill = (
      <span className="canvas-pill">
        Sending to agent in {sendIn}s ·{' '}
        <button type="button" className="canvas-pill__btn" onClick={onSendNow}>Send now</button> ·{' '}
        <button type="button" className="canvas-pill__btn" onClick={onHoldToggle}>Hold</button>
      </span>
    );
  } else if (!state.autoSend && pending) {
    pill = (
      <span className="canvas-pill">
        Held · <button type="button" className="canvas-pill__btn" onClick={onSendNow}>Send</button>
      </span>
    );
  } else if (pending && !autoTarget) {
    // Another chat owns this canvas: never auto-sent here, only on request.
    pill = (
      <span className="canvas-pill">
        Not sent to this chat · <button type="button" className="canvas-pill__btn" onClick={onSendNow}>Send to this chat</button>
      </span>
    );
  } else if (pending && agentStatus === 'busy') {
    pill = <span className="canvas-pill">Will send when agent is free</span>;
  } else if (!state.autoSend) {
    pill = <button type="button" className="canvas-pill canvas-pill__btn" onClick={onHoldToggle}>Auto-send off</button>;
  }

  return (
    <div className="canvas-view">
      <header className="canvas-header">
        <h2 className="canvas-title">{canvasTitle(doc, fileSlug(path))}</h2>
        <span className="canvas-meta">
          last edited by {state.lastEditor === 'user' ? 'you' : 'agent'} · {relativeTime(state.lastEditedAt, now)}
        </span>
        {pill}
        <select
          className="canvas-select"
          aria-label="Canvases"
          value=""
          onChange={(e) => e.target.value && onOpenCanvas(e.target.value)}
        >
          <option value="">Canvases</option>
          {list.map((c) => (
            <option key={c.path} value={c.path}>{canvasTitle(c.content, fileSlug(c.path))}</option>
          ))}
        </select>
        <button type="button" className="canvas-btn" onClick={onOpenSource}>Source</button>
      </header>
      {error && <div className="canvas-error" role="alert">Couldn't save canvas: {error}</div>}
      <div className="canvas-blocks">
        {blocks.map((b) => {
          const conflict = conflictAt(b.index);
          return (
            <section key={b.index} className={`canvas-block canvas-block--${b.kind}`}>
              {editing?.index === b.index ? (
                <CanvasBlockEditor
                  block={b}
                  onCommit={(draft) => commitEdit(b.index, editing.base, draft)}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <>
                  <button
                    type="button"
                    className="canvas-block__edit"
                    aria-label={`Edit block ${b.index + 1}`}
                    title="Edit block"
                    onClick={() => setEditing({ index: b.index, base: latest() ?? doc })}
                  >
                    <Pencil size={12} />
                  </button>
                  {b.kind === 'checklist' ? (
                    <Checklist
                      block={b}
                      onToggle={(i) => apply((md) => toggleTask(md, b.index, i))}
                      onNote={(i, n) => apply((md) => addTaskNote(md, b.index, i, n))}
                    />
                  ) : b.kind === 'mermaid' ? (
                    <MermaidRender diagram={fenceBody(b.source)} />
                  ) : b.kind === 'html' ? (
                    <CanvasHtml block={b} onEmit={(data) => store.userEmit(path, b.label ?? `block ${b.index + 1}`, data)} />
                  ) : (
                    <div className="md-preview-body"><Md>{b.source}</Md></div>
                  )}
                </>
              )}
              {conflict && (
                <div className="canvas-conflict" role="group" aria-label="Conflict">
                  <span>Agent also changed this ·</span>
                  <details>
                    <summary>View agent version</summary>
                    <pre>{conflict.theirs}</pre>
                  </details>
                  <button type="button" className="canvas-btn" onClick={() => void store.resolveConflict(path, b.index, 'ours')}>Keep mine</button>
                  <button type="button" className="canvas-btn" onClick={() => void store.resolveConflict(path, b.index, 'theirs')}>Use agent's</button>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function CanvasHtml({ block, onEmit }: { block: CanvasBlock; onEmit: (data: unknown) => void }) {
  const html = fenceBody(block.source);
  const entry = useMemo<RenderEntry>(
    () => ({
      renderId: `canvas-${block.index}`, kind: 'html', payload: { html },
      title: block.label ?? 'canvas html', width: 0, status: 'ready',
    }),
    [block.index, block.label, html],
  );
  return <RenderedHtml entry={entry} onEmit={onEmit} />;
}
