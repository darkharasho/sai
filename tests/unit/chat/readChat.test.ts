import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/chatDb', () => ({ dbGetMessages: vi.fn(async () => [{ id: 'idb', role: 'user', content: 'from idb', timestamp: 1 }]) }));
const ensureChatInLog = vi.fn(async () => {});
const isChatImported = vi.fn((_id: string) => false);
const forgetChatImported = vi.fn((_id: string) => {});
vi.mock('../../../src/lib/chat/migrateToLog', () => ({
  ensureChatInLog: (id: string) => ensureChatInLog(id),
  isChatImported: (id: string) => isChatImported(id),
  forgetChatImported: (id: string) => forgetChatImported(id),
}));

import { readChatMessages } from '../../../src/lib/chat/readChat';
import { createMockChatlog } from '../../helpers/chatlogMock';

describe('readChatMessages', () => {
  let chatlog: ReturnType<typeof createMockChatlog>;
  beforeEach(() => { chatlog = createMockChatlog(); (window as any).sai = { chatlog }; ensureChatInLog.mockClear(); isChatImported.mockReset().mockReturnValue(false); forgetChatImported.mockClear(); });
  afterEach(() => { delete (window as any).sai; });

  it('reads persistable messages from the log (snapshot + entries), without an import check', async () => {
    chatlog.seed('c1', [{ id: 'u1', role: 'user', content: 'q', timestamp: 1 }], { projectPath: '/p' });
    chatlog.append('c1', { type: 'streaming_start', turnSeq: 1 });
    chatlog.append('c1', { type: 'reasoning_delta', text: 'hmm' });
    const out = await readChatMessages('c1');
    expect(out.map(m => m.id)).toEqual(['u1', expect.any(String)]);
    expect(out.some(m => m.reasoningLive)).toBe(false);
    expect(ensureChatInLog).not.toHaveBeenCalled();
  });

  it('imports a chat the log does not have yet, then reads it', async () => {
    ensureChatInLog.mockImplementationOnce(async () => { chatlog.seed('c2', [{ id: 'x', role: 'user', content: 'imported', timestamp: 1 }], { projectPath: '/p' }); });
    const out = await readChatMessages('c2');
    expect(ensureChatInLog).toHaveBeenCalledWith('c2');
    expect(out.map(m => m.content)).toEqual(['imported']);
  });

  it('falls back to the IndexedDB mirror when the chat cannot be placed in the log', async () => {
    expect((await readChatMessages('nowhere')).map(m => m.content)).toEqual(['from idb']);
  });

  it('a chat main reports unimported after this session settled it (lost snapshot) is forgotten and re-folded before reading', async () => {
    chatlog.seed('c3', [{ id: 'tail', role: 'user', content: 'tail', timestamp: 2 }], { projectPath: '/p' });
    chatlog.open.mockImplementationOnce(async () => ({ snapshot: null, entries: [], headSeq: 5, meta: { chatId: 'c3', imported: false } }));
    isChatImported.mockReturnValue(true);
    const out = await readChatMessages('c3');
    // Forgotten first, so the IndexedDB mirror's shrink guard protects the history until the fold lands.
    expect(forgetChatImported).toHaveBeenCalledWith('c3');
    expect(ensureChatInLog).toHaveBeenCalledWith('c3');
    expect(out.map(m => m.id)).toEqual(['tail']);
  });

  it('an unimported chat this session never settled is read as-is (no fold attempt)', async () => {
    chatlog.seed('c4', [{ id: 'p', role: 'user', content: 'phone', timestamp: 1 }], { projectPath: '/p' });
    chatlog.open.mockImplementationOnce(async () => ({ snapshot: null, entries: [], headSeq: 0, meta: { chatId: 'c4', imported: false } }));
    await readChatMessages('c4');
    expect(forgetChatImported).not.toHaveBeenCalled();
    expect(ensureChatInLog).not.toHaveBeenCalled();
  });
});
