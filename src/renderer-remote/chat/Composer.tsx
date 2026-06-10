import { useState, useRef } from 'react';
import { ChevronDown, ChevronUp, Minus, Shield, ShieldOff, Send, Square, Paperclip, X } from 'lucide-react';
import PickerSheet from './PickerSheet';
import type { SessionOverrides } from '../lib/overrides';

interface Props {
  streaming: boolean;
  onSend: (text: string, images?: string[]) => void;
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
  { value: 'claude-opus-4-8',           label: 'Opus',   hint: 'Most capable',  color: 'var(--orange)' },
  { value: 'claude-sonnet-4-6',         label: 'Sonnet', hint: 'Balanced',      color: 'var(--accent)' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku',  hint: 'Fastest',       color: 'var(--green)' },
];

const PERM_MODES: { value: 'auto' | 'auto-read' | 'always-ask'; label: string; hint?: string }[] = [
  { value: 'always-ask', label: 'Ask',     hint: 'Approve every tool' },
  { value: 'auto-read',  label: 'Auto-r',  hint: 'Allow reads, ask for writes' },
  { value: 'auto',       label: 'Bypass',  hint: 'Allow all tools (no prompts)' },
];

type Sheet = 'model' | 'permMode' | null;

interface Attachment { id: string; name: string; dataUrl: string; size: number }

const MAX_ATTACHMENTS = 6;
const MAX_BYTES_PER_FILE = 8 * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === 'string' ? r.result : '');
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(file);
  });
}

export default function Composer({ streaming, onSend, onInterrupt, overrides, onOverridesChange }: Props) {
  const [text, setText] = useState('');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = async (files: FileList | File[]) => {
    const incoming = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (incoming.length === 0) {
      setAttachError('Only image files are supported.');
      return;
    }
    setAttachError(null);
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      setAttachError(`Max ${MAX_ATTACHMENTS} images.`);
      return;
    }
    const slice = incoming.slice(0, room);
    const next: Attachment[] = [];
    for (const f of slice) {
      if (f.size > MAX_BYTES_PER_FILE) {
        setAttachError(`${f.name || 'image'} exceeds ${(MAX_BYTES_PER_FILE / 1024 / 1024).toFixed(0)}MB.`);
        continue;
      }
      try {
        const dataUrl = await readFileAsDataUrl(f);
        if (!dataUrl.startsWith('data:image/')) continue;
        next.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: f.name || 'image',
          dataUrl,
          size: f.size,
        });
      } catch {
        setAttachError('Could not read image.');
      }
    }
    if (next.length > 0) setAttachments((cur) => [...cur, ...next]);
  };

  const removeAttachment = (id: string) => setAttachments((cur) => cur.filter((a) => a.id !== id));

  const onAttachClick = () => {
    setAttachError(null);
    fileInputRef.current?.click();
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void addFiles(e.target.files);
    }
    // Reset so the same file can be re-selected later.
    e.target.value = '';
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const it of Array.from(items)) {
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f && f.type.startsWith('image/')) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  const submit = () => {
    const t = text.trim();
    if (!t && attachments.length === 0) return;
    const images = attachments.length > 0 ? attachments.map((a) => a.dataUrl) : undefined;
    // Always pass non-empty text — if user only attached images, send a
    // single-space placeholder so the backend doesn't reject an empty prompt.
    onSend(t || ' ', images);
    setText('');
    setAttachments([]);
    setAttachError(null);
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

  const canSend = text.trim().length > 0 || attachments.length > 0;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '8px 10px 10px',
        // The Chat root no longer reserves the bottom inset — the Composer
        // extends its bg-secondary into the home-indicator strip.
        paddingBottom: 'calc(10px + env(safe-area-inset-bottom))',
        gap: 6,
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
        minWidth: 0,
      }}
    >
      {attachments.length > 0 && (
        <div style={{
          display: 'flex',
          gap: 8,
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 2,
        }}>
          {attachments.map((a) => (
            <div
              key={a.id}
              style={{
                position: 'relative',
                flexShrink: 0,
                width: 56, height: 56,
                borderRadius: 8,
                overflow: 'hidden',
                border: '1px solid var(--border)',
                background: 'var(--bg-input)',
              }}
            >
              <img
                src={a.dataUrl}
                alt={a.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              <button
                type="button"
                onClick={() => removeAttachment(a.id)}
                aria-label={`Remove ${a.name}`}
                style={{
                  position: 'absolute',
                  top: 2, right: 2,
                  width: 18, height: 18,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  padding: 0,
                  background: 'rgba(0,0,0,0.65)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '50%',
                  cursor: 'pointer',
                }}
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {attachError && (
        <div style={{
          fontSize: 11,
          color: 'var(--red)',
          fontFamily: '"Geist Mono", ui-monospace, monospace',
        }}>
          {attachError}
        </div>
      )}

      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        onPaste={onPaste}
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

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={onFileInputChange}
        style={{ display: 'none' }}
      />

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        minWidth: 0,
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}>
        {/* Attach images */}
        <button
          type="button"
          onClick={onAttachClick}
          title="Attach image"
          aria-label="Attach image"
          disabled={attachments.length >= MAX_ATTACHMENTS}
          style={{
            ...toolbarBtn,
            color: attachments.length > 0 ? 'var(--accent)' : 'var(--text-muted)',
            flexShrink: 0,
            opacity: attachments.length >= MAX_ATTACHMENTS ? 0.4 : 1,
          }}
        >
          <Paperclip size={14} />
          {attachments.length > 0 && <span>{attachments.length}</span>}
        </button>

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
