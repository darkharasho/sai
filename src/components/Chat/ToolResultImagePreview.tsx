import { useEffect, useState } from 'react';
import './ToolResultImagePreview.css';
import type { ToolResultImage } from '../../types';

export function ToolResultImagePreview({ image }: { image: ToolResultImage }) {
  const [url, setUrl] = useState<string | null>(image.dataUrl ?? null);
  const [failed, setFailed] = useState(false);
  const [lightbox, setLightbox] = useState(false);

  useEffect(() => {
    if (image.dataUrl) { setUrl(image.dataUrl); return; }
    if (!image.filePath || !(window as any).sai?.fsReadFileBase64) { setFailed(true); return; }
    let cancelled = false;
    (window as any).sai.fsReadFileBase64(image.filePath)
      .then((u: string) => { if (!cancelled) setUrl(u); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [image.filePath, image.dataUrl]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightbox]);

  if (failed) return <span className="tool-result-image-missing">image unavailable</span>;
  if (!url) return <span className="tool-result-image-loading">Loading…</span>;

  return (
    <>
      <img
        className="tool-result-image-thumb"
        data-testid="tool-result-image-thumb"
        src={url}
        alt=""
        onClick={(e) => { e.stopPropagation(); setLightbox(true); }}
      />
      {lightbox && (
        <div
          className="tool-result-image-lightbox"
          data-testid="tool-result-image-lightbox"
          onClick={() => setLightbox(false)}
        >
          <img src={url} alt="" />
        </div>
      )}
    </>
  );
}
