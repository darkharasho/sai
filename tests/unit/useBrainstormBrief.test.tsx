import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useBrainstormBrief, EMPTY_BRIEF } from '../../src/components/NewProjectTakeover/useBrainstormBrief';

type Cb = (payload: any) => void;
const listeners: Record<string, Cb> = {};

beforeEach(() => {
  for (const k of Object.keys(listeners)) delete listeners[k];
  (window as any).sai = {
    brainstormStart: vi.fn().mockResolvedValue({ sessionId: 'sid-1' }),
    brainstormSend: vi.fn().mockResolvedValue({ ok: true }),
    brainstormEditBrief: vi.fn().mockResolvedValue({ ok: true, brief: { ...EMPTY_BRIEF, projectName: 'edited' } }),
    brainstormEnd: vi.fn().mockResolvedValue({ ok: true }),
    brainstormOnChunk: vi.fn((sid: string, cb: Cb) => { listeners[`chunk:${sid}`] = cb; return () => {}; }),
    brainstormOnDone: vi.fn((sid: string, cb: Cb) => { listeners[`done:${sid}`] = cb; return () => {}; }),
    brainstormOnError: vi.fn((sid: string, cb: Cb) => { listeners[`error:${sid}`] = cb; return () => {}; }),
    brainstormOnBrief: vi.fn((sid: string, cb: Cb) => { listeners[`brief:${sid}`] = cb; return () => {}; }),
  };
});

describe('useBrainstormBrief', () => {
  it('sends a message, streams, and finalizes the assistant reply', async () => {
    const { result } = renderHook(() => useBrainstormBrief());
    await act(() => result.current.send('hello'));
    expect(result.current.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(result.current.isStreaming).toBe(true);
    act(() => listeners['chunk:sid-1']('Hi '));
    expect(result.current.streamingText).toBe('Hi ');
    act(() => listeners['done:sid-1']('Hi there'));
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.messages[1]).toEqual({ role: 'assistant', content: 'Hi there' });
  });

  it('tracks live brief updates and questionCount stops at ready', async () => {
    const { result } = renderHook(() => useBrainstormBrief());
    await act(() => result.current.send('q1'));
    act(() => listeners['done:sid-1']('first reply?'));
    expect(result.current.questionCount).toBe(1);
    act(() => listeners['brief:sid-1']({ ...EMPTY_BRIEF, projectName: 'x', summary: 's', ready: true }));
    expect(result.current.brief.ready).toBe(true);
    await act(() => result.current.send('q2'));
    act(() => listeners['done:sid-1']('refined.'));
    expect(result.current.questionCount).toBe(1); // ready → no longer counted
  });

  it('editBrief applies the returned brief and reports validation errors', async () => {
    const { result } = renderHook(() => useBrainstormBrief());
    await act(() => result.current.send('x'));
    await act(async () => {
      const r = await result.current.editBrief({ projectName: 'edited' });
      expect(r.ok).toBe(true);
    });
    expect(result.current.brief.projectName).toBe('edited');
    (window as any).sai.brainstormEditBrief.mockResolvedValueOnce({ ok: false, error: 'projectName must be kebab-case' });
    await act(async () => {
      const r = await result.current.editBrief({ projectName: 'Bad' });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/kebab/);
    });
  });

  it('surfaces stream errors and clears streaming state', async () => {
    const { result } = renderHook(() => useBrainstormBrief());
    await act(() => result.current.send('x'));
    act(() => listeners['error:sid-1']('auth failed'));
    expect(result.current.error).toBe('auth failed');
    expect(result.current.isStreaming).toBe(false);
  });

  it('transcriptDirty flips once content exists; ends the session on unmount', async () => {
    const { result, unmount } = renderHook(() => useBrainstormBrief());
    expect(result.current.transcriptDirty).toBe(false);
    await act(() => result.current.send('x'));
    expect(result.current.transcriptDirty).toBe(true);
    unmount();
    await waitFor(() => expect((window as any).sai.brainstormEnd).toHaveBeenCalledWith('sid-1'));
  });
});
