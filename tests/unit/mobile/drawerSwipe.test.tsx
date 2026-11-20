import React, { useState } from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useDrawerSwipe, type DrawerSwipe } from '../../../mobile/src/shell/drawerSwipe';

// innerWidth 400 → drawer width min(336, 340) = 336.
beforeEach(() => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 }); });

let state: { open: boolean; swipe: DrawerSwipe | null; settled(): void } = { open: false, swipe: null, settled: () => {} };

function Harness({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const { swipe, settled } = useDrawerSwipe(el, open, setOpen);
  state = { open, swipe, settled };
  return (
    <div ref={setEl} data-testid="root" style={{ width: 400, height: 800 }}>
      {(open || swipe) && <div className="sai-phone-drawer-layer"><div data-testid="drawer">drawer</div></div>}
      <div data-testid="content">chat</div>
    </div>
  );
}

let clock = 0;
function touch(target: Element, type: string, x: number, y = 300): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  const touches = type === 'touchend' || type === 'touchcancel' ? [] : [{ clientX: x, clientY: y }];
  Object.defineProperty(e, 'touches', { value: touches });
  Object.defineProperty(e, 'timeStamp', { value: (clock += 100) }); // slow: 100ms per step, no flick
  act(() => { target.dispatchEvent(e); });
  return e;
}

function drag(target: Element, xs: number[], y = 300, ys?: number[]) {
  touch(target, 'touchstart', xs[0], ys?.[0] ?? y);
  const moves = xs.slice(1).map((x, i) => touch(target, 'touchmove', x, ys?.[i + 1] ?? y));
  touch(target, 'touchend', xs[xs.length - 1]);
  return moves;
}

describe('useDrawerSwipe', () => {
  it('a drag from the left edge pulls the drawer with the finger and opens it past the threshold', () => {
    const { getByTestId } = render(<Harness />);
    const content = getByTestId('content');
    touch(content, 'touchstart', 10);
    const move = touch(content, 'touchmove', 110);
    expect(move.defaultPrevented).toBe(true);
    expect(state.swipe).toEqual({ x: -336 + 100, width: 336, settling: false });
    touch(content, 'touchmove', 160);
    touch(content, 'touchend', 160);
    expect(state.swipe).toEqual({ x: 0, width: 336, settling: true });
    act(() => state.settled());
    expect(state.open).toBe(true);
    expect(state.swipe).toBeNull();
  });

  it('a short slow drag snaps back closed', () => {
    const { getByTestId } = render(<Harness />);
    drag(getByTestId('content'), [10, 40, 60]);
    expect(state.swipe?.x).toBe(-336);
    act(() => state.settled());
    expect(state.open).toBe(false);
  });

  it('a fast flick opens even when short', () => {
    const { getByTestId } = render(<Harness />);
    const content = getByTestId('content');
    touch(content, 'touchstart', 10);
    touch(content, 'touchmove', 30);
    // 50px in 10ms = 5 px/ms
    const e = new Event('touchmove', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'touches', { value: [{ clientX: 80, clientY: 300 }] });
    Object.defineProperty(e, 'timeStamp', { value: (clock += 10) });
    act(() => { content.dispatchEvent(e); });
    touch(content, 'touchend', 80);
    act(() => state.settled());
    expect(state.open).toBe(true);
  });

  it('ignores touches away from the edge and vertical scrolls from the edge', () => {
    const { getByTestId } = render(<Harness />);
    const content = getByTestId('content');
    const [m] = drag(content, [100, 250]);
    expect(m.defaultPrevented).toBe(false);
    expect(state.swipe).toBeNull();
    const scroll = drag(content, [10, 14, 18], 300, [300, 340, 400]);
    expect(scroll.some((e) => e.defaultPrevented)).toBe(false);
    expect(state.swipe).toBeNull();
    expect(state.open).toBe(false);
  });

  it('dragging the open drawer left closes it', () => {
    const { getByTestId } = render(<Harness initialOpen />);
    drag(getByTestId('drawer'), [300, 250, 150]);
    expect(state.swipe).toEqual({ x: -336, width: 336, settling: true });
    act(() => state.settled());
    expect(state.open).toBe(false);
  });

  it('a rightward drag on the open drawer does nothing', () => {
    const { getByTestId } = render(<Harness initialOpen />);
    drag(getByTestId('drawer'), [100, 200, 300]);
    expect(state.swipe).toBeNull();
    expect(state.open).toBe(true);
  });
});

describe('useDrawerSwipe, back to back', () => {
  it('a touch during the settle finishes it and starts from the settled state', () => {
    const { getByTestId } = render(<Harness />);
    drag(getByTestId('content'), [10, 120, 200]); // opens; settle pending
    expect(state.swipe?.settling).toBe(true);
    drag(getByTestId('drawer'), [300, 200, 100]);
    expect(state.open).toBe(true); // the open settle finished first
    expect(state.swipe).toEqual({ x: -336, width: 336, settling: true });
    act(() => state.settled());
    expect(state.open).toBe(false);
  });
});
