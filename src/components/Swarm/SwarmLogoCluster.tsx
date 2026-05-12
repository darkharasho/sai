import React, { useMemo } from 'react';
import SaiLogo from '../SaiLogo';

interface Props {
  /** Number of logos to render. Default 7. */
  count?: number;
  /** Size of each individual logo in px. Default 28. */
  size?: number;
  /** Total cluster footprint in px (square). Default 220. */
  footprint?: number;
}

interface Bee {
  /** Position offsets from center, in px. */
  x: number;
  y: number;
  /** Per-bee animation parameters. */
  delay: number;
  duration: number;
  amplitude: number;
  rotateAmplitude: number;
  scale: number;
}

function seedRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function buildBees(count: number, footprint: number, size: number): Bee[] {
  const rng = seedRandom(count * 31 + footprint);
  const radius = footprint / 2 - size / 2;
  const bees: Bee[] = [];
  for (let i = 0; i < count; i++) {
    // Distribute around a soft ring with jitter so they don't look like a clock
    const baseAngle = (i / count) * Math.PI * 2;
    const angle = baseAngle + (rng() - 0.5) * 0.7;
    const r = radius * (0.45 + rng() * 0.55);
    bees.push({
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r,
      delay: rng() * -3, // negative so bees enter staggered, mid-cycle
      duration: 2.4 + rng() * 1.6,
      amplitude: 6 + rng() * 6,
      rotateAmplitude: 6 + rng() * 10,
      scale: 0.85 + rng() * 0.3,
    });
  }
  return bees;
}

/**
 * A cluster of small SAI logos that bob and drift to evoke a swarm.
 * Used as the empty-state visual on the orchestrator chat.
 */
export default function SwarmLogoCluster({ count = 7, size = 28, footprint = 220 }: Props) {
  const bees = useMemo(() => buildBees(count, footprint, size), [count, size, footprint]);
  return (
    <div
      className="swarm-logo-cluster"
      aria-hidden="true"
      style={{
        position: 'relative',
        width: footprint,
        height: footprint,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {bees.map((bee, i) => (
        <div
          key={i}
          className="swarm-bee"
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: size,
            height: size,
            marginLeft: -size / 2,
            marginTop: -size / 2,
            transform: `translate(${bee.x}px, ${bee.y}px) scale(${bee.scale})`,
            animation: `swarm-bee-drift-${i} ${bee.duration}s ease-in-out ${bee.delay}s infinite alternate`,
          }}
        >
          <SaiLogo mode="idle" size={size} ariaLabel="" />
          <style>{`
            @keyframes swarm-bee-drift-${i} {
              0% {
                transform: translate(${bee.x}px, ${bee.y}px) scale(${bee.scale}) rotate(-${bee.rotateAmplitude / 2}deg);
              }
              50% {
                transform: translate(${bee.x + (bee.amplitude * 0.5)}px, ${bee.y - bee.amplitude}px) scale(${bee.scale}) rotate(${bee.rotateAmplitude / 2}deg);
              }
              100% {
                transform: translate(${bee.x - (bee.amplitude * 0.4)}px, ${bee.y + (bee.amplitude * 0.7)}px) scale(${bee.scale}) rotate(-${bee.rotateAmplitude / 2}deg);
              }
            }
          `}</style>
        </div>
      ))}
    </div>
  );
}
