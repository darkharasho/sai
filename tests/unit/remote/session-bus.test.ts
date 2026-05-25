import { describe, it, expect } from 'vitest';
import { SessionBus } from '@electron/services/remote/session-bus';

describe('SessionBus', () => {
  it('delivers events to per-topic subscribers', () => {
    const bus = new SessionBus();
    const events: any[] = [];
    bus.subscribe('chat-1', (e) => events.push(e));
    bus.publish('chat-1', { type: 'foo' });
    bus.publish('chat-2', { type: 'bar' });
    expect(events).toEqual([{ type: 'foo' }]);
  });

  it('delivers all events to subscribeAll', () => {
    const bus = new SessionBus();
    const events: any[] = [];
    bus.subscribeAll((topic, e) => events.push({ topic, e }));
    bus.publish('a', { type: 'x' });
    bus.publish('b', { type: 'y' });
    expect(events).toEqual([
      { topic: 'a', e: { type: 'x' } },
      { topic: 'b', e: { type: 'y' } },
    ]);
  });

  it('unsubscribe stops delivery', () => {
    const bus = new SessionBus();
    const events: any[] = [];
    const unsub = bus.subscribe('a', (e) => events.push(e));
    bus.publish('a', { type: '1' });
    unsub();
    bus.publish('a', { type: '2' });
    expect(events).toEqual([{ type: '1' }]);
  });

  it('history returns events since a sequence number', () => {
    const bus = new SessionBus();
    bus.publish('a', { type: '1' });
    bus.publish('a', { type: '2' });
    bus.publish('a', { type: '3' });
    const { events, lastSeq } = bus.history('a', 1);
    expect(events).toEqual([{ type: '2' }, { type: '3' }]);
    expect(lastSeq).toBe(3);
  });

  it('ring buffer caps at 256 events per topic', () => {
    const bus = new SessionBus();
    for (let i = 0; i < 300; i++) bus.publish('a', { type: String(i) });
    const { events } = bus.history('a', 0);
    expect(events).toHaveLength(256);
    expect((events[0] as any).type).toBe('44'); // 300 - 256
  });
});
