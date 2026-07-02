import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import SaiLogo from '../SaiLogo';
import { useThinkingDriver } from './useThinkingDriver';
import { revealWords } from './wordReveal';
import { hasRevealed, markRevealed } from './revealRegistry';
import { prefersReducedMotion, EASING } from './motion';

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const d = Math.floor((ms % 1000) / 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`;
}

const STATUS_BLUR_MS = 250;
// Streaming text on screen at least this long counts as "watched" — anything
// briefer still gets the settle word-reveal.
const WATCHED_MS = 400;

type Phase = 'thinking' | 'morphing' | 'revealed';

interface Props {
  streaming: boolean;
  content: string;
  durationMs?: number;
  /** Message id for the once-per-session reveal registry. When set and the id
   *  has already revealed in a previous mount, remounts (workspace/chat swaps)
   *  render the content statically instead of replaying the animation. */
  messageId?: string;
  children: React.ReactNode;
}

export default function StreamingAssistantHead({ streaming, content, durationMs, messageId, children }: Props) {
  const [phase, setPhase] = useState<Phase>(streaming ? 'thinking' : 'revealed');
  const driver = useThinkingDriver(phase === 'thinking');
  const mdRef = useRef<HTMLDivElement | null>(null);
  const frozenMsRef = useRef<number>(0);
  const revealedRef = useRef(false);
  // Set at settle when the md was hidden until now: it enters with a height
  // grow instead of snapping from 0 to full height in one frame.
  const growMdRef = useRef(false);
  // Two distinct questions, two signals:
  //   shown   — has this text been on screen during streaming? Controls live
  //             display and whether the morph blur may run (blacking out
  //             visible text mid-reply is never OK).
  //   watched — was it on screen long enough (WATCHED_MS) that the user
  //             actually read it arriving? Only watched text skips the settle
  //             word-reveal; a quick burst that flashed up for a moment still
  //             gets its typing sweep. Growth alone was the old signal, and it
  //             misclassified fast bursts as watched — small replies popped in
  //             with no animation at all.
  const mountContentRef = useRef(content);
  // Seed from the registry: a mid-stream remount (workspace/chat swap) of a
  // message whose text was already on screen must keep showing it live, not
  // regress to the thinking row and later re-reveal.
  const alreadySeen = useRef(!!(messageId && hasRevealed(messageId))).current;
  const liveShownRef = useRef(alreadySeen);
  const firstGrowthAtRef = useRef<number | null>(alreadySeen ? 0 : null);
  if (streaming && content && content !== mountContentRef.current) {
    liveShownRef.current = true;
    if (firstGrowthAtRef.current == null) firstGrowthAtRef.current = performance.now();
  }
  const watchedNow = () =>
    firstGrowthAtRef.current != null && performance.now() - firstGrowthAtRef.current >= WATCHED_MS;
  const showLive = streaming && !!content && liveShownRef.current;
  // Once genuinely watched, mark the registry — a swap-away mid-stream must
  // remount as already-seen instead of re-typing text the user read. Sampled
  // per render (the threshold is wall-time and this renders per token), but
  // marked at most once.
  const markedWatchedRef = useRef(false);
  useEffect(() => {
    if (markedWatchedRef.current || !messageId) return;
    if (watchedNow()) {
      markedWatchedRef.current = true;
      markRevealed(messageId);
    }
  });

  useEffect(() => {
    // `streaming` is driven by an idle debounce (streamSettled), so it can flip
    // false→true mid-reply on a token pause. Once we've revealed, STAY revealed —
    // never strip already-shown text back to the thinking state (that could strand a
    // reply hidden if the final completion is then guarded out). Before first reveal,
    // a resume just returns to the thinking animation.
    if (streaming) {
      // A resume after a wait re-arms thinking even if we'd revealed: the turn is
      // genuinely active again. Guard so a token-pause streamSettled flip (which
      // also sets streaming true) cannot strip revealed text — only a real wake,
      // signalled by content being empty again at streaming_start, re-enters thinking.
      if (!revealedRef.current) { setPhase('thinking'); return; }
      if (!content) { revealedRef.current = false; setPhase('thinking'); }
      return;
    }
    if (phase === 'revealed') return;
    if (!content) return;
    if (revealedRef.current) return;
    revealedRef.current = true;
    frozenMsRef.current = durationMs ?? driver.elapsedMs;

    // The morph blur transitions the STATUS text away. It must not run when
    // text is already on screen (a 250ms display:none blackout of visible
    // reply text = mid-reply flashing) — shown-but-unwatched text goes
    // straight to revealed and gets its sweep there.
    if (prefersReducedMotion() || liveShownRef.current) { setPhase('revealed'); return; }

    // Coming from a hidden md (status was showing): grow the reply in instead
    // of snapping to full height — the height jump read as "messy".
    growMdRef.current = true;
    setPhase('morphing');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, content]);

  // Complete the morph on a timer keyed ONLY on phase. When this lived in the
  // effect above, a token arriving during the 250ms morph re-ran it: the
  // cleanup cancelled the timer and the re-run bailed on revealedRef, leaving
  // the phase stuck at 'morphing' — and the md is display:none there, so the
  // finished reply rendered as a BLANK message (logo + clock, no text).
  useEffect(() => {
    if (phase !== 'morphing') return;
    const t = setTimeout(() => setPhase('revealed'), STATUS_BLUR_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // Reveal exactly once when we reach the revealed phase. Deliberately NO
  // cancel-on-cleanup: under StrictMode the cleanup would force-complete the reveal
  // (showAll) before the real second run, killing the animation (see commit 34660bf).
  // revealWords self-terminates if the container unmounts (it checks isConnected).
  // useLayoutEffect (not useEffect): the md flips from display:none to visible when we
  // reach 'revealed', so the reveal prep (hiding trailing blocks + words) must run before
  // the browser paints — otherwise the full-height content flashes for a frame, then
  // collapses to the block-by-block reveal. The self-guard keeps it to one run under
  // StrictMode; we still do NOT cancel on cleanup (see note above).
  const revealStartedRef = useRef(false);
  useLayoutEffect(() => {
    if (phase !== 'revealed') return;
    if (revealStartedRef.current) return;
    if (prefersReducedMotion()) return;
    // Once-per-session guard: a remount of an already-revealed message
    // (workspace/chat swap) must show the content statically, not replay the
    // animation. revealStartedRef only survives within one mount.
    if (messageId && hasRevealed(messageId)) return;
    // Text the user WATCHED stream in must not re-animate. A quick burst that
    // was only briefly on screen still sweeps — that's the typing the user
    // expects on short replies.
    if (watchedNow()) {
      revealStartedRef.current = true;
      if (messageId) markRevealed(messageId);
      return;
    }
    const el = mdRef.current;
    if (!el) return;
    revealStartedRef.current = true;
    if (messageId) markRevealed(messageId);
    revealWords(el);
  }, [phase, messageId]);

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
        {phase !== 'revealed' && !showLive && (
          <span className={`sah-status sai-shimmer${phase === 'morphing' ? ' sah-status--gone' : ''}`}>
            {driver.displayText}
            <span className="thinking-cursor thinking-cursor-block" />
          </span>
        )}
        <motion.div
          // Re-key at the reveal so the grow entry starts exactly when the md
          // becomes visible (mounting it earlier would run the animation while
          // still display:none).
          key={phase === 'revealed' && growMdRef.current ? 'md-grow' : 'md'}
          ref={mdRef}
          initial={phase === 'revealed' && growMdRef.current ? { height: 0, opacity: 0 } : false}
          animate={phase === 'revealed' && growMdRef.current ? { height: 'auto', opacity: 1 } : undefined}
          transition={{ duration: 0.24, ease: EASING.out }}
          className={`chat-msg-md sah-md${showLive ? ' sah-md--streaming' : ''}`}
          style={phase === 'revealed' || showLive
            ? (growMdRef.current ? { overflow: 'hidden' } : undefined)
            : { display: 'none' }}
        >
          {children}
        </motion.div>
      </div>
      <style>{`
        .sah-clock { transition: color .45s ease; }
        .sah-clock--done { color: var(--text-muted); }
        .sah-status {
          font-family: 'Departure Mono', 'Geist Mono', 'JetBrains Mono', monospace;
          font-size: 13px; letter-spacing: 0.4px;
          transition: opacity .25s ease, filter .25s ease;
        }
        .sah-status--gone { opacity: 0; filter: blur(2px); }
        /* The shimmer makes the status text color transparent; the block
           cursor draws with currentColor, so give it a real color. */
        .sah-status .thinking-cursor-block { background: var(--accent); }
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
