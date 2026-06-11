import { useTranscript } from '../lib/transcriptStore';

describe('transcript store', () => {
  beforeEach(() => useTranscript.setState({ byKey: {} }));

  it('appends events keyed by (machine, project, session)', () => {
    useTranscript.getState().append('m1|p1|s1', { type: 'user', text: 'hi', id: '1' });
    useTranscript.getState().append('m1|p1|s1', { type: 'assistant', text: 'hello', id: '2' });
    const events = useTranscript.getState().byKey['m1|p1|s1'] ?? [];
    expect(events).toHaveLength(2);
    expect(events[0].text).toBe('hi');
  });

  it('replaces by id (idempotent updates)', () => {
    useTranscript.getState().append('k', { id: 'x', type: 'user', text: 'a' });
    useTranscript.getState().append('k', { id: 'x', type: 'user', text: 'b' });
    expect(useTranscript.getState().byKey['k']).toHaveLength(1);
    expect(useTranscript.getState().byKey['k'][0].text).toBe('b');
  });

  it('clears', () => {
    useTranscript.getState().append('k', { id: '1', type: 'user', text: 'a' });
    useTranscript.getState().clear('k');
    expect(useTranscript.getState().byKey['k']).toBeUndefined();
  });
});

describe('transcript store replace', () => {
  beforeEach(() => useTranscript.setState({ byKey: {} }));

  it('swaps the full event list for a key, leaving other keys untouched', () => {
    useTranscript.getState().append('k1', { id: 'old', type: 'user', text: 'old' });
    useTranscript.getState().append('k2', { id: 'other', type: 'user', text: 'other' });
    useTranscript.getState().replace('k1', [
      { id: 'h1', type: 'user', text: 'from history' },
      { id: 'h2', type: 'assistant', text: 'reply' },
    ]);
    expect(useTranscript.getState().byKey['k1']!.map((e) => e.id)).toEqual(['h1', 'h2']);
    expect(useTranscript.getState().byKey['k2']!).toHaveLength(1);
  });
});
