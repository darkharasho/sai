import { useEffect, useState, useCallback, useId } from 'react';
import ModelViewer from '../../model3d/ModelViewer';
import { claim, release, useIsActiveModelCard } from '../../model3d/activeModelCard';
import type { ModelExt } from '../../model3d/modelFiles';

export interface ModelCardProps {
  renderId: string;
  path: string;
  versionKey: string | null;
  ext: ModelExt;
  thumbnailPath?: string;
  thumbnailDataUrl?: string;
  height: number;
  isNewest: boolean;
  /** Open the current file in the code panel. */
  onOpenFile?: (path: string) => void;
  /** Tool failed (no version produced). */
  error?: string;
  /** Tool call still in flight (history path); no versionKey yet. */
  running?: boolean;
}

const boxStyle = (height: number): React.CSSProperties => ({
  position: 'relative',
  width: '100%',
  height,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--sai-surface, #1a1a1a)',
  color: 'var(--text-muted)',
  fontSize: 12,
  overflow: 'hidden',
});

const pillStyle: React.CSSProperties = {
  position: 'absolute',
  right: 8,
  bottom: 8,
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 11,
  background: 'rgba(0,0,0,0.55)',
  color: '#fff',
  pointerEvents: 'none',
};

export function ModelCard({ renderId, path, versionKey, ext, thumbnailPath, thumbnailDataUrl, height, isNewest, onOpenFile, error, running }: ModelCardProps) {
  // Claim key is unique per mounted instance: renderId can collide (tc.id restarts
  // per turn / is absent), and two live WebGL contexts would break the budget.
  const instanceKey = useId();
  const active = useIsActiveModelCard(instanceKey);
  const [thumb, setThumb] = useState<string | null>(thumbnailDataUrl ?? null);
  const [missing, setMissing] = useState(false);

  // The newest card claims the live viewer on mount; any card releases on unmount.
  useEffect(() => {
    if (isNewest && versionKey !== null) claim(instanceKey);
    return () => release(instanceKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceKey, versionKey === null]);

  useEffect(() => {
    if (thumbnailDataUrl) { setThumb(thumbnailDataUrl); return; }
    if (!thumbnailPath) { setThumb(null); return; }
    let alive = true;
    Promise.resolve(window.sai?.fsReadFileBase64?.(thumbnailPath)).then((u) => {
      if (alive && typeof u === 'string' && u) setThumb(u);
    }).catch(() => { /* placeholder stays */ });
    return () => { alive = false; };
  }, [thumbnailPath, thumbnailDataUrl]);

  // (The viewer renders its own unavailable/error text; the card doesn't repeat it.)
  // Reset error state when the version changes.
  useEffect(() => { setMissing(false); }, [versionKey]);

  const load = useCallback(async () => {
    const buf = await window.sai.modelReadCached!(versionKey as string);
    if (!buf) {
      setMissing(true);
      throw new Error('model version unavailable');
    }
    return { buf, ext };
  }, [versionKey, ext]);

  if (versionKey === null) {
    return (
      <div style={boxStyle(height)} data-testid="model-card-pending">
        {error ? <span className="sai-render-card__err">{error}</span> : running ? 'Preparing model…' : 'Model unavailable'}
      </div>
    );
  }

  if (missing) {
    return (
      <div style={{ ...boxStyle(height), flexDirection: 'column', gap: 8 }} data-testid="model-card-unavailable">
        <span>Older version unavailable</span>
        {onOpenFile && path && (
          <button type="button" onClick={() => onOpenFile(path)}>Open current file</button>
        )}
      </div>
    );
  }

  if (active) {
    return (
      <div style={{ width: '100%', height }} data-testid="model-card-live">
        <ModelViewer
          load={load}
          height={height}
          wheelZoom={false}
        />
      </div>
    );
  }

  return (
    <div
      style={{ ...boxStyle(height), cursor: 'pointer' }}
      role="button"
      tabIndex={0}
      data-testid="model-card-inactive"
      onClick={() => claim(instanceKey)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); claim(instanceKey); } }}
    >
      {thumb && <img src={thumb} alt="Model preview" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
      <span style={pillStyle}>⟳ Click to rotate</span>
    </div>
  );
}
