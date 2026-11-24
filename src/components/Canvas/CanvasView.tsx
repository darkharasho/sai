import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, ChevronDown, Pencil, Plus, User, X } from 'lucide-react';
import './canvas.css';
import {
  splitBlocks, replaceBlock, toggleTask, markTaskFailed, addTaskNote, canvasTitle, blockName, blockShape, taskItems,
  type CanvasBlock, type TaskState,
} from '../../canvas/canvasBlocks';
import { mergeBlocks } from '../../canvas/canvasMerge';
import type { CanvasStore, CanvasState } from '../../canvas/canvasStore';
import { parseStats, checklistTotals, resolveStat, type StatTile } from '../../canvas/canvasStats';
import { prepareCanvasDiagram } from '../../canvas/canvasMermaid';
import { AGENT_MARK_TTL_MS, blockMark, itemMark, type AgentMarks, type MarkKind } from '../../canvas/canvasAgentMarks';
import { CANVAS_IDLE_MS } from '../../canvas/useCanvasDelivery';
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
  /** Changes waiting for the target chat (store.pendingChangeCount). */
  pendingCount?: number;
  /** The target chat is this canvas's auto-send target (store.isAutoTarget). Default true. */
  autoTarget?: boolean;
  onSendNow(): void;
  onHoldToggle(): void;
  onOpenSource(): void;
  onOpenCanvas(path: string): void;
}

export function relativeTime(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(at).toLocaleDateString();
}

/** A relative time that keeps itself current (1 s ticks for the first minute, then 30 s). */
function Ago({ at }: { at: number }) {
  const [now, setNow] = useState(() => Date.now());
  const fresh = now - at < 60_000;
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), fresh ? 1000 : 30_000);
    return () => clearInterval(t);
  }, [fresh]);
  return <>{relativeTime(at, now)}</>;
}

const fileName = (p: string) => p.replace(/^.*\//, '');
const fileSlug = (p: string) => fileName(p).replace(/\.md$/, '');

function fenceBody(source: string): string {
  return source.replace(/^\s*```[^\n]*\n/, '').replace(/\n?```\s*$/, '');
}

/** The theme accent as a literal colour (mermaid classDefs can't use CSS variables). */
export function currentAccent(): string {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
}

/**
 * The live accent: re-read when the root's inline style/class/theme attributes change
 * (applyAccent writes the accent vars onto <html>'s style).
 */
export function useThemeAccent(): string {
  const [accent, setAccent] = useState(currentAccent);
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    const obs = new MutationObserver(() => setAccent(currentAccent()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
    return () => obs.disconnect();
  }, []);
  return accent;
}

function textOf(node: any): string {
  if (!node) return '';
  if (node.type === 'text') return node.value ?? '';
  return Array.isArray(node.children) ? node.children.map(textOf).join('') : '';
}

/** Table-cell status: Pass/Fail/Blocked get a coloured dot; "Not run"-ish a dim one. */
export function cellStatus(text: string): 'ok' | 'bad' | 'dim' | null {
  const t = text.trim();
  if (/^(pass|passed|ok)$/i.test(t)) return 'ok';
  if (/^(fail|failed)$/i.test(t) || /^blocked\b/i.test(t)) return 'bad';
  if (/^(not run|skipped|pending|n\/a)$/i.test(t)) return 'dim';
  return null;
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
  td: ({ node, children, style }: { node?: any; children?: ReactNode; style?: CSSProperties }) => {
    const text = textOf(node).trim();
    const status = cellStatus(text);
    const dim = !status && /^[—–-]+$/.test(text);
    const num = !status && /^[$€£]?[\d.,]+[%kKmM]?$/.test(text);
    const cls = status ? `canvas-cell canvas-cell--${status}` : dim ? 'canvas-cell canvas-cell--dim' : num ? 'canvas-cell canvas-cell--num' : undefined;
    return (
      <td style={style} className={cls}>
        {status && <span className="canvas-dot" aria-hidden />}
        {children}
      </td>
    );
  },
};

const Md = ({ children }: { children: string }) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={mdComponents}>{children}</ReactMarkdown>
);

/** Inline-only components for a checklist label: a label may not hold block content. */
const inlineMdComponents = { ...mdComponents, p: ({ children }: { children?: ReactNode }) => <>{children}</> };

/**
 * A checklist label as inline Markdown (links, `code`, **bold**): same safe pipeline as Md, no
 * rehype-raw. A link is interactive content, so the label doesn't forward its click to the checkbox;
 * the `a` override's preventDefault (it opens externally) cancels label activation as well.
 */
