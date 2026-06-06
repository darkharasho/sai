import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import DiscardChangesModal from '../../../../src/components/Git/DiscardChangesModal';

describe('DiscardChangesModal', () => {
  it('portals to document.body so its fixed overlay escapes a transformed sidebar ancestor', () => {
    // A transform on an ancestor turns `position: fixed` into being relative to that
    // ancestor — which is what traps the modal inside the narrow git sidebar. The modal
    // must render OUTSIDE this subtree (portaled to body) to cover the whole window.
    const { container } = render(
      <div style={{ transform: 'translateX(0)' }} data-testid="transformed-ancestor">
        <DiscardChangesModal filePath="goodbye.txt" onConfirm={() => {}} onCancel={() => {}} />
      </div>
    );
    expect(container.querySelector('[data-discard-modal]')).toBeNull();
    expect(document.body.querySelector('[data-discard-modal]')).toBeTruthy();
  });

  it('confirms and cancels via its buttons', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<DiscardChangesModal filePath="x.txt" onConfirm={onConfirm} onCancel={onCancel} />);
    const overlay = document.body.querySelector('[data-discard-modal]')!;
    const buttons = overlay.querySelectorAll('button');
    (buttons[0] as HTMLButtonElement).click(); // Cancel
    (buttons[1] as HTMLButtonElement).click(); // Discard
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
