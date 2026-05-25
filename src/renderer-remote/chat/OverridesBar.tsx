import { useState } from 'react';
import PickerSheet from './PickerSheet';
import type { SessionOverrides } from '../lib/overrides';

const CLAUDE_MODELS: { value: string; label: string; hint?: string }[] = [
  { value: 'claude-opus-4-7',           label: 'Opus 4.7',   hint: 'most capable' },
  { value: 'claude-sonnet-4-6',         label: 'Sonnet 4.6', hint: 'balanced' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5',  hint: 'fastest' },
];

const EFFORTS: { value: 'low' | 'medium' | 'high'; label: string }[] = [
  { value: 'low',    label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high',   label: 'High' },
];

const PERM_MODES: { value: 'auto' | 'auto-read' | 'always-ask'; label: string; hint?: string }[] = [
  { value: 'auto',        label: 'Auto',        hint: 'allow all tools' },
  { value: 'auto-read',   label: 'Auto reads',  hint: 'allow reads, ask for writes' },
  { value: 'always-ask',  label: 'Always ask',  hint: 'approve every tool' },
];

type Field = 'model' | 'effort' | 'permMode';

interface Props {
  overrides: SessionOverrides;
  onChange: (next: SessionOverrides) => void;
}

export default function OverridesBar({ overrides, onChange }: Props) {
  const [open, setOpen] = useState<Field | null>(null);

  const chipBase: React.CSSProperties = {
    flexShrink: 0,
    padding: '4px 10px',
    fontSize: 12,
    fontFamily: '"Geist Mono", ui-monospace, monospace',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 999,
    cursor: 'pointer',
  };

  const modelLabel = overrides.model
    ? (CLAUDE_MODELS.find((m) => m.value === overrides.model)?.label ?? overrides.model)
    : 'default model';
  const effortLabel = overrides.effort ? `effort: ${overrides.effort}` : 'effort: default';
  const modeLabel = overrides.permMode ? `mode: ${overrides.permMode}` : 'mode: default';

  const chipStyle = (set: boolean): React.CSSProperties => ({
    ...chipBase,
    color: set ? 'var(--accent)' : 'var(--text-muted)',
    borderColor: set ? 'var(--accent)' : 'var(--border)',
  });

  const allClear = !overrides.model && !overrides.effort && !overrides.permMode;

  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        alignItems: 'center',
        padding: '6px 10px',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-mid)',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <button style={chipStyle(!!overrides.model)} onClick={() => setOpen('model')}>{modelLabel}</button>
      <button style={chipStyle(!!overrides.effort)} onClick={() => setOpen('effort')}>{effortLabel}</button>
      <button style={chipStyle(!!overrides.permMode)} onClick={() => setOpen('permMode')}>{modeLabel}</button>
      {!allClear && (
        <button
          onClick={() => onChange({})}
          style={{
            flexShrink: 0,
            marginLeft: 'auto',
            padding: '4px 8px',
            fontSize: 11,
            background: 'transparent',
            color: 'var(--text-muted)',
            border: 'none',
            cursor: 'pointer',
            textDecoration: 'underline',
          }}
        >
          reset
        </button>
      )}

      <PickerSheet
        open={open === 'model'}
        title="Model"
        options={CLAUDE_MODELS}
        current={overrides.model}
        onSelect={(v) => onChange({ ...overrides, model: v })}
        onClose={() => setOpen(null)}
        allowClear
      />
      <PickerSheet
        open={open === 'effort'}
        title="Effort"
        options={EFFORTS}
        current={overrides.effort}
        onSelect={(v) => onChange({ ...overrides, effort: v })}
        onClose={() => setOpen(null)}
        allowClear
      />
      <PickerSheet
        open={open === 'permMode'}
        title="Approval mode"
        options={PERM_MODES}
        current={overrides.permMode}
        onSelect={(v) => onChange({ ...overrides, permMode: v })}
        onClose={() => setOpen(null)}
        allowClear
      />
    </div>
  );
}
