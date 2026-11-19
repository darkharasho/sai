import React, { useRef, useState } from 'react';
import { Bell, Plus } from 'lucide-react';
import type { Machine } from './store';
import type { Reach } from './hooks';
import type { PushPermission } from '../native';

export interface NotificationsRow {
  permission: PushPermission;
  /** Opens this app's page in iOS Settings (offered when denied). */
  onOpenSettings(): void;
}

export interface MachineListProps {
  machines: Machine[];
  reach: Record<string, Reach>;
  onSelect(machine: Machine): void;
  onRename(id: string, label: string): void;
  onRemove(id: string): void;
  onAdd?(): void;
  /** The push permission row; omitted where push isn't available. */
  notifications?: NotificationsRow;
}

const permissionText: Record<PushPermission, string> = { granted: 'On', denied: 'Off', prompt: 'Asked after pairing' };

const dotColor: Record<Reach, string> = { checking: 'var(--text-muted)', online: '#3fb950', offline: '#e5534b' };
const LONG_PRESS_MS = 500;

function hostOf(baseUrl: string): string {
  try { return new URL(baseUrl).host; } catch { return baseUrl; }
}

export function MachineList({ machines, reach, onSelect, onRename, onRemove, onAdd, notifications }: MachineListProps) {
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
    <div className="sai-phone-page">
      <div className="sai-phone-page-head"><h1>Desktops</h1></div>
      {machines.length === 0 && (
        <p className="sai-phone-page-lede">No desktops paired yet.</p>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {machines.map((m) => {
          const state = reach[m.id] ?? 'checking';
          return (
            <li key={m.id} style={{ background: 'var(--surface-2)', border: '1px solid var(--border-hairline)', borderRadius: 12 }}>
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
                    style={{ flex: 1, background: 'var(--surface-3)', color: 'var(--text)', border: '1px solid var(--border-accent)', borderRadius: 8, padding: 8, fontSize: 16 }}
                  />
                  <button type="submit" className="sai-phone-chip">Save</button>
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
                  <button role="menuitem" className="sai-phone-chip" onClick={() => { setMenuId(null); setRenaming({ id: m.id, value: m.label }); }}>Rename</button>
                  <button role="menuitem" className="sai-phone-chip sai-phone-danger" onClick={() => { setMenuId(null); onRemove(m.id); }}>Remove</button>
                  <button role="menuitem" className="sai-phone-chip" onClick={() => setMenuId(null)}>Cancel</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {onAdd && (
        <button
          type="button"
          className="sai-phone-primary"
          onClick={onAdd}
        >
          <Plus size={18} aria-hidden="true" />Pair a desktop
        </button>
      )}
      {notifications && (
        <div
          data-testid="notifications-row"
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, background: 'var(--surface-2)', border: '1px solid var(--border-hairline)', borderRadius: 12 }}
        >
          <Bell size={18} aria-hidden="true" style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 'var(--text-lg)' }}>Notifications</span>
          <span style={{ fontSize: 'var(--text-md)', color: 'var(--text-secondary)' }}>{permissionText[notifications.permission]}</span>
          {notifications.permission === 'denied' && (
            <button type="button" className="sai-phone-chip" onClick={notifications.onOpenSettings}>Open Settings</button>
          )}
        </div>
      )}
    </div>
  );
}
