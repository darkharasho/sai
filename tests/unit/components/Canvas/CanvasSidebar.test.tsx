import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CanvasContext, type CanvasController } from '../../../../src/canvas/CanvasContext';
import { createCanvasStore } from '../../../../src/canvas/canvasStore';
import { CanvasSidebar } from '../../../../src/components/Canvas/CanvasSidebar';

const A = '/home/u/p/.sai/canvas/shop.md';
const B = '/home/u/p/.sai/canvas/plan.md';

async function setup(props: Partial<React.ComponentProps<typeof CanvasSidebar>> = {}) {
  const store = createCanvasStore({ writeFile: async () => {}, now: () => Date.now() });
  await store.onDiskChange(A, '# Shop mod test\n\n- [x] one\n- [!] two\n- [ ] three\n', false);
  await store.onDiskChange(B, '# Release plan\n\nNo checklist.\n', false);
  const ctl = {
    store, chatKey: 'c', agentStatus: 'idle', sendInFor: () => null, sendNow: vi.fn(), takeHeld: () => null,
    holdToggle: vi.fn(), openCanvas: vi.fn(), openSource: vi.fn(), writeSource: vi.fn(),
  } as unknown as CanvasController;
  const on = { onToggle: vi.fn(), onSelect: vi.fn(), onRemove: vi.fn(), onResize: vi.fn() };
  const utils = render(
    <CanvasContext.Provider value={ctl}>
      <CanvasSidebar paths={[A, B, '/home/u/p/.sai/canvas/missing.md']} open={false} selected={A} width={380} {...on} {...props} />
    </CanvasContext.Provider>,
  );
  return { store, ...on, ...utils };
}

describe('CanvasSidebar', () => {
  it('collapsed: a strip with one bar per canvas on disk, labelled with title and progress', async () => {
    await setup();
    expect(screen.getByLabelText('Shop mod test, 1 of 3 · 1 failed')).toBeTruthy();
    expect(screen.getByLabelText('Release plan, no checklist')).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('renders nothing when none of the chat\'s canvases exist', () => {
    const store = createCanvasStore({ writeFile: async () => {}, now: () => 0 });
    const { container } = render(
      <CanvasContext.Provider value={{ store } as unknown as CanvasController}>
        <CanvasSidebar paths={['/x/.sai/canvas/a.md']} open selected={null} width={380} onToggle={vi.fn()} onSelect={vi.fn()} onResize={vi.fn()} />
      </CanvasContext.Provider>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('clicking the strip toggles; clicking a bar selects that canvas', async () => {
    const { onToggle, onSelect } = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Open canvas' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('Release plan, no checklist'));
    expect(onSelect).toHaveBeenCalledWith(B);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('expanded: a tab per canvas, the selected one shown; the open bar collapses on click', async () => {
    const { onSelect, onToggle } = await setup({ open: true });
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Shop mod test', 'Release plan']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').querySelector('.canvas-view')).toBeTruthy();
    fireEvent.click(tabs[1]);
    expect(onSelect).toHaveBeenCalledWith(B);
    fireEvent.click(screen.getByLabelText('Shop mod test, 1 of 3 · 1 failed'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('a tab\'s close button (or middle-click) removes it from the chat', async () => {
    const { onRemove, onSelect } = await setup({ open: true });
    fireEvent.click(screen.getByRole('button', { name: 'Close Release plan' }));
    expect(onRemove).toHaveBeenCalledWith(B);
    fireEvent(screen.getAllByRole('tab')[0], new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(onRemove).toHaveBeenCalledWith(A);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('a recent agent write makes the bar glow', async () => {
    const { store } = await setup();
    await act(async () => { await store.onDiskChange(B, '# Release plan\n\n- [ ] a\n', true); });
    expect(screen.getByLabelText('Release plan, 0 of 1').className).toContain('canvas-sidebar__bar--live');
  });
});
