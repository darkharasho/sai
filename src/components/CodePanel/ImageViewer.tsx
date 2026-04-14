import { useState, useEffect, useCallback } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { isSvgFile, getImageType } from '../../utils/imageFiles';
import MonacoEditor from '../FileExplorer/MonacoEditor';

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 10;

const zoomBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  padding: '4px 6px',
  borderRadius: 4,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

interface ImageViewerProps {
  filePath: string;
  projectPath: string;
  onEditorSave?: (filePath: string, content: string) => Promise<void>;
  onEditorContentChange?: (filePath: string, content: string) => void;
  onEditorDirtyChange?: (filePath: string, dirty: boolean) => void;
  editorFontSize?: number;
  editorMinimap?: boolean;
}

export default function ImageViewer({
  filePath,
  projectPath,
  onEditorSave,
  onEditorContentChange,
  onEditorDirtyChange,
  editorFontSize = 13,
  editorMinimap = true,
}: ImageViewerProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(null);
  const [svgSourceMode, setSvgSourceMode] = useState(false);
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [cacheKey, setCacheKey] = useState(0);
  const [zoom, setZoom] = useState(1);

  const isSvg = isSvgFile(filePath);
  const imageType = getImageType(filePath);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setDimensions(null);
    setSvgSourceMode(false);
    setSvgContent(null);
    setCacheKey(0);
    setZoom(1);

    window.sai.fsReadFileBase64(filePath).then((url: string) => {
      if (!cancelled) setDataUrl(url);
    }).catch(() => {
      if (!cancelled) setDataUrl(null);
    });

    return () => { cancelled = true; };
  }, [filePath]);

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setDimensions({ w: img.naturalWidth, h: img.naturalHeight });
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoom(z => Math.min(z + ZOOM_STEP, ZOOM_MAX));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(z => Math.max(z - ZOOM_STEP, ZOOM_MIN));
  }, []);

  const handleZoomReset = useCallback(() => {
    setZoom(1);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom(z => {
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        return Math.min(Math.max(z + delta, ZOOM_MIN), ZOOM_MAX);
      });
    }
  }, []);

  const handleToggleSource = useCallback(async () => {
    if (!svgSourceMode && svgContent === null) {
      try {
        const content = await window.sai.fsReadFile(filePath) as string;
        setSvgContent(content);
      } catch {
        return;
      }
    }
    setSvgSourceMode(prev => !prev);
  }, [filePath, svgSourceMode, svgContent]);

  const handleSvgSave = useCallback(async (fp: string, content: string) => {
    if (onEditorSave) await onEditorSave(fp, content);
    setSvgContent(content);
    setCacheKey(prev => prev + 1);
  }, [onEditorSave]);

  if (svgSourceMode && svgContent !== null) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <button
          onClick={handleToggleSource}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 10,
            padding: '4px 10px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            fontSize: 11,
            color: 'var(--text-muted)',
            cursor: 'pointer',
          }}
        >
          Preview
        </button>
        <MonacoEditor
          key={filePath + '-svg-source'}
          filePath={filePath}
          content={svgContent}
          fontSize={editorFontSize}
          minimap={editorMinimap}
          projectPath={projectPath}
          onSave={handleSvgSave}
          onContentChange={onEditorContentChange}
          onDirtyChange={onEditorDirtyChange ? (dirty) => onEditorDirtyChange(filePath, dirty) : undefined}
        />
      </div>
    );
  }

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Checkerboard background + scrollable image */}
      <div
        onWheel={handleWheel}
        style={{
          flex: 1,
          overflow: 'auto',
          backgroundImage: `
            linear-gradient(45deg, #1e1e1e 25%, transparent 25%),
            linear-gradient(-45deg, #1e1e1e 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #1e1e1e 75%),
            linear-gradient(-45deg, transparent 75%, #1e1e1e 75%)
          `,
          backgroundSize: '20px 20px',
          backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
          backgroundColor: '#181818',
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100%',
          padding: 24,
        }}>
          {dataUrl ? (
            <img
              src={dataUrl + (cacheKey > 0 ? `#${cacheKey}` : '')}
              alt={filePath.split('/').pop() ?? ''}
              onLoad={handleImageLoad}
              draggable={false}
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: 'center',
              }}
            />
          ) : (
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</span>
          )}
        </div>
      </div>

      {/* Zoom controls */}
      <div style={{
        position: 'absolute',
        bottom: 40,
        right: 12,
        display: 'flex',
        gap: 2,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: 2,
      }}>
        <button onClick={handleZoomOut} title="Zoom out" style={zoomBtnStyle}>
          <ZoomOut size={14} />
        </button>
        <button
          onClick={handleZoomReset}
          title="Reset zoom"
          style={{ ...zoomBtnStyle, fontSize: 10, minWidth: 40 }}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button onClick={handleZoomIn} title="Zoom in" style={zoomBtnStyle}>
          <ZoomIn size={14} />
        </button>
      </div>

      {/* SVG toggle button */}
      {isSvg && (
        <button
          onClick={handleToggleSource}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            padding: '4px 10px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            fontSize: 11,
            color: 'var(--text-muted)',
            cursor: 'pointer',
          }}
        >
          View Source
        </button>
      )}

      {/* Status bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '6px 12px',
        background: 'var(--bg-secondary)',
        borderTop: '1px solid var(--border)',
        fontSize: 11,
        color: 'var(--text-muted)',
        flexShrink: 0,
      }}>
        <span>{dimensions ? `${dimensions.w} × ${dimensions.h}` : '–'}</span>
        <span>{imageType}</span>
      </div>
    </div>
  );
}
