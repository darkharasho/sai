import type { LoadGuardChatEvent, LoadGuardTopUser } from '../../types';

// Events are persisted with chat history, so every rendered value is coerced:
// a non-string reaching string ops once blanked the whole app.
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const gb = (kb: unknown) => (num(kb) / 1024 / 1024).toFixed(1);
const NOTE_PREFIX = /^\[SAI system load:[^\]]*\]\s*/;

export default function LoadGuardEventCard({ event }: { event: LoadGuardChatEvent }) {
  if (event?.kind === 'note') {
    return (
      <div className="lg-card lg-card-note" data-testid="load-guard-card">
        <Callout title="System load:" text={str(event.text).replace(NOTE_PREFIX, '')} />
        <style>{CSS}</style>
      </div>
    );
  }

  // Unknown or future kinds (persisted history) render nothing, never a fake Stopped card.
  if (event?.kind !== 'killed') return null;
  const ev = event;
  const isAgent = ev?.unitKind === 'agent';
  const top: LoadGuardTopUser[] = Array.isArray(ev?.top) ? ev.top : [];
  const body = `SAI stopped this to keep your PC from freezing. It was using ${gb(ev?.sizeKb)} GB while RAM hit ${Math.round(num(ev?.memUsedPct))}%.`
    + (isAgent ? ' This chat will pick up where it left off when you send your next message.' : '');

  return (
    <div className="lg-card lg-card-killed" data-testid="load-guard-card">
      <div className="lg-card-title">
        <span className="lg-card-tag">Stopped</span>
        {isAgent && <span className="lg-card-title-text">Stopped to save your PC</span>}
        <s className="lg-card-label">{str(ev?.label)}</s>
      </div>
      <div className="lg-card-body">{body}</div>
      {top.length > 0 && (
        <ul className="lg-card-top">
          {top.map((u, i) => (
            <li key={i} className={u?.owner === 'sai-ai' ? 'lg-card-top-sai' : undefined}>
              <span className="lg-card-top-label">{str(u?.label)}{u?.owner === 'sai-ai' ? ' (SAI)' : ''}</span>
              <span>{gb(u?.sizeKb)} GB</span>
            </li>
          ))}
        </ul>
      )}
      <Callout title="Told the AI:" text={str(ev?.toldAi)} />
      <style>{CSS}</style>
    </div>
  );
}

function Callout({ title, text }: { title: string; text: string }) {
  return (
    <div className="lg-card-callout">
      <span className="lg-card-callout-title">{title}</span> <span className="lg-card-callout-text">{text}</span>
    </div>
  );
}

const CSS = `
  .lg-card {
    margin: 4px 0;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-hairline);
    background: var(--surface-2);
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    font-size: 12px;
    color: var(--text-secondary, var(--text));
  }
  .lg-card-killed { border-left: 3px solid var(--red); }
  .lg-card-note { padding: 6px 12px; }
  .lg-card-title { display: flex; align-items: center; gap: 8px; min-width: 0; color: var(--text); font-weight: 600; }
  .lg-card-tag {
    flex-shrink: 0;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--red);
    background: color-mix(in srgb, var(--red) 14%, transparent);
  }
  .lg-card-label, .lg-card-title-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lg-card-label { color: var(--text-muted); font-family: var(--font-mono, monospace); font-weight: 400; }
  .lg-card-top { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .lg-card-top li { display: flex; justify-content: space-between; gap: 12px; color: var(--text-muted); }
  .lg-card-top-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lg-card-top li.lg-card-top-sai { color: var(--red); }
  .lg-card-callout {
    padding: 4px 8px;
    border-radius: 6px;
    background: var(--surface-3, var(--bg-secondary));
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .lg-card-callout-title { font-weight: 600; color: var(--text); }
`;
