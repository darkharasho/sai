import { useEffect, useRef, useState } from 'react';
import SaiLogo, { type SaiLogoMode } from './SaiLogo';

// Mirrors src/components/ThinkingAnimation.tsx so the PWA's thinking
// indicator looks and feels the same as the desktop's. Excludes the
// `saiAnimationEnabled` settings hook and the fallback lucide spinner
// path — the PWA always runs in full-animation mode.

const CHAIN_POOL: Array<{ mode: SaiLogoMode; dur: number }> = [
  { mode: 'pulse',       dur: 2400 },
  { mode: 'scatter',     dur: 4800 },
  { mode: 'wave',        dur: 2600 },
  { mode: 'glitch',      dur: 2400 },
  { mode: 'inhale',      dur: 5400 },
  { mode: 'vortex',      dur: 5000 },
  { mode: 'pendulum',    dur: 3600 },
  { mode: 'comet',       dur: 4800 },
  { mode: 'ripple',      dur: 2600 },
  { mode: 'clockwork',   dur: 8000 },
  { mode: 'stutter',     dur: 6200 },
  { mode: 'flip',        dur: 4000 },
  { mode: 'typewriter',  dur: 3000 },
  { mode: 'morse',       dur: 3500 },
  { mode: 'squish',      dur: 2200 },
  { mode: 'bloom',       dur: 3600 },
  { mode: 'searchlight', dur: 3400 },
];

