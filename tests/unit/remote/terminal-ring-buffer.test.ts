import { describe, it, expect } from 'vitest';
import { RingBuffer } from '@electron/services/remote/ring-buffer';

describe('RingBuffer', () => {
  it('empty snapshot is empty string', () => {
    const rb = new RingBuffer(1024);
    expect(rb.snapshot()).toBe('');
    expect(rb.size).toBe(0);
  });

  it('push under cap keeps full content', () => {
    const rb = new RingBuffer(1024);
    rb.push('hello ');
    rb.push('world');
    expect(rb.snapshot()).toBe('hello world');
    expect(rb.size).toBe(11);
  });

  it('evicts oldest chunks when over cap', () => {
    const rb = new RingBuffer(10);
    rb.push('aaaaa');     // 5
    rb.push('bbbbb');     // 10 (at cap)
    rb.push('ccc');       // 13 → drop "aaaaa" → 8
    expect(rb.snapshot()).toBe('bbbbbccc');
    expect(rb.size).toBe(8);
  });

  it('drops a single oversized chunk down to cap by keeping only its tail', () => {
    const rb = new RingBuffer(5);
    rb.push('abcdefghij'); // 10 bytes; cap=5 → keep last 5
    expect(rb.snapshot()).toBe('fghij');
    expect(rb.size).toBe(5);
  });

  it('clear empties the buffer', () => {
    const rb = new RingBuffer(100);
    rb.push('x');
    rb.clear();
    expect(rb.snapshot()).toBe('');
    expect(rb.size).toBe(0);
  });
});
