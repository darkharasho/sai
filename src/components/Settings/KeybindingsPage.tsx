import { useEffect, useState, useCallback } from 'react';
import { Pencil, RotateCcw, AlertTriangle } from 'lucide-react';
import {
  KEYBINDINGS,
  type KeybindingId,
  type KeyCombo,
  type Platform,
  eventToCombo,
  formatCombo,
  findConflict,
  mergeWithDefaults,
} from '../../utils/keybindings';
import './KeybindingsPage.css';

type Overrides = Partial<Record<KeybindingId, KeyCombo>>;

const RESERVED = new Set([
  'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A', 'Ctrl+Z', 'Ctrl+Y',
  'Tab', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
]);

function detectPlatform(): Platform {
  const p = (window as any).sai?.platform ?? '';
  if (p === 'darwin' || p === 'mac' || /Mac/.test(navigator.platform)) return 'mac';
  if (p === 'win32' || /Win/.test(navigator.platform)) return 'windows';
  return 'linux';
}

export default function KeybindingsPage() {
  const [overrides, setOverrides] = useState<Overrides>({});
  const [filter, setFilter] = useState('');
  const [editingId, setEditingId] = useState<KeybindingId | null>(null);
  const [conflict, setConflict] = useState<{ id: KeybindingId; combo: KeyCombo; conflictWith: KeybindingId } | null>(null);
  const [resetAllOpen, setResetAllOpen] = useState(false);
  const platform = detectPlatform();

  // Load saved overrides on mount
  useEffect(() => {
    void (async () => {
      const stored = await (window as any).sai?.settingsGet?.('keybindings', {});
      setOverrides(stored ?? {});
    })();
  }, []);

  const persist = useCallback(async (next: Overrides) => {
    setOverrides(next);
    await (window as any).sai?.settingsSet?.('keybindings', next);
    window.dispatchEvent(new CustomEvent('sai:keybindings-changed'));
  }, []);

  // Capture: a global keydown listener while editing
  useEffect(() => {
    if (!editingId) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setEditingId(null);
        return;
      }
      const combo = eventToCombo(e);
      if (!combo) return;   // pure modifier — keep waiting
      const conflictWith = findConflict(editingId, combo, overrides);
      if (conflictWith) {
        setConflict({ id: editingId, combo, conflictWith });
        setEditingId(null);
        return;
      }
      void persist({ ...overrides, [editingId]: combo });
      setEditingId(null);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [editingId, overrides, persist]);

  const handleResetRow = (id: KeybindingId) => {
    const next = { ...overrides };
    delete next[id];
    void persist(next);
  };

  const handleResetAll = () => {
    void persist({});
    setResetAllOpen(false);
  };

  const handleConflictConfirm = () => {
    if (!conflict) return;
    const next = { ...overrides, [conflict.id]: conflict.combo, [conflict.conflictWith]: '' };
    void persist(next);
    setConflict(null);
  };

  const merged = mergeWithDefaults(overrides);
  const rows = KEYBINDINGS.filter(b =>
    !filter || b.label.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="keybindings-page">
      <input
        type="text"
        className="keybindings-search"
        placeholder="Search keybindings..."
        value={filter}
        onChange={e => setFilter(e.target.value)}
      />

      <div className="keybindings-list">
        {rows.map(def => {
            const current = merged[def.id];
            const isEditing = editingId === def.id;
            const isDefault = !overrides[def.id] || overrides[def.id] === def.defaultCombo;
            const isReserved = current && RESERVED.has(current);
            return (
              <div key={def.id} className="keybinding-row">
                <span className="keybinding-label">{def.label}</span>
                <span className="keybinding-combo">
                  {isEditing ? (
                    <em>Press keys… (Esc to cancel)</em>
                  ) : (
                    formatCombo(current, platform)
                  )}
                  {isReserved && (
                    <span className="keybinding-warn" title="May not fire reliably (browser shortcut)">
                      <AlertTriangle size={11} />
                    </span>
                  )}
                </span>
                <button
                  className="keybinding-edit"
                  title="Edit"
                  onClick={() => setEditingId(def.id)}
                  disabled={isEditing}
                ><Pencil size={12} /></button>
                <button
                  className="keybinding-reset"
                  title="Reset to default"
                  onClick={() => handleResetRow(def.id)}
                  disabled={isDefault}
                ><RotateCcw size={12} /></button>
              </div>
            );
        })}
      </div>

      <div className="keybindings-footer">
        <button
          className="keybindings-reset-all"
          onClick={() => setResetAllOpen(true)}
        >Reset all to defaults</button>
      </div>

      {conflict && (
        <div className="keybindings-modal-overlay" onClick={() => setConflict(null)}>
          <div className="keybindings-modal" onClick={e => e.stopPropagation()}>
            <p>
              <strong>{formatCombo(conflict.combo, platform)}</strong> is currently bound to{' '}
              <strong>{KEYBINDINGS.find(k => k.id === conflict.conflictWith)?.label}</strong>.
              Reassign it to <strong>{KEYBINDINGS.find(k => k.id === conflict.id)?.label}</strong>?
            </p>
            <div className="keybindings-modal-buttons">
              <button onClick={() => setConflict(null)}>Cancel</button>
              <button className="primary" onClick={handleConflictConfirm}>Reassign</button>
            </div>
          </div>
        </div>
      )}

      {resetAllOpen && (
        <div className="keybindings-modal-overlay" onClick={() => setResetAllOpen(false)}>
          <div className="keybindings-modal" onClick={e => e.stopPropagation()}>
            <p>Reset all keybindings to their defaults?</p>
            <div className="keybindings-modal-buttons">
              <button onClick={() => setResetAllOpen(false)}>Cancel</button>
              <button className="primary" onClick={handleResetAll}>Reset</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
