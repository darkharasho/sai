import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { AIProvider } from '../../types';

type ModelChoice = 'default' | 'best' | 'sonnet' | 'opus' | 'haiku' | 'sonnet[1m]' | 'opus[1m]' | 'opusplan';

// Mirrors MODEL_OPTIONS in src/components/Chat/ChatInput.tsx — duplicated
// intentionally so the picker has no cross-component import on a non-exported
// constant.
const MODEL_OPTIONS: { id: ModelChoice; label: string; description: string; color: string; recommended?: boolean }[] = [
  { id: 'default',    label: 'Default',    description: 'Your account’s recommended model',                color: 'var(--text-secondary)' },
  { id: 'sonnet',     label: 'Sonnet',     description: 'Claude Sonnet 4.6 · Best for everyday tasks',     color: 'var(--accent)', recommended: true },
  { id: 'opus',       label: 'Opus',       description: 'Claude Opus 4.7 · Most capable for complex work', color: 'var(--orange)' },
  { id: 'haiku',      label: 'Haiku',      description: 'Claude Haiku · Fastest for quick answers',        color: 'var(--green)' },
  { id: 'best',       label: 'Best',       description: 'Most capable available (currently Opus)',              color: 'var(--orange)' },
  { id: 'opusplan',   label: 'Opus Plan',  description: 'Opus in plan mode, Sonnet for execution',              color: 'var(--orange)' },
  { id: 'sonnet[1m]', label: 'Sonnet 1M',  description: 'Sonnet with 1M token context for long sessions',       color: 'var(--accent)' },
  { id: 'opus[1m]',   label: 'Opus 1M',    description: 'Opus with 1M token context for long sessions',         color: 'var(--orange)' },
];

const PROVIDERS: { id: AIProvider; label: string; enabled: boolean; defaultModel: string }[] = [
  { id: 'claude', label: 'Claude', enabled: true,  defaultModel: 'opus' },
  { id: 'codex',  label: 'Codex',  enabled: false, defaultModel: 'o3' },
  { id: 'gemini', label: 'Gemini', enabled: false, defaultModel: 'auto-gemini-3' },
];

interface Props {
  provider: AIProvider;
  model: string;
  onChange: (provider: AIProvider, model: string) => void;
  disabled?: boolean;
}

function modelLabel(provider: AIProvider, model: string): string {
  if (provider === 'claude') {
    const found = MODEL_OPTIONS.find(m => m.id === model);
    return found ? found.label : (model || 'Default');
  }
  return model || 'Model';
}

export default function OrchestratorModelPicker({ provider, model, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const providerLabel = PROVIDERS.find(p => p.id === provider)?.label ?? provider;
  const mLabel = modelLabel(provider, model);

  return (
    <div
      ref={wrapperRef}
      className="orch-model-picker"
      data-testid="orch-model-picker"
      // Bump z-index when open so the dropdown — which extends down past the
      // header into the chat-area's DOM order — paints above the chat input.
      // Neither wrapper creates a stacking context by default; assign one here
      // when the dropdown is shown so its children win against later siblings.
      style={{ position: 'relative', display: 'inline-block', zIndex: open ? 5000 : 'auto' }}
    >
      <button
        type="button"
        disabled={disabled}
        data-testid="orch-model-picker-button"
        onClick={() => setOpen(o => !o)}
        title="Pick orchestrator provider and model"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          background: 'none',
          border: '1px solid var(--border)',
          color: 'var(--text-muted)',
          padding: '2px 6px',
          borderRadius: 4,
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: 11,
          lineHeight: 1.2,
          opacity: disabled ? 0.5 : 0.85,
        }}
      >
        <span>{providerLabel}{mLabel ? ` ${mLabel}` : ''}</span>
        <ChevronDown size={11} style={{ opacity: 0.6 }} />
      </button>

      {open && (
        <div
          className="orch-model-dropdown"
          data-testid="orch-model-picker-dropdown"
          role="menu"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 4px)',
            minWidth: 260,
            background: 'var(--bg-elevated, var(--bg, #1c1c1c))',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 6,
            zIndex: 1000,
            boxShadow: '0 6px 20px rgba(0,0,0,0.3)',
            fontSize: 11,
            color: 'var(--text)',
          }}
        >
          <div style={{ fontSize: 10, opacity: 0.55, padding: '4px 8px', textTransform: 'uppercase', letterSpacing: 1 }}>
            Provider
          </div>
          {PROVIDERS.map(p => {
            const isSelected = p.id === provider && p.enabled;
            const isDisabled = !p.enabled;
            return (
              <button
                key={p.id}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                disabled={isDisabled}
                data-testid={`orch-model-picker-provider-${p.id}`}
                title={isDisabled ? 'Orchestrator chat-driven dispatch requires Claude' : `Use ${p.label}`}
                onClick={() => {
                  if (isDisabled) return;
                  if (p.id !== provider) onChange(p.id, p.defaultModel);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  background: isSelected ? 'var(--bg-hover, rgba(255,255,255,0.06))' : 'transparent',
                  color: isDisabled ? 'var(--text-muted)' : 'var(--text)',
                  border: 'none',
                  padding: '6px 8px',
                  borderRadius: 4,
                  cursor: isDisabled ? 'not-allowed' : 'pointer',
                  fontSize: 11,
                  textAlign: 'left',
                  opacity: isDisabled ? 0.45 : 1,
                }}
              >
                <span>{p.label}{isDisabled ? ' (unavailable)' : ''}</span>
                {isSelected && <Check size={13} style={{ color: 'var(--accent)' }} />}
              </button>
            );
          })}

          <div style={{ height: 1, background: 'var(--border)', margin: '6px 0', opacity: 0.5 }} />

          <div style={{ fontSize: 10, opacity: 0.55, padding: '4px 8px', textTransform: 'uppercase', letterSpacing: 1 }}>
            Model
          </div>

          {provider === 'claude' ? (
            MODEL_OPTIONS.map(opt => {
              const isSelected = opt.id === model;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isSelected}
                  data-testid={`orch-model-picker-model-${opt.id}`}
                  onClick={() => {
                    onChange('claude', opt.id);
                    setOpen(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    background: isSelected ? 'var(--bg-hover, rgba(255,255,255,0.06))' : 'transparent',
                    color: 'var(--text)',
                    border: 'none',
                    padding: '6px 8px',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 11,
                    textAlign: 'left',
                  }}
                >
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ color: isSelected ? opt.color : undefined, fontWeight: isSelected ? 600 : 400 }}>
                      {opt.label}
                      {opt.recommended && (
                        <span style={{ marginLeft: 6, fontSize: 9, opacity: 0.6 }}>(recommended)</span>
                      )}
                    </span>
                    <span style={{ fontSize: 10, opacity: 0.6 }}>{opt.description}</span>
                  </span>
                  {isSelected && <Check size={13} style={{ color: opt.color, flexShrink: 0 }} />}
                </button>
              );
            })
          ) : (
            <div
              data-testid="orch-model-picker-unavailable"
              style={{ padding: '8px', opacity: 0.6, fontSize: 11, fontStyle: 'italic' }}
            >
              (model selection unavailable for orchestrator yet)
            </div>
          )}
        </div>
      )}
    </div>
  );
}
