import { useState, useEffect } from 'react';
import { Dot, Minus, Plus, Asterisk, SunDim, SunMedium, Sun } from 'lucide-react';
import SaiLogo from './SaiLogo';

const THINKING_WORDS = [
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
      <span className="thinking-text" style={color ? { color } : undefined}>
        {displayText}
        <span className="thinking-cursor thinking-cursor-breathing" style={color ? { color } : undefined}>|</span>
        ...
      </span>
    </div>
  );
}
