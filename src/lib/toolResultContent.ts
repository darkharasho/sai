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

/** Detect and strip the error wrappers understood by tool result cards. */
export function parseToolError(output: string): { isToolError: boolean; message: string } {
  const stripped = output.trim();
  const tagMatch = stripped.match(
    /^<(?:tool_use_error|tool_error|error)>([\s\S]*?)<\/(?:tool_use_error|tool_error|error)>$/,
  );
  if (tagMatch) return { isToolError: true, message: tagMatch[1].trim() };
  if (/tool_use_error/i.test(stripped)) {
    return {
      isToolError: true,
      message: stripped.replace(/tool_use_error[:\s]*/i, '').trim() || stripped,
    };
  }
  return { isToolError: false, message: output };
}
