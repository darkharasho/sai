import { useState, useEffect, useRef } from 'react';
import { Dot, Minus, Plus, Asterisk, SunDim, SunMedium, Sun } from 'lucide-react';
import SaiLogo from './SaiLogo';

const THINKING_WORDS = [
  // mission-control / NASA
  'ESTABLISHING UPLINK', 'TRIANGULATING', 'CALIBRATING', 'TRACING SIGNAL',
  'ALIGNING VECTORS', 'MAPPING TOPOLOGY', 'LOCKING TELEMETRY', 'SYNCHRONIZING CLOCKS',
  // cyberpunk / netrunner
  'JACKING IN', 'DECRYPTING TOKENS', 'SCRAPING CACHE', 'BREACHING ICE',
  'SPOOFING HANDSHAKE', 'ROUTING THROUGH PROXY', 'BURNING CYCLES', 'OVERCLOCKING CORE',
  // starship-computer / TNG
  'ACCESSING DATABANK', 'CROSS-REFERENCING', 'EXTRAPOLATING', 'COMPUTING VECTORS',
  'RESOLVING INTENT', 'INDEXING MEMORY', 'COMPILING THOUGHT', 'CONSULTING ARCHIVES',
  'PARSING SIGNAL', 'SYNTHESIZING',
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

  const word = THINKING_WORDS[wordIndex];
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

  return (
    <div className="thinking-animation" style={color ? { color } : undefined}>
      {saiAnimationEnabled
        ? <SaiLogo mode="drift" size={18} className="thinking-icon" color={color || '#c7913b'} />
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
