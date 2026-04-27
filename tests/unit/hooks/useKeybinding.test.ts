import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeybinding } from '../../../src/hooks/useKeybinding';

beforeEach(() => {
  (window as any).sai = {
    settingsGet: vi.fn().mockResolvedValue({}),
    settingsSet: vi.fn().mockResolvedValue(undefined),
  };
});

afterEach(() => {
  delete (window as any).__sai_keybinding_overrides;
});

function fireKey(combo: { key: string; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean }) {
  window.dispatchEvent(new KeyboardEvent('keydown', combo));
}

describe('useKeybinding', () => {
  it('invokes the handler when the default combo fires', async () => {
    const handler = vi.fn();
    renderHook(() => useKeybinding('palette.open', handler));
    // wait one microtask for the hook's settingsGet to resolve
    await Promise.resolve();
    fireKey({ key: 'k', ctrlKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the handler when the combo does not match', async () => {
    const handler = vi.fn();
    renderHook(() => useKeybinding('palette.open', handler));
    await Promise.resolve();
    fireKey({ key: 'j', ctrlKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it('respects user override from settings', async () => {
    (window as any).sai.settingsGet = vi.fn().mockResolvedValue({ 'palette.open': 'Ctrl+J' });
    const handler = vi.fn();
    renderHook(() => useKeybinding('palette.open', handler));
    await Promise.resolve(); await Promise.resolve();   // settingsGet then re-render
    fireKey({ key: 'j', ctrlKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
    fireKey({ key: 'k', ctrlKey: true });
    expect(handler).toHaveBeenCalledTimes(1);   // old default no longer fires
  });

  it('treats empty combo as disabled', async () => {
    (window as any).sai.settingsGet = vi.fn().mockResolvedValue({ 'palette.open': '' });
    const handler = vi.fn();
    renderHook(() => useKeybinding('palette.open', handler));
    await Promise.resolve(); await Promise.resolve();
    fireKey({ key: 'k', ctrlKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it('stops listening after unmount', async () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useKeybinding('palette.open', handler));
    await Promise.resolve();
    unmount();
    fireKey({ key: 'k', ctrlKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it('multiple subscriptions each fire for their own combo', async () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    renderHook(() => useKeybinding('palette.open', h1));
    renderHook(() => useKeybinding('search.toggle', h2));
    await Promise.resolve();
    fireKey({ key: 'k', ctrlKey: true });
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).not.toHaveBeenCalled();
    fireKey({ key: 'F', ctrlKey: true, shiftKey: true });
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it('on duplicate-combo conflict, only the first registered (registry order) fires', async () => {
    (window as any).sai.settingsGet = vi.fn().mockResolvedValue({
      'palette.open': 'Ctrl+J',
      'chatHistory.toggle': 'Ctrl+J',
    });
    const h1 = vi.fn();
    const h2 = vi.fn();
    renderHook(() => useKeybinding('palette.open', h1));
    renderHook(() => useKeybinding('chatHistory.toggle', h2));
    await Promise.resolve(); await Promise.resolve();
    fireKey({ key: 'j', ctrlKey: true });
    // palette.open is declared before chatHistory.toggle in KEYBINDINGS
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).not.toHaveBeenCalled();
  });

  it('refreshes bindings when keybindingsChanged event fires', async () => {
    const handler = vi.fn();
    renderHook(() => useKeybinding('palette.open', handler));
    await Promise.resolve();

    // user edits in Settings — overrides update + event dispatched
    (window as any).sai.settingsGet = vi.fn().mockResolvedValue({ 'palette.open': 'Ctrl+J' });
    window.dispatchEvent(new CustomEvent('sai:keybindings-changed'));
    await Promise.resolve(); await Promise.resolve();

    fireKey({ key: 'k', ctrlKey: true });
    expect(handler).not.toHaveBeenCalled();
    fireKey({ key: 'j', ctrlKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
