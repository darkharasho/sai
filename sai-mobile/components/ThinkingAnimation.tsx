// React Native port of src/renderer-remote/branding/ThinkingAnimation.tsx.
// Scope: clock [mm:ss.s] + typewriter THINKING_WORDS + blinking block cursor +
// a static SAI-accent placeholder square. Full SaiLogo chain modes (vortex,
// glitch, pendulum, comet, ripple, …) are skipped in v1 — too large an SVG
// port for the mobile surface. The placeholder is a small pulsing square in
// the accent color.

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

const ACCENT = '#c7910c';
const MUTED = '#6b6253';

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

export default function ThinkingAnimation({ size = 14, color = ACCENT }: Props = {}) {
  const [wordIndex, setWordIndex] = useState(() => Math.floor(Math.random() * THINKING_WORDS.length));
  const [charIndex, setCharIndex] = useState(0);
  const [phase, setPhase] = useState<'typing' | 'pause' | 'erasing'>('typing');
  const [clockText, setClockText] = useState('00:00.0');
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

  // Logo placeholder — slow pulse on the accent square.
  const pulse = useSharedValue(0.5);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: 0.5 + pulse.value * 0.5 }));

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
      <Animated.View
        style={[
          {
            width: size,
            height: size,
            borderRadius: 3,
            backgroundColor: color,
          },
          pulseStyle,
        ]}
      />
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
