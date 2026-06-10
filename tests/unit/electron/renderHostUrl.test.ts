import { describe, it, expect } from 'vitest';
import { renderHostSearch } from '../../../electron/renderHostUrl';

describe('renderHostSearch', () => {
  it('always sets the render-host flag', () => {
    expect(renderHostSearch({})).toContain('render-host=1');
  });
  it('encodes a single component + props', () => {
    const s = new URLSearchParams(renderHostSearch({ component: 'WorkspaceSquircle', props: { state: 'busy-done' } }));
    expect(s.get('component')).toBe('WorkspaceSquircle');
    expect(JSON.parse(s.get('props')!)).toEqual({ state: 'busy-done' });
  });
  it('encodes components[] + vars + width', () => {
    const s = new URLSearchParams(renderHostSearch({ components: ['A', 'B'], vars: { '--x': '1' }, width: 400 }));
    expect(JSON.parse(s.get('components')!)).toEqual(['A', 'B']);
    expect(JSON.parse(s.get('vars')!)).toEqual({ '--x': '1' });
    expect(s.get('width')).toBe('400');
  });
});
