// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Sparkline from '../../src/components/Swarm/Sparkline';

describe('Sparkline', () => {
  it('renders nothing for empty data', () => {
    const { container } = render(<Sparkline data={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders an SVG with line + area paths for given data', () => {
    render(<Sparkline data={[1, 2, 3, 2, 4]} width={60} height={16} />);
    const svg = screen.getByTestId('sparkline');
    expect(svg.tagName.toLowerCase()).toBe('svg');
    const paths = svg.querySelectorAll('path');
    // 1 area + 1 line
    expect(paths.length).toBe(2);
    // line path has stroke set
    const linePath = paths[1];
    expect(linePath.getAttribute('stroke')).toBeTruthy();
    expect(linePath.getAttribute('d')).toMatch(/^M /);
  });

  it('handles a flat series without dividing by zero', () => {
    render(<Sparkline data={[3, 3, 3, 3]} />);
    const paths = screen.getByTestId('sparkline').querySelectorAll('path');
    expect(paths[1].getAttribute('d')).not.toMatch(/NaN/);
  });

  it('handles single-element data', () => {
    render(<Sparkline data={[7]} />);
    const paths = screen.getByTestId('sparkline').querySelectorAll('path');
    expect(paths[1].getAttribute('d')).not.toMatch(/NaN/);
  });
});
