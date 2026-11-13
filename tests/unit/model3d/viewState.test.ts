import { describe, it, expect } from 'vitest';
import { framingFor, nextView } from '../../../src/model3d/viewState';

const cube = { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } };

describe('nextView', () => {
  it('fits only when there is no previous view', () => {
    expect(nextView(null, cube)).toBe('fit');
    const prev = { position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 } };
    expect(nextView(prev, cube)).toBe('keep');
  });
});

describe('framingFor', () => {
  it('top view looks down +Z at the box center and fits the box', () => {
    const f = framingFor(cube, 'top', 50);
    expect(f.target).toEqual({ x: 5, y: 5, z: 5 });
    expect(f.position.x).toBeCloseTo(5, 1);
    expect(f.position.y).toBeCloseTo(5, 1);
    const d = f.position.z - 5;
    expect(d).toBeGreaterThan(0);
    const radius = Math.sqrt(300) / 2;
    expect(d * Math.sin((50 * Math.PI) / 360)).toBeGreaterThanOrEqual(radius - 1e-6);
    expect(f.near).toBeGreaterThan(0);
    expect(f.far).toBeGreaterThan(d);
  });
  it('front looks from -Y, right from +X, iso from +X -Y +Z', () => {
    expect(framingFor(cube, 'front', 50).position.y).toBeLessThan(5);
    expect(framingFor(cube, 'right', 50).position.x).toBeGreaterThan(5);
    const iso = framingFor(cube, 'iso', 50).position;
    expect(iso.x).toBeGreaterThan(5);
    expect(iso.y).toBeLessThan(5);
    expect(iso.z).toBeGreaterThan(5);
  });
});
