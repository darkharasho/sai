import { useState, useRef } from 'react';
import { ChevronDown, ChevronUp, ChevronsUp, Minus, Shield, ShieldOff, Send, Square } from 'lucide-react';
import PickerSheet from './PickerSheet';
import type { SessionOverrides } from '../lib/overrides';

interface Props {
  streaming: boolean;
  onSend: (text: string) => void;
  onInterrupt: () => void;
  overrides: SessionOverrides;
  onOverridesChange: (next: SessionOverrides) => void;
}

const EFFORT_CONFIG = {
  low:    { icon: ChevronDown, label: 'Lo',  color: 'var(--text-muted)',      next: 'medium' as const },
  medium: { icon: Minus,       label: 'Med', color: 'var(--text-secondary)',  next: 'high'   as const },
  high:   { icon: ChevronUp,   label: 'Hi',  color: 'var(--accent)',          next: 'low'    as const },
};

const MODEL_OPTIONS: { value: string; label: string; hint?: string; color: string }[] = [
  { value: 'claude-opus-4-7',           label: 'Opus',   hint: 'Most capable',  color: 'var(--orange)' },
  { value: 'claude-sonnet-4-6',         label: 'Sonnet', hint: 'Balanced',      color: 'var(--accent)' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku',  hint: 'Fastest',       color: 'var(--green)' },
];

const PERM_MODES: { value: 'auto' | 'auto-read' | 'always-ask'; label: string; hint?: string }[] = [
  { value: 'always-ask', label: 'Ask',     hint: 'Approve every tool' },
  { value: 'auto-read',  label: 'Auto-r',  hint: 'Allow reads, ask for writes' },
  { value: 'auto',       label: 'Bypass',  hint: 'Allow all tools (no prompts)' },
];

type Sheet = 'model' | 'permMode' | null;

export default function Composer({ streaming, onSend, onInterrupt, overrides, onOverridesChange }: Props) {
  const [text, setText] = useState('');
  const [sheet, setSheet] = useState<Sheet>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
    ref.current?.blur();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  // Effort cycles on tap (low → med → hi → low), like the desktop button.
  const effort = (overrides.effort ?? 'medium') as keyof typeof EFFORT_CONFIG;
  const effortCfg = EFFORT_CONFIG[effort];
  const cycleEffort = () => onOverridesChange({ ...overrides, effort: effortCfg.next });
  const EffortIcon = effortCfg.icon;

  const model = MODEL_OPTIONS.find((m) => m.value === overrides.model);
  const permMode = PERM_MODES.find((p) => p.value === overrides.permMode);
  const bypassActive = overrides.permMode === 'auto';

  const toolbarBtn: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 8px',
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: '"Geist Mono", ui-monospace, monospace',
    color: 'var(--text-muted)',
    height: 26,
  };

  const canSend = text.trim().length > 0;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '8px 10px 10px',
        gap: 6,
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
        minWidth: 0,
      }}
    >
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder={streaming ? 'Responding…' : 'Message'}
        rows={1}
        style={{
          width: '100%',
          minWidth: 0,
          resize: 'none',
          fontFamily: 'inherit',
          fontSize: 16, // prevents iOS auto-zoom
          lineHeight: 1.4,
          padding: '10px 12px',
          background: 'var(--bg-input)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          outline: 'none',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
      />

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        minWidth: 0,
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}>
        {/* Effort — cycle on tap */}
        <button
          type="button"
          onClick={cycleEffort}
          title={`Effort: ${effort} — tap to cycle`}
          style={{ ...toolbarBtn, color: effortCfg.color, flexShrink: 0 }}
        >
          <EffortIcon size={14} />
          <span>{effortCfg.label}</span>
        </button>

        {/* Model — opens PickerSheet */}
        <button
          type="button"
          onClick={() => setSheet('model')}
          style={{ ...toolbarBtn, color: model?.color ?? 'var(--text-muted)', flexShrink: 0 }}
        >
          <span>{model?.label ?? 'Model'}</span>
          <ChevronDown size={11} style={{ opacity: 0.6 }} />
        </button>

        {/* PermMode — Shield / ShieldOff */}
        <button
          type="button"
          onClick={() => setSheet('permMode')}
          style={{
            ...toolbarBtn,
            color: bypassActive ? 'var(--orange)' : 'var(--text-muted)',
            borderColor: bypassActive ? 'var(--orange)' : 'transparent',
            flexShrink: 0,
          }}
        >
          {bypassActive
            ? <ShieldOff size={13} />
            : <Shield size={13} />}
          <span>{permMode?.label ?? 'Mode'}</span>
        </button>

        <div style={{ flex: 1 }} />

        {/* Send / Stop button */}
        {streaming ? (
          <button
            type="button"
            onClick={onInterrupt}
            title="Stop"
            style={{
              ...toolbarBtn,
              color: 'var(--red)',
              borderColor: 'var(--red)',
              flexShrink: 0,
            }}
          >
            <Square size={13} fill="var(--red)" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            title="Send"
            style={{
              ...toolbarBtn,
              padding: '4px 10px',
              background: canSend ? 'var(--accent)' : 'transparent',
              color: canSend ? '#000' : 'var(--text-muted)',
              borderColor: canSend ? 'var(--accent)' : 'var(--border)',
              flexShrink: 0,
              opacity: canSend ? 1 : 0.7,
            }}
          >
            <Send size={13} />
          </button>
        )}
      </div>

      <PickerSheet
        open={sheet === 'model'}
        title="Model"
        options={MODEL_OPTIONS}
        current={overrides.model}
        onSelect={(v) => onOverridesChange({ ...overrides, model: v })}
        onClose={() => setSheet(null)}
        allowClear
      />
      <PickerSheet
        open={sheet === 'permMode'}
        title="Approval mode"
        options={PERM_MODES}
        current={overrides.permMode}
        onSelect={(v) => onOverridesChange({ ...overrides, permMode: v })}
        onClose={() => setSheet(null)}
        allowClear
      />
    </div>
  );
}
