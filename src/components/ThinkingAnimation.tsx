import { useState, useEffect, useRef } from 'react';
import { Dot, Minus, Plus, Asterisk, SunDim, SunMedium, Sun } from 'lucide-react';
import SaiLogo, { type SaiLogoMode } from './SaiLogo';

// Pool of self-contained SAI animations that start AND end at neutral
// (translate 0, opacity 1, scale 1, rotation a multiple of 360°). Each
// thinking session samples 2–4 of these, plays one cycle of each
// back-to-back, then re-shuffles. Drift family is excluded from chains
// because each is 22–28s (would dominate cycle time).
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

const FALLBACK_WORDS = [
  'Thinking', 'Pondering', 'Ruminating', 'Cogitating', 'Deliberating',
  'Musing', 'Contemplating', 'Considering', 'Reflecting', 'Computing',
  'Evaluating', 'Reasoning', 'Noodling', 'Percolating', 'Mulling',
  'Scheming', 'Plotting', 'Hatching', 'Crafting', 'Concocting',
  'Formulating', 'Devising', 'Imagining', 'Envisioning', 'Ideating',
  'Fathoming', 'Deciphering', 'Unraveling', 'Exploring', 'Parsing',
  'Dissecting', 'Elucidating', 'Illuminating', 'Flibbertigibbeting',
  'Calculating', 'Solving',
];

const SPINNER_ICONS = [Dot, Minus, Plus, Asterisk, SunDim, SunMedium, Sun];

// Live preference cached at module scope; SettingsModal broadcasts updates
// via the `sai-pref-sai-animation` window event.
let saiAnimationPref = true;
if (typeof window !== 'undefined' && (window as any).sai?.settingsGet) {
  (window as any).sai.settingsGet('saiAnimationEnabled', true).then((v: boolean) => { saiAnimationPref = v !== false; });
}

interface ThinkingAnimationProps {
  color?: string;
}

export default function ThinkingAnimation({ color }: ThinkingAnimationProps = {}) {
  const [wordIndex, setWordIndex] = useState(() => Math.floor(Math.random() * THINKING_WORDS.length));
  const [charIndex, setCharIndex] = useState(0);
  const [phase, setPhase] = useState<'typing' | 'pause' | 'erasing'>('typing');
  const [iconIndex, setIconIndex] = useState(0);
  const [saiAnimationEnabled, setSaiAnimationEnabled] = useState(saiAnimationPref);
  const [chainMode, setChainMode] = useState<SaiLogoMode>(() => CHAIN_POOL[Math.floor(Math.random() * CHAIN_POOL.length)].mode);

  const mountedAtRef = useRef<number>(performance.now());
  const [clockText, setClockText] = useState('00:00.0');

  useEffect(() => {
    if (!saiAnimationEnabled) return;
    const id = setInterval(() => {
      const ms = performance.now() - mountedAtRef.current;
      const totalSec = Math.floor(ms / 1000);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      const d = Math.floor((ms % 1000) / 100);
      setClockText(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`);
    }, 100);
    return () => clearInterval(id);
  }, [saiAnimationEnabled]);

  const wordPool = saiAnimationEnabled ? THINKING_WORDS : FALLBACK_WORDS;
  const word = wordPool[wordIndex % wordPool.length];
  const Icon = SPINNER_ICONS[iconIndex % SPINNER_ICONS.length];

  // Cycle icons (only used when SAI animation is disabled)
  useEffect(() => {
    if (saiAnimationEnabled) return;
    const interval = setInterval(() => setIconIndex(i => i + 1), 150);
    return () => clearInterval(interval);
  }, [saiAnimationEnabled]);

  useEffect(() => {
    const onPref = (e: Event) => setSaiAnimationEnabled(!!(e as CustomEvent).detail);
    window.addEventListener('sai-pref-sai-animation', onPref);
    return () => window.removeEventListener('sai-pref-sai-animation', onPref);
  }, []);

  // Drive the random animation chain: pick 2–4 from the pool, play each
  // for one full cycle, then re-shuffle. 80ms 'static' gap between steps
  // forces the next animation to restart cleanly from neutral.
  useEffect(() => {
    if (!saiAnimationEnabled) return;
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
  }, [saiAnimationEnabled]);

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
        setWordIndex(i => (i + 1 + Math.floor(Math.random() * 3)) % wordPool.length);
        setPhase('typing');
      }
    }

    return () => clearTimeout(timeout);
  }, [charIndex, phase, word.length, wordPool.length]);

  const displayText = word.slice(0, charIndex);

  return (
    <div className="thinking-animation" style={color ? { color } : undefined}>
      {saiAnimationEnabled
        ? <SaiLogo mode={chainMode} size={18} className="thinking-icon" color={color || '#c7913b'} />
        : <Icon size={16} className="thinking-icon" style={color ? { color } : undefined} />}
      {saiAnimationEnabled && (
        <span className="thinking-clock">[{clockText}]</span>
      )}
      <span className="thinking-text" style={color ? { color } : undefined}>
        {displayText}
        {saiAnimationEnabled
          ? <span className="thinking-cursor thinking-cursor-block" style={color ? { backgroundColor: color } : undefined} />
          : <>
              <span className="thinking-cursor thinking-cursor-breathing" style={color ? { color } : undefined}>|</span>
              ...
            </>}
      </span>
    </div>
  );
}
