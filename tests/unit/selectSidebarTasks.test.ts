import { describe, it, expect } from 'vitest';
import { selectSidebarTasks } from '@/components/Chat/selectSidebarTasks';
import type { BackgroundTaskDetail } from '../../electron/services/claudeBackend/backgroundTasks';

const t = (id: string) => ({ id } as BackgroundTaskDetail);

describe('selectSidebarTasks', () => {
  const byScope = new Map([
    ['/p:chat-1', [t('a'), t('b')]],
    ['/p:chat-2', [t('c')]],
  ]);
  it("returns the active scope's list", () => {
    expect(selectSidebarTasks(byScope, '/p:chat-1').map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('another chat with no tasks gets []', () => {
    expect(selectSidebarTasks(byScope, '/p:chat-3')).toEqual([]);
  });
  it('null key gets []', () => {
    expect(selectSidebarTasks(byScope, null)).toEqual([]);
  });
  it('returns a stable empty array', () => {
    expect(selectSidebarTasks(byScope, null)).toBe(selectSidebarTasks(byScope, '/x:y'));
  });
});
