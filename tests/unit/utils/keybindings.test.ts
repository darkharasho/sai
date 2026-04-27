import { describe, it, expect } from 'vitest';
import { eventToCombo, formatCombo, findConflict, mergeWithDefaults, KEYBINDINGS } from '../../../src/utils/keybindings';

function ke(opts: Partial<KeyboardEvent>): KeyboardEvent {
  return new KeyboardEvent('keydown', opts);
}

describe('eventToCombo', () => {
  it('maps a plain letter key', () => {
    expect(eventToCombo(ke({ key: 'a' }))).toBe('A');
  });

  it('uppercases letters consistently', () => {
    expect(eventToCombo(ke({ key: 'A' }))).toBe('A');
  });

  it('includes Ctrl modifier', () => {
    expect(eventToCombo(ke({ key: 'k', ctrlKey: true }))).toBe('Ctrl+K');
  });

  it('treats metaKey (Cmd) as Ctrl', () => {
    expect(eventToCombo(ke({ key: 'k', metaKey: true }))).toBe('Ctrl+K');
  });

  it('orders modifiers Ctrl, Alt, Shift', () => {
    expect(eventToCombo(ke({ key: 'f', ctrlKey: true, shiftKey: true, altKey: true })))
      .toBe('Ctrl+Alt+Shift+F');
  });

  it('returns empty for pure-modifier events', () => {
    expect(eventToCombo(ke({ key: 'Control', ctrlKey: true }))).toBe('');
    expect(eventToCombo(ke({ key: 'Shift', shiftKey: true }))).toBe('');
    expect(eventToCombo(ke({ key: 'Meta', metaKey: true }))).toBe('');
    expect(eventToCombo(ke({ key: 'Alt', altKey: true }))).toBe('');
  });

  it('normalizes special keys', () => {
    expect(eventToCombo(ke({ key: 'Enter' }))).toBe('Enter');
    expect(eventToCombo(ke({ key: 'Escape' }))).toBe('Escape');
    expect(eventToCombo(ke({ key: 'Tab' }))).toBe('Tab');
    expect(eventToCombo(ke({ key: ' ' }))).toBe('Space');
    expect(eventToCombo(ke({ key: 'ArrowLeft' }))).toBe('Left');
    expect(eventToCombo(ke({ key: 'F5' }))).toBe('F5');
  });
});

describe('formatCombo', () => {
  it('formats verbatim on linux', () => {
    expect(formatCombo('Ctrl+K', 'linux')).toBe('Ctrl+K');
    expect(formatCombo('Ctrl+Shift+F', 'linux')).toBe('Ctrl+Shift+F');
  });

  it('uses mac symbols on mac', () => {
    expect(formatCombo('Ctrl+K', 'mac')).toBe('⌘K');
    expect(formatCombo('Ctrl+Shift+F', 'mac')).toBe('⇧⌘F');
    expect(formatCombo('Ctrl+Alt+Shift+M', 'mac')).toBe('⌥⇧⌘M');
  });

  it('returns "—" for empty combo', () => {
    expect(formatCombo('', 'linux')).toBe('—');
    expect(formatCombo('', 'mac')).toBe('—');
  });
});

describe('findConflict', () => {
  it('returns null when no conflict', () => {
    expect(findConflict('palette.open', 'Ctrl+J', { 'palette.open': 'Ctrl+K' })).toBeNull();
  });

  it('returns the conflicting binding id', () => {
    const overrides = { 'palette.open': 'Ctrl+K', 'search.toggle': 'Ctrl+Shift+F' };
    expect(findConflict('chatHistory.toggle', 'Ctrl+K', overrides)).toBe('palette.open');
  });

  it('falls back to defaults when override is missing', () => {
    // KEYBINDINGS has palette.open with default Ctrl+K
    expect(findConflict('chatHistory.toggle', 'Ctrl+K', {})).toBe('palette.open');
  });

  it('does not flag self', () => {
    expect(findConflict('palette.open', 'Ctrl+K', { 'palette.open': 'Ctrl+K' })).toBeNull();
  });

  it('treats empty combo as never-conflicting', () => {
    expect(findConflict('palette.open', '', { 'search.toggle': '' })).toBeNull();
  });
});

describe('mergeWithDefaults', () => {
  it('returns defaults when overrides empty', () => {
    const merged = mergeWithDefaults({});
    expect(merged['palette.open']).toBe('Ctrl+K');
    expect(merged['search.toggle']).toBe('Ctrl+Shift+F');
  });

  it('overrides take precedence', () => {
    const merged = mergeWithDefaults({ 'palette.open': 'Ctrl+J' });
    expect(merged['palette.open']).toBe('Ctrl+J');
    expect(merged['search.toggle']).toBe('Ctrl+Shift+F');
  });

  it('empty-string override keeps the binding unbound', () => {
    const merged = mergeWithDefaults({ 'palette.open': '' });
    expect(merged['palette.open']).toBe('');
  });

  it('unknown override keys are silently ignored', () => {
    const merged = mergeWithDefaults({ 'nonexistent.id': 'Ctrl+X' } as any);
    expect((merged as any)['nonexistent.id']).toBeUndefined();
  });
});

describe('KEYBINDINGS registry', () => {
  it('contains the 4 in-scope global shortcuts', () => {
    const ids = KEYBINDINGS.map(b => b.id);
    expect(ids).toContain('palette.open');
    expect(ids).toContain('chatHistory.toggle');
    expect(ids).toContain('search.toggle');
    expect(ids).toContain('markdownPreview.toggle');
  });
});
