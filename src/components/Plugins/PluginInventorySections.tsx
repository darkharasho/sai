import { useState } from 'react';
import type { PluginInventory, PluginItem } from '../../types';
import { INVENTORY_SECTIONS } from './pluginView';

const PREVIEW = 4;

function Section({ label, items, prefix, action }: { label: string; items: PluginItem[]; prefix: string; action?: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, PREVIEW);
  return (
    <div className="plg-sec">
      <h4><span>{label} · {items.length}</span>{action}</h4>
      {shown.map(item => (
        <div key={item.name} className="plg-item" title={item.description ? `${item.name} — ${item.description}` : item.name}>
          {prefix}{item.name}{item.description && <span>{item.description}</span>}
        </div>
      ))}
      {items.length > PREVIEW && (
        <button className="plg-link" onClick={() => setExpanded(e => !e)}>
          {expanded ? 'Show less' : `+ ${items.length - PREVIEW} more`}
        </button>
      )}
    </div>
  );
}

/** One section per non-empty component kind. */
export default function PluginInventorySections({ inventory, onOpenMcp }: { inventory: PluginInventory; onOpenMcp?: () => void }) {
  return (
    <>
      {INVENTORY_SECTIONS.filter(s => inventory[s.key].length > 0).map(s => (
        <Section
          key={s.key}
          label={s.label}
          items={inventory[s.key]}
          prefix={s.key === 'commands' ? '/' : ''}
          action={s.key === 'mcpServers' && onOpenMcp
            ? <button className="plg-link" style={{ padding: 0, textTransform: 'none', letterSpacing: 0 }} onClick={onOpenMcp}>Open MCP panel</button>
            : undefined}
        />
      ))}
    </>
  );
}
