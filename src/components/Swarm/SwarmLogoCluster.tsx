import React, { useMemo } from 'react';
import SaiLogo from '../SaiLogo';

interface Props {
  /** Diameter of the lead logo in px. Default 64 (matches default chat empty state). */
  leadSize?: number;
  /** Number of follower logos arranged behind the leader. Default 8. */
  followerCount?: number;
  /** Total cluster footprint width/height in px. Default 280. */
  footprint?: number;
}

interface Bee {
  /** Center offsets from the leader, in px (pre-perspective). */
  x: number;
  y: number;
  /** Negative for receding away from the viewer. */
  z: number;
  /** Base size before perspective. Browser handles depth scaling. */
  size: number;
  /** Animation params — small drift relative to its position. */
  delay: number;
  duration: number;
  amplitude: number;
  rotateAmplitude: number;
  /** Render order — higher = on top. */
  zIndex: number;
  /** Atmospheric fade with depth. */
  opacity: number;
  /** Slight blur on the deepest birds for depth-of-field feel. */
  blur: number;
}

function seedRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function buildFlock(leadSize: number, followerCount: number, footprint: number): { lead: Bee; followers: Bee[] } {
  const rng = seedRandom(leadSize * 31 + followerCount * 11 + footprint);
  const lead: Bee = {
    x: 0,
    y: 0,
    z: 0,
    size: leadSize,
    delay: 0,
    duration: 3.2,
    amplitude: 3,
    rotateAmplitude: 3,
    zIndex: 100,
    opacity: 1,
    blur: 0,
  };

  const followers: Bee[] = [];
  // Spread the followers around the leader, biased upward (geese flying up
  // and away) and into the distance. Each gets pushed further back along Z.
  for (let i = 0; i < followerCount; i++) {
    // Angle around the leader, biased to the top half (-π to 0 in screen coords)
    // → -180° to 0° spans the upper semicircle. Add jitter.
    const t = i / Math.max(1, followerCount - 1); // 0..1
    const angle = Math.PI + t * Math.PI + (rng() - 0.5) * 0.4; // π..2π with jitter (= top semicircle)
    // Distance from center in 2D — followers tile outward in concentric rings
    const ringIndex = i % 3; // 0 closest ring, 2 farthest ring
    const ringRadius = 30 + ringIndex * 36 + (rng() - 0.5) * 10;
    const x = Math.cos(angle) * ringRadius;
    // Compress Y so the flock reads as receding, not vertically tall
    const y = Math.sin(angle) * ringRadius * 0.55 - 6 - ringIndex * 4;
    // Push further back along Z with each ring + per-bee jitter. Strong z gives
    // browser perspective good material to work with.
    const z = -(60 + ringIndex * 80 + rng() * 40);
    followers.push({
      x,
      y,
      z,
      size: leadSize, // browser scales via perspective; keep base size uniform
      delay: rng() * -3,
      duration: 2.2 + rng() * 2.2,
      amplitude: 3 + rng() * 5,
      rotateAmplitude: 4 + rng() * 8,
      zIndex: 50 - ringIndex * 10 - Math.floor(rng() * 5),
      opacity: 0.85 - ringIndex * 0.18,
      blur: ringIndex >= 2 ? 0.6 : 0,
    });
  }
  return { lead, followers };
}

/**
 * The lead SAI logo flanked by a 3D-perspective flock of smaller logos
 * receding into the distance behind it. Used for the orchestrator chat's
 * empty state — gives the feel of a swarm trailing the leader through space.
 */
export default function SwarmLogoCluster({
  leadSize = 64,
  followerCount = 8,
  footprint = 280,
}: Props) {
  const { lead, followers } = useMemo(
    () => buildFlock(leadSize, followerCount, footprint),
    [leadSize, followerCount, footprint],
  );
  const allBees: Bee[] = [...followers, lead]; // lead last so its DOM order also pushes it visually forward

  return (
    <div
      className="swarm-logo-cluster"
      aria-hidden="true"
      style={{
        position: 'relative',
        width: footprint,
        height: footprint,
        perspective: 600,
        perspectiveOrigin: '50% 60%',
        transformStyle: 'preserve-3d',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {allBees.map((bee, i) => (
        <div
          key={i}
          className="swarm-bee"
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: bee.size,
            height: bee.size,
            marginLeft: -bee.size / 2,
            marginTop: -bee.size / 2,
            opacity: bee.opacity,
            zIndex: bee.zIndex,
            filter: bee.blur > 0 ? `blur(${bee.blur}px)` : undefined,
            animation: `swarm-bee-${i} ${bee.duration}s ease-in-out ${bee.delay}s infinite alternate`,
            transformStyle: 'preserve-3d',
            // Initial transform — overridden by keyframes once animation kicks in.
            transform: `translate3d(${bee.x}px, ${bee.y}px, ${bee.z}px)`,
          }}
        >
          <SaiLogo mode="idle" size={bee.size} ariaLabel={i === allBees.length - 1 ? 'SAI' : ''} />
          <style>{`
            @keyframes swarm-bee-${i} {
              0% {
                transform: translate3d(${bee.x}px, ${bee.y}px, ${bee.z}px) rotate(-${bee.rotateAmplitude / 2}deg);
              }
              50% {
                transform: translate3d(${bee.x + bee.amplitude * 0.4}px, ${bee.y - bee.amplitude}px, ${bee.z + bee.amplitude * 1.5}px) rotate(${bee.rotateAmplitude / 2}deg);
              }
              100% {
                transform: translate3d(${bee.x - bee.amplitude * 0.3}px, ${bee.y + bee.amplitude * 0.6}px, ${bee.z - bee.amplitude}px) rotate(-${bee.rotateAmplitude / 2}deg);
              }
            }
          `}</style>
        </div>
      ))}
    </div>
  );
}
