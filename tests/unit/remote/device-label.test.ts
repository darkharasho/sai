import { describe, it, expect } from 'vitest';
import { describeDevice } from '@/renderer-remote/deviceLabel';

describe('describeDevice', () => {
  const cid = 'a3f4abcd-1111-2222-3333-444455556666';

  it('formats iPhone Safari', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/605.1.15';
    expect(describeDevice(ua, cid)).toBe('iPhone · Safari · #a3f4');
  });

  it('formats iPad Safari', () => {
    const ua = 'Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/605.1.15';
    expect(describeDevice(ua, cid)).toBe('iPad · Safari · #a3f4');
  });

  it('formats Android Chrome', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36';
    expect(describeDevice(ua, cid)).toBe('Android · Chrome · #a3f4');
  });

  it('formats Mac Safari', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15';
    expect(describeDevice(ua, cid)).toBe('Mac · Safari · #a3f4');
  });

  it('formats Windows Chrome', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
    expect(describeDevice(ua, cid)).toBe('Windows · Chrome · #a3f4');
  });

  it('formats Linux Firefox', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';
    expect(describeDevice(ua, cid)).toBe('Linux · Firefox · #a3f4');
  });

  it('formats Edge as Edge, not Chrome', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0';
    expect(describeDevice(ua, cid)).toBe('Windows · Edge · #a3f4');
  });

  it('falls back to Device for unrecognized UA', () => {
    expect(describeDevice('totally unknown agent', cid)).toBe('Device · #a3f4');
  });

  it('uses first 4 chars of clientId as suffix', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';
    expect(describeDevice(ua, '9c10ffff-0000')).toBe('Linux · Firefox · #9c10');
  });

  it('handles empty clientId by omitting suffix', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';
    expect(describeDevice(ua, '')).toBe('Linux · Firefox');
  });
});
