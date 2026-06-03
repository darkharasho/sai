export interface ImageRef { id: string; ext: string; mimeType: string }
export type WireMsg = { type: string; [k: string]: unknown };
export type WireState = 'opening' | 'open' | 'closed';
