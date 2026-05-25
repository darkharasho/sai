import { useEffect, useState } from 'react';
import SaiLogo from './SaiLogo';

const WORDS = [
  'THINKING', 'TRIANGULATING', 'COMPILING', 'TRACING SIGNAL',
  'ALIGNING VECTORS', 'WARMING CORES', 'DECRYPTING', 'NAVIGATING',
  'PARSING', 'ROUTING', 'CALIBRATING', 'NEGOTIATING ORBIT',
  'SCANNING', 'STITCHING CONTEXT', 'TUNING WEIGHTS', 'RESOLVING',
];

interface Props { size?: number }

/**
 * Mobile-tuned thinking indicator. Single SAI mark in `pulse` mode
 * plus a rotating mission-control label. Lower cost than the desktop
 * chain animation; same brand vocabulary.
 */
export default function ThinkingAnimation({ size = 20 }: Props) {
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * WORDS.length));

  useEffect(() => {
    const t = setInterval(() => {
      setIdx((i) => {
        let next = i;
        while (next === i) next = Math.floor(Math.random() * WORDS.length);
        return next;
      });
    }, 2200);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 10px',
        color: 'var(--text-muted)',
      }}
    >
      <SaiLogo mode="pulse" size={size} color="var(--accent)" />
      <span
        style={{
          fontFamily: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 11,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {WORDS[idx]}
      </span>
    </div>
  );
}
