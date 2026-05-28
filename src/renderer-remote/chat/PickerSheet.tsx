interface Option<T> {
  value: T;
  label: string;
  hint?: string;
}

interface Props<T> {
  open: boolean;
  title: string;
  options: Option<T>[];
  current: T | undefined;
  onSelect: (value: T | undefined) => void;
  onClose: () => void;
  allowClear?: boolean;
  clearLabel?: string;
}

export default function PickerSheet<T extends string>({
  open, title, options, current, onSelect, onClose, allowClear, clearLabel,
}: Props<T>) {
  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        background: 'rgba(0,0,0,0.55)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-secondary)',
          borderTop: '1px solid var(--border)',
          borderTopLeftRadius: 14,
          borderTopRightRadius: 14,
          paddingBottom: 'env(safe-area-inset-bottom)',
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{
          padding: '14px 16px 10px',
          fontFamily: '"Geist Mono", ui-monospace, monospace',
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--text-muted)',
          borderBottom: '1px solid var(--border)',
        }}>
          {title}
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {allowClear && (
            <button
              onClick={() => { onSelect(undefined); onClose(); }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '12px 16px',
                background: 'transparent',
                color: current === undefined ? 'var(--accent)' : 'var(--text-muted)',
                border: 'none',
                borderBottom: '1px solid var(--border)',
                fontFamily: 'inherit',
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              {clearLabel ?? 'Use desktop default'}
            </button>
          )}
          {options.map((opt) => {
            const selected = opt.value === current;
            return (
              <button
                key={String(opt.value)}
                onClick={() => { onSelect(opt.value); onClose(); }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px 16px',
                  background: 'transparent',
                  color: selected ? 'var(--accent)' : 'var(--text)',
                  border: 'none',
                  borderBottom: '1px solid var(--border)',
                  fontFamily: 'inherit',
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: selected ? 600 : 400 }}>{opt.label}</div>
                {opt.hint && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {opt.hint}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
