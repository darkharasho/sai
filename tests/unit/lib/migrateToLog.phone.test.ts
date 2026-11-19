// The phone has one history source (the desktop's log over v2): the chat
// graph must never open the IndexedDB mirror there. Unmocked chatDb.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ensureChatInLog, isChatImported, _resetMigrateStateForTests } from '../../../src/lib/chat/migrateToLog';

let open: ReturnType<typeof vi.fn>;
let chatlog: { importMessages: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> };

beforeEach(() => {
  _resetMigrateStateForTests();
  open = vi.fn(() => { throw new Error('indexedDB.open called'); });
  vi.stubGlobal('indexedDB', { open, deleteDatabase: vi.fn() });
  chatlog = { importMessages: vi.fn(async () => 'marked'), list: vi.fn(async () => []) };
  (window as any).sai = { chatlog };
});
afterEach(() => {
  delete document.documentElement.dataset.saiPhone;
  delete (window as any).sai;
  vi.unstubAllGlobals();
});

describe('ensureChatInLog', () => {
  it('on the phone never opens IndexedDB and treats the chat as settled', async () => {
    document.documentElement.dataset.saiPhone = '1';
    await ensureChatInLog('c1');
    expect(open).not.toHaveBeenCalled();
    expect(chatlog.importMessages).not.toHaveBeenCalled();
    expect(chatlog.list).not.toHaveBeenCalled();
    expect(isChatImported('c1')).toBe(true);
  });

  it('on the desktop still reads the IndexedDB mirror', async () => {
    await ensureChatInLog('c2').catch(() => {});
    expect(open).toHaveBeenCalled();
  });
});
