import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { WorkspaceSquircle } from '../../../../src/components/shared/WorkspaceSquircle';

describe('WorkspaceSquircle busy-done (diagonal two-tone)', () => {
  it('renders busy-done as a single squircle span with no nested marks', () => {
    const { container } = render(<WorkspaceSquircle state="busy-done" data-testid="sq" />);
    const all = container.querySelectorAll('.ws-sq');
    expect(all).toHaveLength(1);
    const el = all[0] as HTMLElement;
    expect(el.classList.contains('ws-sq-busy-done')).toBe(true);
    // The old nested two-child structure is gone.
    expect(container.querySelector('.ws-sq-busy-done-wrap')).toBeNull();
    expect(container.querySelector('.ws-sq-inner')).toBeNull();
  });

  it('uses the squircle (dot) mask, not the approval triangle mask', () => {
    const { container } = render(<WorkspaceSquircle state="busy-done" />);
    const el = container.querySelector('.ws-sq-busy-done') as HTMLElement;
    // dot mask viewBox marker vs triangle viewBox '3 3.5 18.5 16'
    expect(el.style.mask + el.style.webkitMask).toContain('25.101052');
  });

  it('still renders the other states as single spans', () => {
    for (const state of ['inactive', 'alive', 'busy', 'done', 'approval'] as const) {
      const { container } = render(<WorkspaceSquircle state={state} />);
      expect(container.querySelectorAll('.ws-sq')).toHaveLength(1);
      expect(container.querySelector(`.ws-sq-${state}`)).not.toBeNull();
    }
  });
});
