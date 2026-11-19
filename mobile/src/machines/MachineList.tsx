import React, { useRef, useState } from 'react';
import type { Machine } from './store';
import type { Reach } from './hooks';

export interface MachineListProps {
  machines: Machine[];
  reach: Record<string, Reach>;
  onSelect(machine: Machine): void;
  onRename(id: string, label: string): void;
  onRemove(id: string): void;
  onAdd?(): void;
}

const dotColor: Record<Reach, string> = { checking: 'var(--text-muted)', online: '#3fb950', offline: '#e5534b' };
const LONG_PRESS_MS = 500;

function hostOf(baseUrl: string): string {
  try { return new URL(baseUrl).host; } catch { return baseUrl; }
}

export function MachineList({ machines, reach, onSelect, onRename, onRemove, onAdd }: MachineListProps) {
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  const startPress = (id: string) => {
    longPressed.current = false;
    timer.current = setTimeout(() => { longPressed.current = true; setMenuId(id); }, LONG_PRESS_MS);
  };
  const endPress = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };

  return (
    <div style={{ background: 'var(--surface-1)', color: 'var(--text)', minHeight: '100%', padding: 16 }}>
      <h1 style={{ fontSize: 'var(--text-xl)', margin: '0 0 12px' }}>Desktops</h1>
      {machines.length === 0 && (
        <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-md)' }}>No desktops paired yet.</p>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {machines.map((m) => {
          const state = reach[m.id] ?? 'checking';
          return (
            <li key={m.id} style={{ background: 'var(--surface-2)', borderRadius: 10 }}>
              {renaming?.id === m.id ? (
                <form
                  style={{ display: 'flex', gap: 8, padding: 12 }}
                  onSubmit={(e) => { e.preventDefault(); const v = renaming.value.trim(); if (v) onRename(m.id, v); setRenaming(null); }}
                >
                  <input
                    aria-label="Machine name"
                    autoFocus
                    value={renaming.value}
                    onChange={(e) => setRenaming({ id: m.id, value: e.target.value })}
                    style={{ flex: 1, background: 'var(--surface-3)', color: 'var(--text)', border: 0, borderRadius: 6, padding: 8, fontSize: 16 }}
                  />
                  <button type="submit">Save</button>
                </form>
              ) : (
                <button
                  type="button"
                  data-testid={`machine-${m.id}`}
                  onClick={() => { if (longPressed.current) { longPressed.current = false; return; } onSelect(m); }}
                  onPointerDown={() => startPress(m.id)}
                  onPointerUp={endPress}
                  onPointerLeave={endPress}
                  onPointerCancel={endPress}
                  onContextMenu={(e) => { e.preventDefault(); setMenuId(m.id); }}
                  style={{ all: 'unset', display: 'flex', alignItems: 'center', gap: 12, padding: 14, width: '100%', boxSizing: 'border-box', cursor: 'pointer' }}
                >
                  <span
                    role="img"
                    aria-label={state}
                    data-reach={state}
                    style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: dotColor[state] }}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 'var(--text-lg)' }}>{m.label}</span>
                    <span style={{ display: 'block', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hostOf(m.baseUrl)}</span>
                  </span>
                </button>
              )}
              {menuId === m.id && (
                <div role="menu" style={{ display: 'flex', gap: 8, padding: '0 12px 12px' }}>
                  <button role="menuitem" onClick={() => { setMenuId(null); setRenaming({ id: m.id, value: m.label }); }}>Rename</button>
                  <button role="menuitem" onClick={() => { setMenuId(null); onRemove(m.id); }} style={{ color: '#e5534b' }}>Remove</button>
                  <button role="menuitem" onClick={() => setMenuId(null)}>Cancel</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          style={{ marginTop: 16, width: '100%', padding: 14, border: 0, borderRadius: 10, background: 'var(--accent)', color: 'var(--surface-0)', fontSize: 'var(--text-lg)' }}
        >
          Pair a desktop
        </button>
      )}
    </div>
  );
}
