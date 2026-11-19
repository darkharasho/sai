import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';

const jsqr = vi.fn();
vi.mock('jsqr', () => ({ default: (...a: unknown[]) => jsqr(...a) }));

import { PairScreen } from '../../../mobile/src/machines/PairScreen';
import { PairError } from '../../../mobile/src/machines/pairing';
import { addMachine, listMachines } from '../../../mobile/src/machines/store';

const URL1 = 'http://desk:7421/?code=abc';
let stops: ReturnType<typeof vi.fn>[];
let getUserMedia: ReturnType<typeof vi.fn>;

function makeStream() {
  const stop = vi.fn();
  stops.push(stop);
  return { getTracks: () => [{ stop }] };
}

beforeEach(() => {
  localStorage.clear();
  stops = [];
  jsqr.mockReset();
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  getUserMedia = vi.fn(async () => makeStream());
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { value: 10, configurable: true });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { value: 10, configurable: true });
  HTMLCanvasElement.prototype.getContext = (() => ({
    drawImage() {},
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 10, height: 10 }),
  })) as never;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const tickScan = async () => { await act(async () => { vi.advanceTimersByTime(100); }); await flush(); };

async function startScan(pairFn: any) {
  render(<PairScreen onPaired={() => {}} pairFn={pairFn} />);
  fireEvent.click(screen.getByText('Scan QR code'));
  await flush();
}

describe('PairScreen', () => {
  it('scan uses the live device label, not the one from when the camera started', async () => {
    const pairFn = vi.fn(async () => ({ id: 'm' } as any));
    await startScan(pairFn);
    fireEvent.change(screen.getByLabelText('Device name'), { target: { value: 'My Phone' } });
    jsqr.mockReturnValue({ data: URL1 });
    await tickScan();
    expect(pairFn).toHaveBeenCalledWith(URL1, 'My Phone');
  });

  it('keeps scanning after a failed pair so a fresh code works', async () => {
    const pairFn = vi.fn()
      .mockRejectedValueOnce(new PairError('code expired', 'expired'))
      .mockResolvedValueOnce({ id: 'm' });
    await startScan(pairFn);
    jsqr.mockReturnValue({ data: URL1 });
    await tickScan();
    expect(screen.getByRole('alert').textContent).toBe('code expired');
    expect(stops[0]).not.toHaveBeenCalled();
    await tickScan();
    expect(pairFn).toHaveBeenCalledTimes(2);
  });

  it('double tap opens one stream', async () => {
    render(<PairScreen onPaired={() => {}} pairFn={vi.fn()} />);
    const btn = screen.getByText('Scan QR code');
    fireEvent.click(btn);
    fireEvent.click(btn);
    await flush();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('stops the camera on unmount', async () => {
    const { unmount } = render(<PairScreen onPaired={() => {}} pairFn={vi.fn()} />);
    fireEvent.click(screen.getByText('Scan QR code'));
    await flush();
    unmount();
    expect(stops[0]).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('unmount during play() leaves no stream or interval', async () => {
    let release!: () => void;
    HTMLMediaElement.prototype.play = () => new Promise<void>((r) => { release = r; });
    const { unmount } = render(<PairScreen onPaired={() => {}} pairFn={vi.fn()} />);
    fireEvent.click(screen.getByText('Scan QR code'));
    await flush();
    unmount();
    release();
    await flush();
    expect(stops[0]).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('re-pair keeps the user label and addedAt', () => {
  it('addMachine on an existing baseUrl', async () => {
    const native = { keychainSet: async () => {} } as any;
    const a = await addMachine({ label: 'host', baseUrl: 'http://a:1', deviceId: 'd1', token: 't' }, native);
    const list = JSON.parse(localStorage.getItem('sai.machines.v1')!);
    list[0].label = 'Work PC'; list[0].addedAt = 123;
    localStorage.setItem('sai.machines.v1', JSON.stringify(list));
    const b = await addMachine({ label: 'host', baseUrl: 'http://a:1', deviceId: 'd2', token: 't2' }, native);
    expect(b).toMatchObject({ id: a.id, label: 'Work PC', addedAt: 123, deviceId: 'd2' });
    expect(listMachines()).toHaveLength(1);
  });
});
