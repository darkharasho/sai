import React, { useMemo } from 'react';
import SaiLogo from '../SaiLogo';

interface Props {
  /** Diameter of the lead logo in px. Default 64 (matches default chat empty state). */
  leadSize?: number;
  /** Followers per wing. 3 → 6 total followers (3 up-left, 3 up-right). Default 3. */
  followersPerWing?: number;
  /** Horizontal spacing between adjacent followers. Default 38. */
  wingSpacing?: number;
  /** Vertical drop per follower step behind. Default 22. */
  wingRise?: number;
}

interface Bee {
  x: number;            // offset from lead center
  y: number;
  size: number;
  delay: number;        // negative so each enters mid-cycle
  duration: number;
  amplitude: number;
  rotateAmplitude: number;
  opacity: number;
  zIndex: number;
}

function seedRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function buildFlock(leadSize: number, followersPerWing: number, wingSpacing: number, wingRise: number): { lead: Bee; followers: Bee[] } {
  const rng = seedRandom(leadSize * 31 + followersPerWing * 11 + wingSpacing);
  const lead: Bee = {
    x: 0,
    y: 0,
    size: leadSize,
    delay: 0,
    duration: 3.2,
    amplitude: 4,
    rotateAmplitude: 4,
    opacity: 1,
    zIndex: 10,
  };
  const followers: Bee[] = [];
  for (let wing = -1; wing <= 1; wing += 2) {
    for (let i = 1; i <= followersPerWing; i++) {
      // Shrink with depth: each step ~85% of the previous
      const scale = Math.pow(0.82, i);
      const size = leadSize * scale;
      // V extends up-and-out (rises behind the lead like geese)
      const x = wing * i * wingSpacing;
      const y = -i * wingRise + (rng() - 0.5) * 4; // tiny vertical jitter
      followers.push({
        x,
        y,
        size,
        delay: rng() * -3,
        duration: 2.2 + rng() * 1.8,
        amplitude: 4 + rng() * 5,
        rotateAmplitude: 5 + rng() * 8,
        opacity: 0.95 - i * 0.12,
        zIndex: 9 - i, // deeper followers behind closer ones
      });
    }
  }
  return { lead, followers };
}

/**
 * The lead SAI logo flanked by a V-formation flock of smaller logos drifting
 * behind it — like geese, used for the orchestrator chat's empty state.
 */
export default function SwarmLogoCluster({
  leadSize = 64,
  followersPerWing = 3,
  wingSpacing = 38,
  wingRise = 22,
}: Props) {
  const { lead, followers } = useMemo(
    () => buildFlock(leadSize, followersPerWing, wingSpacing, wingRise),
    [leadSize, followersPerWing, wingSpacing, wingRise],
  );

  // Compute a footprint that comfortably contains the wingtips + animation amplitude
  const halfWidth = followersPerWing * wingSpacing + leadSize;
  const heightAbove = followersPerWing * wingRise + leadSize / 2 + 20;
  const heightBelow = leadSize / 2 + 20;
  const width = halfWidth * 2;
  const height = heightAbove + heightBelow;

  const allBees: Bee[] = [lead, ...followers];

  return (
    <div
      className="swarm-logo-cluster"
      aria-hidden="true"
      style={{
        position: 'relative',
        width,
        height,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        paddingBottom: heightBelow,
      }}
    >
      {/* Anchor at horizontal center, vertical bottom-of-the-formation */}
      {allBees.map((bee, i) => (
        <div
          key={i}
          className="swarm-bee"
          style={{
            position: 'absolute',
            left: '50%',
            bottom: heightBelow,
            width: bee.size,
            height: bee.size,
            marginLeft: -bee.size / 2,
            marginBottom: -bee.size / 2,
            opacity: bee.opacity,
            zIndex: bee.zIndex,
            animation: `swarm-bee-${i} ${bee.duration}s ease-in-out ${bee.delay}s infinite alternate`,
            // Initial transform is overwritten by the animation keyframes
            transform: `translate(${bee.x}px, ${bee.y}px)`,
          }}
        >
          <SaiLogo mode="idle" size={bee.size} ariaLabel={i === 0 ? 'SAI' : ''} />
          <style>{`
            @keyframes swarm-bee-${i} {
              0% {
                transform: translate(${bee.x}px, ${bee.y}px) rotate(-${bee.rotateAmplitude / 2}deg);
              }
              50% {
                transform: translate(${bee.x + bee.amplitude * 0.4}px, ${bee.y - bee.amplitude}px) rotate(${bee.rotateAmplitude / 2}deg);
              }
              100% {
                transform: translate(${bee.x - bee.amplitude * 0.3}px, ${bee.y + bee.amplitude * 0.6}px) rotate(-${bee.rotateAmplitude / 2}deg);
              }
            }
          `}</style>
        </div>
      ))}
    </div>
  );
}
