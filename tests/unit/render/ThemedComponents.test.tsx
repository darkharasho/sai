import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ThemedComponents } from '../../../src/render/ThemedComponents';

describe('ThemedComponents', () => {
  it('mounts a registered component', () => {
    const { container } = render(<ThemedComponents components={['WorkspaceSquircle']} vars={{}} props={{ state: 'busy-done' }} />);
    expect(container.querySelector('.ws-sq')).not.toBeNull();
  });

  it('applies vars as CSS custom properties on the wrapper', () => {
    const { container } = render(<ThemedComponents components={['WorkspaceSquircle']} vars={{ '--accent': '#6aa9ff' }} props={{ state: 'busy-done' }} />);
    const wrap = container.querySelector('[data-themed-wrap]') as HTMLElement;
    expect(wrap.style.getPropertyValue('--accent')).toBe('#6aa9ff');
  });

  it('renders an error label for an unknown component key', () => {
    const { getByText } = render(<ThemedComponents components={['Nope']} vars={{}} />);
    expect(getByText(/unknown component: Nope/)).toBeTruthy();
  });

  it('mounts multiple components', () => {
    // 'idle' is not a valid IndicatorState; use 'inactive' instead
    const { container } = render(<ThemedComponents components={['WorkspaceSquircle', 'WorkspaceSquircle']} vars={{}} props={{ state: 'inactive' }} />);
    expect(container.querySelectorAll('.ws-sq').length).toBe(2);
  });
});
