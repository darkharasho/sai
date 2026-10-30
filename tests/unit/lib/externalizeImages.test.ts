import { describe, it, expect, vi } from 'vitest';
import { externalizeMessageImages, externalizeSessionImages } from '@/lib/externalizeImages';
import type { ChatMessage, ChatSession } from '@/types';

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({ id: 'm', role: 'assistant', content: '', timestamp: 0, ...over });

describe('externalizeImages', () => {
  it('returns the same array when nothing is inline', async () => {
    const messages = [msg(), msg({ toolCalls: [{ type: 'mcp', name: 'x', input: '', resultImages: [{ filePath: '/a.png' }] }] })];
    const store = vi.fn();
    expect(await externalizeMessageImages(messages, store)).toBe(messages);
    expect(store).not.toHaveBeenCalled();
  });

  it('converts each image object once across repeated saves', async () => {
    const img = { dataUrl: 'data:image/png;base64,AA', mimeType: 'image/png' };
    const session = {
      id: 's', title: '', createdAt: 0, updatedAt: 0,
      messages: [msg({ toolCalls: [{ type: 'mcp', name: 'x', input: '', resultImages: [img] }] })],
    } as ChatSession;
    const store = vi.fn(async () => '/imgs/h.png');
    const a = await externalizeSessionImages(session, store);
    const b = await externalizeSessionImages(session, store);
    expect(store).toHaveBeenCalledTimes(1);
    expect(a.messages[0].toolCalls![0].resultImages).toEqual([{ filePath: '/imgs/h.png', mimeType: 'image/png' }]);
    expect(b.messages[0].toolCalls![0].resultImages).toEqual(a.messages[0].toolCalls![0].resultImages);
    expect(session.messages[0].toolCalls![0].resultImages![0]).toBe(img); // input untouched
  });
});
