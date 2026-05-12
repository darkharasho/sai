import React, { useMemo } from 'react';
import SaiLogo from '../SaiLogo';

interface Props {
  /** Diameter of the lead logo in px. Default 64 (matches default chat empty state). */
  leadSize?: number;
  /** Number of follower logos arranged behind the leader. Default 3. Max 5. */
  followerCount?: number;
  /** Total cluster footprint width/height in px. Default 260. */
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

function buildFlock(leadSize: number, _followerCount: number, _footprint: number): { lead: Bee; followers: Bee[] } {
  const rng = seedRandom(leadSize * 31);
  const lead: Bee = {
    x: 0,
    y: 0,
    z: 0,
    size: leadSize,
    delay: 0,
    duration: 3.4,
    amplitude: 2.5,
    rotateAmplitude: 2.5,
    zIndex: 100,
    opacity: 1,
    blur: 0,
  };

  // Pairs only — strict V formation, no center slot (would overlap the leader).
  // Three rows expanding up-and-out behind the leader. Each follower is sized
  // at 60% of the leader's base; browser perspective further shrinks rows that
  // are further back along Z.
  const followerBaseSize = leadSize * 0.6;
  const rows: Array<{ x: number; y: number; z: number; opacity: number; blur: number }> = [
    // Row 1 — close behind, gentle outward fan
    { x: -60, y: -16, z: -90,  opacity: 0.8, blur: 0 },
    { x:  60, y: -16, z: -90,  opacity: 0.8, blur: 0 },
    // Row 2 — mid distance
    { x: -118, y: -34, z: -200, opacity: 0.55, blur: 0.3 },
    { x:  118, y: -34, z: -200, opacity: 0.55, blur: 0.3 },
    // Row 3 — far back
    { x: -176, y: -54, z: -320, opacity: 0.35, blur: 0.7 },
    { x:  176, y: -54, z: -320, opacity: 0.35, blur: 0.7 },
  ];

  const followers: Bee[] = rows.map((slot, i) => ({
    x: slot.x,
    y: slot.y,
    z: slot.z,
    size: followerBaseSize,
    delay: rng() * -3,
    duration: 3.0 + rng() * 1.8,
    amplitude: 3 + rng() * 3,
    rotateAmplitude: 3 + rng() * 5,
    zIndex: 50 - i,
    opacity: slot.opacity,
    blur: slot.blur,
  }));

  return { lead, followers };
}

/**
 * The lead SAI logo flanked by a 3D-perspective flock of smaller logos
 * receding into the distance behind it. Used for the orchestrator chat's
 * empty state — gives the feel of a swarm trailing the leader through space.
 */
export default function SwarmLogoCluster({
  leadSize = 96,
  followerCount = 6,
  footprint = 420,
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
