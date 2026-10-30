import type { ChatMessage, ChatSession, ToolResultImage } from '../types';

/** Writes a data URL to disk (main process) and returns the file path. */
export type StoreImageFn = (dataUrl: string) => Promise<string>;

const defaultStore: StoreImageFn | undefined =
  typeof window !== 'undefined' ? (window as any).sai?.storeToolResultImage : undefined;

// Inline `dataUrl` tool-result images (from builds before the main process
// wrote them to disk) are tens of MB per chat; persisted inline they made the
// chat's IndexedDB record too big to clone ("Data cannot be cloned, out of
// memory"). Swap each for a `filePath` ref. Cached per image object so a
// session re-saved every 30s converts each image once.
const converted = new WeakMap<ToolResultImage, ToolResultImage>();

async function externalizeImage(img: ToolResultImage, store: StoreImageFn): Promise<ToolResultImage> {
  if (!img.dataUrl) return img;
  const hit = converted.get(img);
  if (hit) return hit;
  try {
    const filePath = await store(img.dataUrl);
    const next: ToolResultImage = { filePath, ...(img.mimeType ? { mimeType: img.mimeType } : {}) };
    converted.set(img, next);
    return next;
  } catch (err) {
    console.warn('[externalizeImages] keeping inline image, store failed:', err);
    return img;
  }
}

/** Returns the same array reference when no message carried an inline image. */
export async function externalizeMessageImages(
  messages: ChatMessage[],
  store: StoreImageFn | undefined = defaultStore,
): Promise<ChatMessage[]> {
  if (!store) return messages;
  let changed = false;
  const out: ChatMessage[] = [];
  for (const msg of messages) {
    if (!msg.toolCalls?.some(tc => tc.resultImages?.some(i => i.dataUrl))) { out.push(msg); continue; }
    const toolCalls = [];
    for (const tc of msg.toolCalls) {
      if (!tc.resultImages?.some(i => i.dataUrl)) { toolCalls.push(tc); continue; }
      const resultImages = [];
      for (const img of tc.resultImages) resultImages.push(await externalizeImage(img, store));
      toolCalls.push({ ...tc, resultImages });
    }
    out.push({ ...msg, toolCalls });
    changed = true;
  }
  return changed ? out : messages;
}

export async function externalizeSessionImages(
  session: ChatSession,
  store: StoreImageFn | undefined = defaultStore,
): Promise<ChatSession> {
  const messages = await externalizeMessageImages(session.messages, store);
  return messages === session.messages ? session : { ...session, messages };
}