function sampleChain(n: number): typeof CHAIN_POOL {
  const shuffled = CHAIN_POOL.slice().sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

const THINKING_WORDS = [
  // mission-control / NASA
  'ESTABLISHING UPLINK', 'TRIANGULATING', 'CALIBRATING', 'TRACING SIGNAL',
  'ALIGNING VECTORS', 'MAPPING TOPOLOGY', 'LOCKING TELEMETRY', 'SYNCHRONIZING CLOCKS',
  'PRESSURIZING CABIN', 'VENTING COOLANT', 'PURGING MANIFOLDS', 'ARMING THRUSTERS',
  'DEPLOYING ANTENNA', 'STAGING BOOSTERS', 'CHECKING TELEMETRY', 'RUNNING DIAGNOSTICS',
  'CYCLING LIFE-SUPPORT', 'NEGOTIATING ORBIT', 'STAGING PAYLOAD', 'AWAITING GO/NO-GO',
  'SPINNING UP GYROS', 'SETTLING PROPELLANT', 'POLLING GROUND STATIONS', 'BURN COMPLETE',
  // cyberpunk / netrunner
  'JACKING IN', 'DECRYPTING TOKENS', 'SCRAPING CACHE', 'BREACHING ICE',
  'SPOOFING HANDSHAKE', 'ROUTING THROUGH PROXY', 'BURNING CYCLES', 'OVERCLOCKING CORE',
  'COMPILING SHELLCODE', 'CHASING DAEMONS', 'GHOSTING TRACE', 'FORGING PACKETS',
  'BYPASSING FIREWALL', 'TRACING NEURAL LINK', 'SLOTTING CHROME', 'DUMPING REGISTERS',
  'BLEEDING ENTROPY', 'SCANNING CHANNELS', 'PRYING SOCKETS', 'POISONING DNS',
  'DODGING HONEYPOTS', 'PIVOTING THROUGH RELAY', 'SCRUBBING LOGS', 'WIRING NEUROCABLE',
  // starship-computer / TNG
  'ACCESSING DATABANK', 'CROSS-REFERENCING', 'EXTRAPOLATING', 'COMPUTING VECTORS',
  'RESOLVING INTENT', 'INDEXING MEMORY', 'COMPILING THOUGHT', 'CONSULTING ARCHIVES',
  'PARSING SIGNAL', 'SYNTHESIZING',
  'POLARIZING HULL PLATING', 'ROUTING POWER', 'REVERSING POLARITY', 'MODULATING SHIELDS',
  'RECALIBRATING SENSORS', 'HAILING FREQUENCIES', 'SCANNING SUBSPACE', 'PARSING UNIVERSAL TRANSLATOR',
  'CONSULTING SHIP COMPUTER', 'ENGAGING HEURISTICS', 'WIDENING APERTURE', 'BOOSTING GAIN',
  // arcane / occult
  'CONSULTING THE ENTRAILS', 'CASTING RUNES', 'SCRYING THE BASIN', 'TRANSCRIBING SIGILS',
  'SUMMONING DAEMONS', 'BANISHING NULLS', 'DIVINING INTENT', 'CHANNELING SPIRITS',
  'BINDING ELEMENTALS', 'INKING WARDS', 'TURNING TAROT', 'INVOKING THE MUSE',
  // submarine / sonar
  'PINGING SONAR', 'TRIMMING BALLAST', 'RIGGING FOR QUIET', 'SOUNDING DEPTH',
  'PLOTTING HEADING', 'TRACKING CONTACT', 'BLOWING NEGATIVE', 'MAKING TURNS',
  // alchemy / lab
  'TITRATING REAGENTS', 'BALANCING EQUATIONS', 'CENTRIFUGING SAMPLES', 'STAINING SLIDES',
  'GROWING CULTURES', 'CALCINATING ORE', 'CRYSTALLIZING SOLUTE', 'DECANTING SUPERNATANT',
  // detective / noir
  'CHASING LEADS', 'RUNNING THE PLATES', 'DUSTING FOR PRINTS', 'TAILING THE SUSPECT',
  'PIECING TOGETHER ALIBIS', 'BAGGING EVIDENCE', 'STAKING OUT THE BLOCK', 'CROSS-EXAMINING',
  // monastic / scriptorium
  'ILLUMINATING MARGINALIA', 'TRANSCRIBING CODICES', 'CONSULTING THE TOMES', 'SHARPENING QUILLS',
  'GRINDING PIGMENTS', 'TURNING PAGES', 'ANNOTATING GLYPHS', 'BINDING THE FOLIO',
  // workshop / engineering
  'TIGHTENING TOLERANCES', 'TUNING HARMONICS', 'BLEEDING THE LINES', 'DAMPENING RESONANCE',
  'TORQUING FASTENERS', 'SHIMMING THE BEARING', 'REBUILDING THE LATHE', 'CALIBRATING JIGS',
  // food / kitchen pass
  'BLOOMING SPICES', 'REDUCING STOCK', 'TEMPERING CHOCOLATE', 'PROOFING DOUGH',
  'EMULSIFYING SAUCE', 'PLATING COURSE', 'FLAMBÉING BRANDY', 'BASTING ROAST',
  // weather / oceanographic
  'TRACKING THE FRONT', 'SOUNDING THE THERMOCLINE', 'CHARTING ISOBARS', 'READING THE TIDES',
  'ROTATING THE RADAR', 'TIMING THE LIGHTNING', 'WATCHING THE GLASS', 'TRIANGULATING STORMS',
  // aviation
  'RUNNING CHECKLIST', 'TRIMMING ELEVATORS', 'FEATHERING PROP', 'CYCLING LANDING GEAR',
  'TUNING TRANSPONDER', 'WAITING FOR CLEARANCE', 'CONFIRMING APPROACH', 'TAXIING TO HOLD-SHORT',
  // arcade / game
  'INSERTING COIN', 'LOADING NEXT LEVEL', 'SPAWNING ENEMIES', 'AWAITING PLAYER INPUT',
  'ROLLING SAVING THROW', 'CONSULTING DUNGEON MASTER', 'SHUFFLING DECK', 'DEALING THE HAND',
  // pure absurdist / weird
  'MILKING THE CACHE', 'POLISHING THE BRASS', 'WAXING PHILOSOPHICAL', 'COURTING ENTROPY',
  'NEGOTIATING WITH THE COMPILER', 'BRIBING THE GARBAGE COLLECTOR', 'WHISPERING TO THE LINKER',
  'APOLOGIZING TO THE TYPECHECKER', 'BARGAINING WITH FATE', 'PETITIONING THE ORACLE',
  'CONSULTING THE RUBBER DUCK', 'INTERROGATING THE STACK', 'BEGGING THE KERNEL',
];

interface ThinkingAnimationProps {
  color?: string;
  size?: number;
}

export default function ThinkingAnimation({ color, size = 18 }: ThinkingAnimationProps = {}) {
  const [wordIndex, setWordIndex] = useState(() => Math.floor(Math.random() * THINKING_WORDS.length));
  const [charIndex, setCharIndex] = useState(0);
  const [phase, setPhase] = useState<'typing' | 'pause' | 'erasing'>('typing');
  const [chainMode, setChainMode] = useState<SaiLogoMode>(() => CHAIN_POOL[Math.floor(Math.random() * CHAIN_POOL.length)].mode);

  const mountedAtRef = useRef<number>(performance.now());
  const [clockText, setClockText] = useState('00:00.0');

  useEffect(() => {
    const id = setInterval(() => {
      const ms = performance.now() - mountedAtRef.current;
      const totalSec = Math.floor(ms / 1000);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      const d = Math.floor((ms % 1000) / 100);
      setClockText(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`);
    }, 100);
    return () => clearInterval(id);
  }, []);

  const word = THINKING_WORDS[wordIndex % THINKING_WORDS.length];

  // Drive the random animation chain: pick 2–4 from the pool, play each
  // for one full cycle, then re-shuffle. 80ms 'static' gap between steps
  // forces the next animation to restart cleanly from neutral.
  useEffect(() => {
    let cancelled = false;
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    const wait = (ms: number) => new Promise<void>(resolve => {
      timeouts.push(setTimeout(resolve, ms));
    });

    (async () => {
      while (!cancelled) {
        const n = 2 + Math.floor(Math.random() * 3); // 2..4 inclusive
        const chain = sampleChain(n);
        for (const step of chain) {
          if (cancelled) return;
          setChainMode(step.mode);
          await wait(step.dur);
          if (cancelled) return;
          setChainMode('static');
          await wait(80);
        }
      }
    })();

    return () => {
      cancelled = true;
      timeouts.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;

    if (phase === 'typing') {
      if (charIndex < word.length) {
        timeout = setTimeout(() => setCharIndex(c => c + 1), 40 + Math.random() * 30);
      } else {
        timeout = setTimeout(() => setPhase('pause'), 1200 + Math.random() * 600);
      }
    } else if (phase === 'pause') {
      timeout = setTimeout(() => setPhase('erasing'), 100);
    } else if (phase === 'erasing') {
      if (charIndex > 0) {
        timeout = setTimeout(() => setCharIndex(c => c - 1), 20);
      } else {
        setWordIndex(i => (i + 1 + Math.floor(Math.random() * 3)) % THINKING_WORDS.length);
        setPhase('typing');
      }
    }

    return () => clearTimeout(timeout);
  }, [charIndex, phase, word.length]);

  const displayText = word.slice(0, charIndex);
  const accent = color || 'var(--accent)';

  return (
    <div className="pwa-thinking-animation" style={color ? { color } : undefined}>
      <SaiLogo mode={chainMode} size={size} color={accent} className="pwa-thinking-icon" />
      <span className="pwa-thinking-clock">[{clockText}]</span>
      <span className="pwa-thinking-text" style={{ color: accent }}>
        {displayText}
        <span className="pwa-thinking-cursor-block" style={{ backgroundColor: accent }} />
      </span>
      <style>{`
        .pwa-thinking-animation {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 10px;
          min-height: 32px;
        }
        .pwa-thinking-icon { flex-shrink: 0; }
        .pwa-thinking-clock {
          font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
          font-variant-numeric: tabular-nums;
          font-size: 10px;
          color: #6b6253;
          letter-spacing: 0.04em;
          flex-shrink: 0;
        }
        .pwa-thinking-text {
          font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 11px;
          line-height: 1;
          letter-spacing: 0.4px;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .pwa-thinking-cursor-block {
          display: inline-block;
          width: 0.55em;
          height: 1em;
          vertical-align: -0.15em;
          margin-left: 3px;
          animation: pwa-thinking-cursor-blink 1s steps(1) infinite;
        }
        @keyframes pwa-thinking-cursor-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .pwa-thinking-cursor-block { animation: none; opacity: 1; }
        }
      `}</style>
    </div>
  );
}
