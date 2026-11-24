import { useState } from 'react';
import { MermaidRender } from '../Chat/RenderToolCard';
import type { CanvasBlock } from '../../canvas/canvasBlocks';
import { prepareCanvasDiagram } from '../../canvas/canvasMermaid';

export default function CanvasBlockEditor({ block, accent = '', onCommit, onCancel }: {
  block: CanvasBlock;
  /** Theme accent for the diagram preview's `current` class. */
  accent?: string;
  onCommit: (source: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(block.source);
  const diagram = block.kind === 'mermaid' ? draft.replace(/^\s*```mermaid[^\n]*\n/, '').replace(/\n?```\s*$/, '') : '';
  return (
    <div className="canvas-editor">
      <textarea
        className="canvas-editor__text"
        aria-label={`Edit block ${block.index + 1}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={Math.min(24, Math.max(4, draft.split('\n').length + 1))}
        autoFocus
      />
      {block.kind === 'mermaid' && (
        <div className="canvas-editor__preview canvas-diagram"><MermaidRender diagram={prepareCanvasDiagram(diagram, accent)} /></div>
      )}
      <div className="canvas-editor__actions">
        <button type="button" className="canvas-btn canvas-btn--primary" onClick={() => onCommit(draft)}>Save</button>
        <button type="button" className="canvas-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
