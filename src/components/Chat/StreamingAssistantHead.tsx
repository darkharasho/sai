import { useEffect, useRef, useState } from 'react';
import SaiLogo from '../SaiLogo';
import { useThinkingDriver } from './useThinkingDriver';
import { revealWords } from './wordReveal';
import { prefersReducedMotion } from './motion';

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const d = Math.floor((ms % 1000) / 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`;
}

const STATUS_BLUR_MS = 250;

type Phase = 'thinking' | 'morphing' | 'revealed';

interface Props {
  streaming: boolean;
  content: string;
  durationMs?: number;
  children: React.ReactNode;
}

export default function StreamingAssistantHead({ streaming, content, durationMs, children }: Props) {
  const [phase, setPhase] = useState<Phase>(streaming ? 'thinking' : 'revealed');
  const driver = useThinkingDriver(phase === 'thinking');
  const mdRef = useRef<HTMLDivElement | null>(null);
  const frozenMsRef = useRef<number>(0);
  const revealedRef = useRef(false);

  useEffect(() => {
    // `streaming` is driven by an idle debounce (streamSettled), so it can flip
    // false→true mid-reply on a token pause. Once we've revealed, STAY revealed —
    // never strip already-shown text back to the thinking state (that could strand a
    // reply hidden if the final completion is then guarded out). Before first reveal,
    // a resume just returns to the thinking animation.
    if (streaming) { if (!revealedRef.current) setPhase('thinking'); return; }
    if (phase === 'revealed') return;
    if (!content) return;
    if (revealedRef.current) return;
    revealedRef.current = true;
    frozenMsRef.current = durationMs ?? driver.elapsedMs;

    if (prefersReducedMotion()) { setPhase('revealed'); return; }

    setPhase('morphing');
    const t = setTimeout(() => setPhase('revealed'), STATUS_BLUR_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, content]);

  // Reveal exactly once when we reach the revealed phase. Deliberately NO
  // cancel-on-cleanup: under StrictMode the cleanup would force-complete the reveal
  // (showAll) before the real second run, killing the animation (see commit 34660bf).
  // revealWords self-terminates if the container unmounts (it checks isConnected).
  const revealStartedRef = useRef(false);
  useEffect(() => {
    if (phase !== 'revealed') return;
    if (revealStartedRef.current) return;
    if (prefersReducedMotion()) return;
    const el = mdRef.current;
    if (!el) return;
    revealStartedRef.current = true;
    revealWords(el);
  }, [phase]);

  const isStatic = phase !== 'thinking';
  const clock = isStatic ? formatMs(durationMs ?? frozenMsRef.current) : driver.clockText;
  // While thinking, always show the live running clock. Once static, only show the
  // duration stamp when there's a real per-segment duration (mirrors the legacy head,
  // which hid the stamp for replies without a durationMs — e.g. complete arrivals).
  const showClock = !isStatic || typeof durationMs === 'number';

  return (
    <div className="chat-msg-content sah-root" data-phase={phase}>
      <SaiLogo
        mode={isStatic ? 'static' : driver.chainMode}
        size={16}
        className="chat-msg-dot chat-msg-sai"
        color="#c7913b"
      />
      <div className="chat-msg-body">
        {showClock && (
          <div className={`chat-msg-duration sah-clock${isStatic ? ' sah-clock--done' : ''}`}>
            [{clock}]
          </div>
        )}
        {phase !== 'revealed' && (
          <span className={`sah-status${phase === 'morphing' ? ' sah-status--gone' : ''}`}>
            {driver.displayText}
            <span className="thinking-cursor thinking-cursor-block" />
          </span>
        )}
        <div
          ref={mdRef}
          className="chat-msg-md sah-md"
          style={phase === 'revealed' ? undefined : { display: 'none' }}
        >
          {children}
        </div>
      </div>
      <style>{`
        .sah-clock { transition: color .45s ease; }
        .sah-clock--done { color: var(--text-muted); }
        .sah-status {
          font-family: 'Departure Mono', 'Geist Mono', 'JetBrains Mono', monospace;
          font-size: 13px; letter-spacing: 0.4px; color: var(--accent);
          transition: opacity .25s ease, filter .25s ease;
        }
        .sah-status--gone { opacity: 0; filter: blur(2px); }
        .sah-root { animation: sah-drop .42s cubic-bezier(.2,.8,.2,1); }
        @keyframes sah-drop { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) {
          .sah-root { animation: none; }
          .sah-status { transition: none; }
        }
      `}</style>
    </div>
  );
}