const InlineMd = ({ children }: { children: string }) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]} components={inlineMdComponents}>{children}</ReactMarkdown>
);

function AgentMeta({ kind, at }: { kind: MarkKind; at: number }) {
  return (
    <div className="canvas-agent-meta">
      <span className="canvas-glyph canvas-glyph--agent" aria-hidden>✦</span>
      {kind} by agent · <Ago at={at} />
    </div>
  );
}

interface Marks {
  marks: AgentMarks | null;
  at: number;
}

function Checklist({ block, marks, onToggle, onFail, onNote }: {
  block: CanvasBlock;
  marks: Marks;
  onToggle: (item: number) => void;
  onFail: (item: number) => void;
  onNote: (item: number, note: string) => void;
}) {
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [note, setNote] = useState('');
  return (
    <ul className="canvas-checklist">
      {taskItems(block.source).map((it, i) => {
        const id = `canvas-task-${block.index}-${i}`;
        const [first, ...rest] = it.text.split('\n');
        const mark = itemMark(marks.marks, block.index, i);
        const tone = it.state === 'failed' ? 'bad' : it.state === 'done' ? 'ok' : 'neutral';
        return (
          <li key={i} className={`canvas-task canvas-task--${it.state}${mark ? ' canvas-agent-edge' : ''}`}>
            <div className="canvas-task__row">
              <CheckBox id={id} state={it.state} onChange={() => onToggle(i)} />
              <label htmlFor={id} className="canvas-task__label"><InlineMd>{first}</InlineMd></label>
              <span className="canvas-task__actions">
                <button type="button" className="canvas-btn canvas-btn--ghost" onClick={() => { setNoteFor(i); setNote(''); }}>
                  Add note
                </button>
                {it.state !== 'failed' && (
                  <button type="button" className="canvas-btn canvas-btn--ghost canvas-btn--danger" onClick={() => onFail(i)}>
                    Mark failed
                  </button>
                )}
              </span>
            </div>
            {rest.length > 0 && (
              <div className={`canvas-note canvas-note--${tone}`}>
                {tone === 'ok' && <Check size={13} className="canvas-note__icon" aria-hidden />}
                <div className="canvas-md canvas-note__body"><Md>{rest.join('\n')}</Md></div>
              </div>
            )}
            {mark && <AgentMeta kind={mark} at={marks.at} />}
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
                <button type="button" className="canvas-btn canvas-btn--ghost-visible" onClick={() => setNoteFor(null)}>Cancel</button>
              </form>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** 18px custom box over a real (transparent) checkbox, so labels and a11y stay native. */
function CheckBox({ id, state, onChange }: { id: string; state: TaskState; onChange: () => void }) {
  return (
    <span className={`canvas-check canvas-check--${state}`} title={state === 'failed' ? 'Failed. Click to reset' : undefined}>
      <input id={id} type="checkbox" checked={state === 'done'} onChange={onChange} aria-invalid={state === 'failed' || undefined} />
      {state === 'failed' ? (
        <X size={12} strokeWidth={3} aria-hidden className="canvas-check__glyph" />
      ) : (
        <svg viewBox="0 0 12 12" aria-hidden className="canvas-check__glyph canvas-check__tick">
          <path d="M2.5 6.2 5 8.6 9.6 3.6" />
        </svg>
      )}
    </span>
  );
}

function StatTiles({ block, doc }: { block: CanvasBlock; doc: string }) {
  const tiles = useMemo(() => {
    const totals = checklistTotals(doc);
    return parseStats(block.source).map((s) => resolveStat(s, totals));
  }, [block.source, doc]);
  if (tiles.length === 0) return <div className="canvas-empty-note">Empty stats block</div>;
  return (
    <div className="canvas-stats">
      {tiles.map((t, i) => <Tile key={i} tile={t} />)}
    </div>
  );
}

function Tile({ tile }: { tile: StatTile }) {
  if (tile.kind === 'progress') {
    const pct = tile.total ? Math.round((tile.done / tile.total) * 100) : 0;
    return (
      <div className="canvas-stat canvas-stat--progress">
        <div className="canvas-stat__label">{tile.label}</div>
        <div className="canvas-stat__value">
          {tile.done} <span className="canvas-stat__of">of {tile.total} step{tile.total === 1 ? '' : 's'}</span>
        </div>
        <div className="canvas-stat__bar" role="progressbar" aria-label={tile.label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }
  const tone = tile.kind === 'passed' ? ' canvas-stat__value--ok' : tile.kind === 'failed' ? ' canvas-stat__value--bad' : '';
  const mono = tile.kind === 'text' && tile.mono ? ' canvas-stat__value--mono' : '';
  return (
    <div className="canvas-stat">
      <div className="canvas-stat__label">{tile.label}</div>
      <div className={`canvas-stat__value${tone}${mono}`}>{tile.value}</div>
    </div>
  );
}

/** Page structure: title, subtitle, loose blocks, and one card per `##` section. */
type LayoutNode =
  | { type: 'title'; block: CanvasBlock; text: string }
  | { type: 'subtitle' | 'loose'; block: CanvasBlock }
  | { type: 'section'; heading: CanvasBlock; title: string; body: CanvasBlock[] };

export function layoutCanvas(blocks: CanvasBlock[]): LayoutNode[] {
  const out: LayoutNode[] = [];
  let section: Extract<LayoutNode, { type: 'section' }> | null = null;
  let titled = false;
  let afterTitle = false;
  for (const b of blocks) {
    const shape = b.kind === 'markdown' ? blockShape(b.source) : null;
    const wasAfterTitle = afterTitle;
    afterTitle = false;
    if (shape?.type === 'heading' && shape.depth <= 2) {
      section = null;
      if (shape.depth === 2) {
        section = { type: 'section', heading: b, title: shape.text, body: [] };
        out.push(section);
        titled = true; // a title after the first section is just a heading
        continue;
      }
      if (!titled) {
        titled = true;
        afterTitle = true;
        out.push({ type: 'title', block: b, text: shape.text });
        continue;
      }
      out.push({ type: 'loose', block: b });
      continue;
    }
    if (section) section.body.push(b);
    else if (wasAfterTitle && shape?.type === 'paragraph') out.push({ type: 'subtitle', block: b });
    else out.push({ type: 'loose', block: b });
  }
  return out;
}

function sectionInfo(body: CanvasBlock[]) {
  let done = 0;
  let total = 0;
  const tags = new Set<string>();
  for (const b of body) {
    if (b.kind === 'checklist') {
      tags.add('checklist');
      for (const it of taskItems(b.source)) {
        total += 1;
        if (it.state === 'done') done += 1;
      }
    } else if (b.kind === 'mermaid') tags.add('diagram');
    else if (b.kind === 'html') tags.add('widget');
    else if (b.kind === 'markdown' && blockShape(b.source).type === 'table') tags.add('table');
  }
  return { done, total, tags: [...tags] };
}

function CanvasPicker({ list, current, onOpen }: { list: CanvasState[]; current: string; onOpen: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="canvas-picker" ref={ref}>
      <button type="button" className="canvas-picker__btn" aria-label="Canvases" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Canvases <ChevronDown size={12} aria-hidden />
      </button>
      {open && (
        <div className="canvas-picker__menu" role="menu">
          {list.map((c) => (
            <button
              key={c.path}
              type="button"
              role="menuitem"
              className={`canvas-picker__item${c.path === current ? ' canvas-picker__item--current' : ''}`}
              onClick={() => { setOpen(false); onOpen(c.path); }}
            >
              <span className="canvas-picker__title">{canvasTitle(c.content, fileSlug(c.path))}</span>
              <span className="canvas-picker__file">{fileName(c.path)}</span>
            </button>
          ))}
          {list.length === 0 && <div className="canvas-picker__empty">No canvases</div>}
        </div>
      )}
    </div>
  );
}

/** Pie that drains as the auto-send countdown runs out. */
function CountdownPie({ secs }: { secs: number }) {
  const total = Math.max(1, Math.round(CANVAS_IDLE_MS / 1000));
  const frac = Math.min(1, Math.max(0, secs / total));
  return <span className="canvas-pie" aria-hidden style={{ ['--pie' as string]: `${Math.round(frac * 360)}deg` }} />;
}

const changes = (n: number) => (n > 0 ? `${n} change${n === 1 ? '' : 's'}` : 'changes');

/** Keyed by path so editor/draft/pending state never leaks between canvases. */
export default function CanvasView(props: CanvasViewProps) {
  return <CanvasViewInner key={props.path} {...props} />;
}

function CanvasViewInner(props: CanvasViewProps) {
  const { path, store, agentStatus, sendIn, pending, pendingCount = 0, autoTarget = true, onSendNow, onHoldToggle, onOpenSource, onOpenCanvas } = props;
  const state = useSyncExternalStore(store.subscribe, () => store.get(path));
  const list = useSyncExternalStore(store.subscribe, () => store.list());
  const { pendingDoc, apply, latest, error } = usePendingWrites(path, store);
  const [editing, setEditing] = useState<{ index: number; base: string } | null>(null);
  const accent = useThemeAccent();

  const doc = pendingDoc ?? state?.content ?? '';
  const blocks = useMemo(() => splitBlocks(doc), [doc]);
  const layout = useMemo(() => layoutCanvas(blocks), [blocks]);

  // Agent-change marks expire 10 minutes after the agent's write: re-render then.
  const agentAt = state?.agentEditedAt ?? 0;
  const [, setExpired] = useState(0);
  const markLive = !!state?.agentMarks && Date.now() - agentAt < AGENT_MARK_TTL_MS;
  useEffect(() => {
    if (!markLive) return;
    const t = setTimeout(() => setExpired((n) => n + 1), Math.max(0, agentAt + AGENT_MARK_TTL_MS - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [markLive, agentAt]);

  if (!state) return <div className="canvas-view canvas-view--empty">This canvas was deleted.</div>;

  // Marks index the store's content; while a user write is pending the user is editing, so hide them.
  const marks: Marks = { marks: markLive && pendingDoc === null ? state.agentMarks : null, at: agentAt };
  const conflictAt = (i: number) => state.conflicts.find((c) => c.index === i);

  const commitEdit = (index: number, base: string, draft: string) => {
    const draftDoc = replaceBlock(base, index, draft);
    apply((cur) => {
      const r = mergeBlocks(base, draftDoc, cur);
      return { doc: r.merged, conflicts: r.conflicts };
    });
    setEditing(null);
  };

  const addSection = () => {
    apply((md) => {
      const head = md.replace(/\s*$/, '');
      return `${head}${head ? '\n\n' : ''}## New section\n\n- [ ] First step\n`;
    });
  };

  let pill: ReactNode = null;
  if (sendIn !== null) {
    pill = (
      <span className="canvas-pill canvas-pill--sending">
        <CountdownPie secs={sendIn} />
        <span className="canvas-pill__text">Sending your {changes(pendingCount)} in {sendIn}s</span>
        <button type="button" className="canvas-pill__primary" onClick={onSendNow}>Send now</button>
        <button type="button" className="canvas-pill__btn" onClick={onHoldToggle}>Hold</button>
      </span>
    );
  } else if (!state.autoSend && pending) {
    pill = (
      <span className="canvas-pill canvas-pill--held">
        <span className="canvas-pill__text">Held · {changes(pendingCount)} waiting</span>
        <button type="button" className="canvas-pill__primary" onClick={onSendNow}>Send</button>
      </span>
    );
  } else if (pending && !autoTarget) {
    // Another chat owns this canvas: never auto-sent here, only on request.
    pill = (
      <span className="canvas-pill canvas-pill--quiet">
        <span className="canvas-pill__text">Not sent to this chat</span>
        <button type="button" className="canvas-pill__primary" onClick={onSendNow}>Send to this chat</button>
      </span>
    );
  } else if (pending && agentStatus === 'busy') {
    pill = (
      <span className="canvas-pill canvas-pill--waiting">
        <span className="canvas-pill__spinner" aria-hidden />
        <span className="canvas-pill__text">Will send when agent is free</span>
      </span>
    );
  } else if (!state.autoSend) {
    pill = <button type="button" className="canvas-pill canvas-pill--off" onClick={onHoldToggle}>Auto-send off</button>;
  }

  const renderBody = (b: CanvasBlock): ReactNode => {
    if (b.kind === 'checklist') {
      return (
        <Checklist
          block={b}
          marks={marks}
          onToggle={(i) => apply((md) => toggleTask(md, b.index, i))}
          onFail={(i) => apply((md) => markTaskFailed(md, b.index, i))}
          onNote={(i, n) => apply((md) => addTaskNote(md, b.index, i, n))}
        />
      );
    }
    if (b.kind === 'mermaid') {
      return <div className="canvas-diagram"><MermaidRender diagram={prepareCanvasDiagram(fenceBody(b.source), accent)} /></div>;
    }
    if (b.kind === 'html') return <CanvasHtml block={b} onEmit={(data) => store.userEmit(path, blockName(blocks, b.index), data)} />;
    if (b.kind === 'stats') return <StatTiles block={b} doc={doc} />;
    return <div className="canvas-md"><Md>{b.source}</Md></div>;
  };

  /** One block: edit button, body (or the editor), agent marker, conflict bar. */
  const renderBlock = (b: CanvasBlock, cls: string, body: ReactNode = renderBody(b), extra?: ReactNode) => {
    const conflict = conflictAt(b.index);
    const mark = blockMark(marks.marks, b.index);
    return (
      <div key={b.index} className={`canvas-block canvas-block--${b.kind} ${cls}${mark ? ' canvas-agent-edge' : ''}`}>
        {editing?.index === b.index ? (
          <CanvasBlockEditor
            block={b}
            accent={accent}
            onCommit={(draft) => commitEdit(b.index, editing.base, draft)}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <>
            {body}
            {extra}
            <button
              type="button"
              className="canvas-block__edit"
              aria-label={`Edit block ${b.index + 1}`}
              title="Edit block"
              onClick={() => setEditing({ index: b.index, base: latest() ?? doc })}
            >
              <Pencil size={12} />
            </button>
          </>
        )}
        {mark && editing?.index !== b.index && <AgentMeta kind={mark} at={marks.at} />}
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
      </div>
    );
  };

  const title = canvasTitle(doc, fileSlug(path));
  const rel = /\/(\.sai\/canvas\/)([^/]+)$/.exec(path);

  return (
    <div className="canvas-view">
      <header className="canvas-header">
        <div className="canvas-header__id">
          <div className="canvas-crumb">
            {rel ? rel[1] : ''}<span className="canvas-crumb__file">{rel ? rel[2] : fileName(path)}</span>
          </div>
          <h2 className="canvas-title">{title}</h2>
        </div>
        <div className="canvas-meta">
          {state.agentEditedAt > 0 && (
            <span className="canvas-meta__who">
              <span className="canvas-glyph canvas-glyph--agent" aria-hidden>✦</span>
              Agent edited <Ago at={state.agentEditedAt} />
            </span>
          )}
          {state.agentEditedAt > 0 && state.userEditedAt > 0 && <span className="canvas-meta__sep">·</span>}
          {state.userEditedAt > 0 && (
            <span className="canvas-meta__who">
              <span className="canvas-glyph canvas-glyph--user" aria-hidden><User size={9} strokeWidth={2.5} /></span>
              you <Ago at={state.userEditedAt} />
            </span>
          )}
        </div>
        <div className="canvas-header__right">
          {pill}
          <CanvasPicker list={list} current={path} onOpen={onOpenCanvas} />
          <div className="canvas-seg" role="group" aria-label="View">
            <button type="button" className="canvas-seg__btn canvas-seg__btn--on" aria-pressed="true">Canvas</button>
            <button type="button" className="canvas-seg__btn" aria-pressed="false" onClick={onOpenSource}>Source</button>
          </div>
        </div>
      </header>
      {error && <div className="canvas-error" role="alert">Couldn't save canvas: {error}</div>}
      <div className="canvas-scroll">
        <div className="canvas-page">
          {layout.map((n) => {
            if (n.type === 'title') {
              return renderBlock(n.block, 'canvas-page-title', <h1 className="canvas-h1">{n.text}</h1>);
            }
            if (n.type !== 'section') return renderBlock(n.block, n.type === 'subtitle' ? 'canvas-subtitle' : 'canvas-loose');
            const info = sectionInfo(n.body);
            const pct = info.total ? Math.round((info.done / info.total) * 100) : 0;
            const tags = info.tags.map((t) => <span key={t} className="canvas-tag">{t}</span>);
            return (
              <section key={`s${n.heading.index}`} className="canvas-card" aria-label={n.title}>
                {renderBlock(
                  n.heading,
                  'canvas-card__head',
                  <>
                    <h3 className="canvas-card__title">{n.title}</h3>
                    {info.total > 0 && (
                      <span className="canvas-card__count">
                        {info.done} / {info.total}
                        <span className="canvas-minibar" aria-hidden><span style={{ width: `${pct}%` }} /></span>
                      </span>
                    )}
                    {tags.length > 0 && <span className={`canvas-card__tags${info.total > 0 ? ' canvas-card__tags--end' : ''}`}>{tags}</span>}
                  </>,
                )}
                {n.body.length > 0 && (
                  <div className="canvas-card__body">
                    {n.body.map((b) => renderBlock(b, 'canvas-card__block'))}
                  </div>
                )}
              </section>
            );
          })}
          <button type="button" className="canvas-add" onClick={addSection}>
            <Plus size={12} aria-hidden /> Add section
          </button>
        </div>
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
