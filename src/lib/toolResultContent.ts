import type { ToolResultImage } from '../types';

/**
 * Split a tool_result `content` (string OR array of content blocks) into joined
 * text and image references. Image blocks use Anthropic-style `source`:
 *   - { type: 'sai-file', path, media_type }  → { filePath, mimeType }
 *   - { type: 'base64', media_type, data }    → { dataUrl, mimeType }
 */
export function parseToolResultBlocks(content: unknown): { text: string; images?: ToolResultImage[] } {
  if (typeof content === 'string') return { text: content, images: undefined };
  if (!Array.isArray(content)) return { text: '', images: undefined };

  let text = '';
  const images: ToolResultImage[] = [];
  for (const block of content as any[]) {
    if (block?.type === 'text') {
      text += block.text ?? '';
    } else if (block?.type === 'image' && block.source) {
      const src = block.source;
      if (src.type === 'sai-file' && src.path) {
        images.push({ filePath: src.path, mimeType: src.media_type });
      } else if (src.type === 'base64' && src.data) {
        images.push({ dataUrl: `data:${src.media_type};base64,${src.data}`, mimeType: src.media_type });
      }
    }
  }
  return { text, images: images.length ? images : undefined };
}
