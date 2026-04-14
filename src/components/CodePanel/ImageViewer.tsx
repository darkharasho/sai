import { useState, useEffect, useCallback } from 'react';
import { isSvgFile, getImageType } from '../../utils/imageFiles';
import MonacoEditor from '../FileExplorer/MonacoEditor';

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

  const isSvg = isSvgFile(filePath);
  const imageType = getImageType(filePath);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setDimensions(null);
    setSvgSourceMode(false);
    setSvgContent(null);
    setCacheKey(0);

    window.sai.fsReadFileBase64(filePath).then((url: string) => {
      if (!cancelled) setDataUrl(url);
    });

    return () => { cancelled = true; };
  }, [filePath]);

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setDimensions({ w: img.naturalWidth, h: img.naturalHeight });
  }, []);

  const handleToggleSource = useCallback(async () => {
    if (!svgSourceMode && svgContent === null) {
      const content = await window.sai.fsReadFile(filePath) as string;
      setSvgContent(content);
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
      {/* Checkerboard background + centered image */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundImage: `
          linear-gradient(45deg, #1e1e1e 25%, transparent 25%),
          linear-gradient(-45deg, #1e1e1e 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, #1e1e1e 75%),
          linear-gradient(-45deg, transparent 75%, #1e1e1e 75%)
        `,
        backgroundSize: '20px 20px',
        backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
        backgroundColor: '#181818',
        padding: 24,
      }}>
        {dataUrl ? (
          <img
            src={dataUrl + (cacheKey > 0 ? `#${cacheKey}` : '')}
            alt={filePath.split('/').pop() ?? ''}
            onLoad={handleImageLoad}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
            }}
          />
        ) : (
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</span>
        )}
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
