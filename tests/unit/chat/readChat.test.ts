import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/chatDb', () => ({ dbGetMessages: vi.fn(async () => [{ id: 'idb', role: 'user', content: 'from idb', timestamp: 1 }]) }));
const ensureChatInLog = vi.fn(async () => {});
vi.mock('../../../src/lib/chat/migrateToLog', () => ({ ensureChatInLog: (id: string) => ensureChatInLog(id) }));

import { readChatMessages } from '../../../src/lib/chat/readChat';
import { createMockChatlog } from '../../helpers/chatlogMock';

describe('readChatMessages', () => {
  let chatlog: ReturnType<typeof createMockChatlog>;
  beforeEach(() => { chatlog = createMockChatlog(); (window as any).sai = { chatlog }; ensureChatInLog.mockClear(); });
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
});
