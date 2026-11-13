export interface V3 { x: number; y: number; z: number }
export type Preset = 'iso' | 'front' | 'top' | 'right';
export interface Framing { position: V3; target: V3; near: number; far: number }

// Z-up convention. Top has a tiny Y tilt so camera.up=(0,0,1) never goes degenerate.
const DIRS: Record<Preset, V3> = {
  iso: { x: 1, y: -1, z: 0.8 },
  front: { x: 0, y: -1, z: 0 },
  top: { x: 0, y: -0.0001, z: 1 },
  right: { x: 1, y: 0, z: 0 },
};

export function framingFor(
  box: { min: V3; max: V3 },
  preset: Preset,
  fovDeg: number,
): Framing {
  const target = {
    x: (box.min.x + box.max.x) / 2,
    y: (box.min.y + box.max.y) / 2,
    z: (box.min.z + box.max.z) / 2,
  };
  const dx = box.max.x - box.min.x;
  const dy = box.max.y - box.min.y;
  const dz = box.max.z - box.min.z;
  const radius = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz) / 2, 1e-3);
  const dist = (radius / Math.sin((fovDeg * Math.PI) / 360)) * 1.1;
  const d = DIRS[preset];
  const len = Math.hypot(d.x, d.y, d.z);
  return {
    position: {
      x: target.x + (d.x / len) * dist,
      y: target.y + (d.y / len) * dist,
      z: target.z + (d.z / len) * dist,
    },
    target,
    near: dist / 100,
    far: dist * 100 + radius,
  };
}

export function nextView(
  prev: { position: V3; target: V3 } | null,
  _box: { min: V3; max: V3 },
): 'fit' | 'keep' {
  return prev ? 'keep' : 'fit';
}
