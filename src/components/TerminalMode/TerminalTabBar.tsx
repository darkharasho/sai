// src/components/TerminalMode/TerminalTabBar.tsx
import { useState, useRef, useEffect } from 'react';

export interface TabInfo {
  id: string;
  name: string;
}

interface TerminalTabBarProps {
  tabs: TabInfo[];
  activeTabId: string;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onCreate: () => void;
  onRename: (tabId: string, name: string) => void;
}

export default function TerminalTabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onCreate,
  onRename,
}: TerminalTabBarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const editRef = useRef<HTMLInputElement>(null);
  const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editingId) editRef.current?.focus();
  }, [editingId]);

  useEffect(() => {
    if (!contextMenu) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  const startRename = (tab: TabInfo) => {
    setEditingId(tab.id);
    setEditValue(tab.name);
  };

  const commitRename = () => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  return (
    <div className="tt-bar">
      <div className="tt-tabs">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tt-tab ${tab.id === activeTabId ? 'tt-tab-active' : ''}`}
            onClick={() => onSelect(tab.id)}
            onDoubleClick={() => startRename(tab)}
            onContextMenu={(e) => { e.preventDefault(); setContextMenu({ tabId: tab.id, x: e.clientX, y: e.clientY }); }}
          >
            {editingId === tab.id ? (
              <input
                ref={editRef}
                className="tt-rename-input"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setEditingId(null);
                }}
              />
            ) : (
              <span className="tt-tab-name">{tab.name}</span>
            )}
            {tabs.length > 1 && (
              <span
                className="tt-tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
              >
                ×
              </span>
            )}
          </div>
        ))}
      </div>
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="tt-context-menu"
          style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x }}
        >
          <div
            className="tt-context-item"
            onMouseDown={(e) => {
              e.preventDefault();
              const tab = tabs.find(t => t.id === contextMenu.tabId);
              if (tab) startRename(tab);
              setContextMenu(null);
            }}
          >
            Rename
          </div>
        </div>
      )}
      <button className="tt-new" onClick={onCreate} title="New tab (Ctrl+T)">+</button>

      <style>{`
        .tt-bar {
          display: flex;
          align-items: center;
          background: #0c0f11;
          border-bottom: 1px solid #1a1e24;
          height: 32px;
          flex-shrink: 0;
          padding: 0 4px;
          gap: 2px;
          -webkit-app-region: drag;
        }
        .tt-tabs {
          display: flex;
          align-items: center;
          gap: 2px;
          overflow-x: auto;
          flex: 1;
          min-width: 0;
          -webkit-app-region: no-drag;
        }
        .tt-tabs::-webkit-scrollbar {
          display: none;
        }
        .tt-tab {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 4px;
          cursor: pointer;
          font-family: 'JetBrains Mono NF', 'JetBrains Mono', monospace;
          font-size: 11px;
          color: #6b7280;
          white-space: nowrap;
          flex-shrink: 0;
          user-select: none;
          -webkit-app-region: no-drag;
        }
        .tt-tab:hover {
          background: #111417;
          color: #9ca3af;
        }
        .tt-tab-active {
          background: #111417;
          color: #e5e7eb;
          box-shadow: inset 0 -2px 0 var(--accent, #58a6ff);
        }
        .tt-tab-name {
          max-width: 120px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .tt-tab-close {
          font-size: 14px;
          line-height: 1;
          color: #4b5563;
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.1s;
        }
        .tt-tab:hover .tt-tab-close {
          opacity: 1;
        }
        .tt-tab-close:hover {
          color: #ef4444;
        }
        .tt-rename-input {
          background: none;
          border: 1px solid #2d333b;
          border-radius: 2px;
          color: #e5e7eb;
          font-family: 'JetBrains Mono NF', 'JetBrains Mono', monospace;
          font-size: 11px;
          width: 80px;
          padding: 0 4px;
          outline: none;
        }
        .tt-new {
          background: none;
          border: none;
          color: #4b5563;
          font-size: 16px;
          cursor: pointer;
          padding: 2px 8px;
          border-radius: 4px;
          flex-shrink: 0;
          -webkit-app-region: no-drag;
        }
        .tt-new:hover {
          background: #111417;
          color: #9ca3af;
        }
        .tt-context-menu {
          background: #1a1e24;
          border: 1px solid #2d333b;
          border-radius: 4px;
          padding: 4px 0;
          min-width: 100px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.4);
          z-index: 1000;
        }
        .tt-context-item {
          padding: 6px 14px;
          font-family: 'JetBrains Mono NF', 'JetBrains Mono', monospace;
          font-size: 11px;
          color: #9ca3af;
          cursor: pointer;
          user-select: none;
        }
        .tt-context-item:hover {
          background: #21262d;
          color: #e5e7eb;
        }
      `}</style>
    </div>
  );
}
