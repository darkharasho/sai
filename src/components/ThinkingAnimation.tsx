import { CornerDownRight } from 'lucide-react';
import SaiLogo from './SaiLogo';
import { useThinkingDriver } from './Chat/useThinkingDriver';

interface ThinkingAnimationProps {
  color?: string;
  /** Secondary status explaining a silent pause (subagent progress,
   *  thinking-token count, API retry backoff, context compaction). Rendered as
   *  its own quiet sub-line under the animated row — never inline with the
   *  typewriter, whose width changes every frame. Hints shaped "kind · detail"
   *  get a small uppercase kind chip; anything else renders as plain detail. */
  hint?: string | null;
}

export default function ThinkingAnimation({ color, hint }: ThinkingAnimationProps = {}) {
  const { saiAnimationEnabled, chainMode, displayText, clockText, Icon } = useThinkingDriver();

  // "agent · Reading foo.ts" → chip "agent" + detail; "authenticating…" → detail only.
  const sep = hint ? hint.indexOf(' · ') : -1;
  const hintKind = hint && sep > 0 ? hint.slice(0, sep) : null;
  const hintDetail = hint && sep > 0 ? hint.slice(sep + 3) : hint;

  return (
    <div className="thinking-wrap">
      <div className="thinking-animation" style={color ? { color } : undefined}>
        {saiAnimationEnabled
          ? <SaiLogo mode={chainMode} size={18} className="thinking-icon" color={color || '#c7913b'} />
          : <Icon size={16} className="thinking-icon" style={color ? { color } : undefined} />}
        {saiAnimationEnabled && (
          <span className="thinking-clock">[{clockText}]</span>
        )}
        <span className="thinking-text" style={color ? { color } : undefined}>
          {/* Shimmer only without a color override — the shimmer gradient would
              discard the caller's custom color. */}
          <span className={color ? undefined : 'sai-shimmer'}>{displayText}</span>
          {saiAnimationEnabled
            ? <span className="thinking-cursor thinking-cursor-block" style={color ? { backgroundColor: color } : undefined} />
            : <>
                <span className="thinking-cursor thinking-cursor-breathing" style={color ? { color } : undefined}>|</span>
                ...
              </>}
        </span>
      </div>
      {hint && (
        // Keyed by text: a changed hint re-mounts the line so it fades in.
        <div key={hint} className="thinking-hint-line" data-testid="thinking-hint">
          <CornerDownRight size={12} className="thinking-hint-arrow" aria-hidden />
          {hintKind && <span className="thinking-hint-kind">{hintKind}</span>}
          <span className="thinking-hint-detail">{hintDetail}</span>
        </div>
      )}
      <style>{`
        .thinking-hint-line {
          display: flex;
          align-items: center;
          gap: 6px;
          /* Align under the typewriter: row padding (14) + logo (18) + gap (8). */
          padding: 0 14px 10px 40px;
          margin-top: -4px;
          font-size: 12px;
          color: var(--text-muted);
          animation: thinking-hint-in .2s ease-out;
        }
        .thinking-hint-arrow {
          flex-shrink: 0;
          color: color-mix(in srgb, var(--accent) 55%, transparent);
        }
        .thinking-hint-kind {
          flex-shrink: 0;
          font-size: 9.5px;
          font-weight: 600;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          color: color-mix(in srgb, var(--accent) 80%, transparent);
          border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
          border-radius: 4px;
          padding: 1px 5px;
        }
        .thinking-hint-detail {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        @keyframes thinking-hint-in {
          from { opacity: 0; transform: translateY(2px); }
          to { opacity: 1; transform: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .thinking-hint-line { animation: none; }
        }
      `}</style>
    </div>
  );
}
