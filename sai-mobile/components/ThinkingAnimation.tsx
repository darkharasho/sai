// React Native port of src/renderer-remote/branding/ThinkingAnimation.tsx.
// Renders the real SAI logo (via SaiLogo.tsx) and cycles through a chain of
// 2–4 animation modes, matching the desktop's "chain pool" behavior. The
// chain pool here is a subset of the desktop's 17 modes — the ones that
// translate cleanly to React Native + Reanimated at chat-bubble scale.

import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { FONT } from '../lib/fonts';
import SaiLogo, { type SaiLogoMode } from './SaiLogo';

const ACCENT = '#c7910c';
const MUTED = '#6b6253';

const CHAIN_POOL: Array<{ mode: SaiLogoMode; dur: number }> = [
  { mode: 'pulse',    dur: 2400 },
  { mode: 'inhale',   dur: 4400 },
  { mode: 'scatter',  dur: 3200 },
  { mode: 'wave',     dur: 3600 },
  { mode: 'pendulum', dur: 3600 },
];

function sampleChain(n: number): typeof CHAIN_POOL {
  const shuffled = CHAIN_POOL.slice().sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

// Verbatim from PWA's ThinkingAnimation.tsx.
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

interface Props {
  size?: number;
  color?: string;
}

export default function ThinkingAnimation({ size = 18, color = ACCENT }: Props = {}) {
  const [wordIndex, setWordIndex] = useState(() => Math.floor(Math.random() * THINKING_WORDS.length));
  const [charIndex, setCharIndex] = useState(0);
  const [phase, setPhase] = useState<'typing' | 'pause' | 'erasing'>('typing');
  const [clockText, setClockText] = useState('00:00.0');
  const [chainMode, setChainMode] = useState<SaiLogoMode>(
    () => CHAIN_POOL[Math.floor(Math.random() * CHAIN_POOL.length)].mode,
  );
  const mountedAtRef = useRef<number>(Date.now());

  // Cursor blink — match PWA's 1s step blink (1↔0).
  const cursorOpacity = useSharedValue(1);
  useEffect(() => {
    cursorOpacity.value = withRepeat(
      withTiming(0, { duration: 500, easing: Easing.steps(1, true) }),
      -1,
      true,
    );
  }, [cursorOpacity]);
  const cursorStyle = useAnimatedStyle(() => ({ opacity: cursorOpacity.value }));

  // Drive the random animation chain: pick 2–4 from the pool, play each for
  // one cycle, then reshuffle. Brief 'static' gap between steps gives the
  // next animation a clean restart from neutral. Mirrors desktop behavior.
  useEffect(() => {
    let cancelled = false;
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timeouts.push(setTimeout(resolve, ms));
      });
    (async () => {
      while (!cancelled) {
        const n = 2 + Math.floor(Math.random() * 3);
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

  // Clock — mm:ss.d.
  useEffect(() => {
    const id = setInterval(() => {
      const ms = Date.now() - mountedAtRef.current;
      const totalSec = Math.floor(ms / 1000);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      const d = Math.floor((ms % 1000) / 100);
      setClockText(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`);
    }, 100);
    return () => clearInterval(id);
  }, []);

  const word = THINKING_WORDS[wordIndex % THINKING_WORDS.length];

  // Typewriter — type → pause → erase → next word.
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    if (phase === 'typing') {
      if (charIndex < word.length) {
        timeout = setTimeout(() => setCharIndex((c) => c + 1), 40 + Math.random() * 30);
      } else {
        timeout = setTimeout(() => setPhase('pause'), 1200 + Math.random() * 600);
      }
    } else if (phase === 'pause') {
      timeout = setTimeout(() => setPhase('erasing'), 100);
    } else if (phase === 'erasing') {
      if (charIndex > 0) {
        timeout = setTimeout(() => setCharIndex((c) => c - 1), 20);
      } else {
        setWordIndex((i) => (i + 1 + Math.floor(Math.random() * 3)) % THINKING_WORDS.length);
        setPhase('typing');
      }
    }
    return () => clearTimeout(timeout);
  }, [charIndex, phase, word.length]);

  const displayText = word.slice(0, charIndex);

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 6,
        paddingHorizontal: 10,
        minHeight: 32,
      }}
    >
      <SaiLogo size={size} color={color} mode={chainMode} />
      <Text
        style={{
          fontFamily: FONT.mono,
          fontVariant: ['tabular-nums'],
          fontSize: 10,
          color: MUTED,
          letterSpacing: 0.4,
        }}
      >
        [{clockText}]
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text
          style={{
            fontFamily: FONT.mono,
            fontSize: 11,
            lineHeight: 13,
            color,
            letterSpacing: 0.4,
          }}
          numberOfLines={1}
        >
          {displayText}
        </Text>
        <Animated.View
          style={[
            {
              width: 6,
              height: 11,
              backgroundColor: color,
              marginLeft: 3,
            },
            cursorStyle,
          ]}
        />
      </View>
    </View>
  );
}
