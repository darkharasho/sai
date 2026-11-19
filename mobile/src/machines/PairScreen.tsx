import React, { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { pair as defaultPair, parsePairUrl, PairError } from './pairing';
import type { Machine } from './store';

export interface PairScreenProps {
  onPaired(machine: Machine): void;
  onCancel?(): void;
  /** Injectable for tests. */
  pairFn?: (url: string, deviceLabel: string) => Promise<Machine>;
}

const SCAN_INTERVAL_MS = 100; // 10fps

/** Camera QR scan (jsQR on a canvas) with a paste fallback. The camera stops on unmount and on the first valid code. */
export function PairScreen({ onPaired, onCancel, pairFn = defaultPair }: PairScreenProps) {
  const [label, setLabel] = useState('iPhone');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const busyRef = useRef(false);
  const startingRef = useRef(false);
  const mounted = useRef(true);

  const stopScanning = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const stopCamera = useCallback(() => {
    stopScanning();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (mounted.current) setScanning(false);
  }, [stopScanning]);

  // Always calls the latest submit (live label/pairFn), never a closure captured when the camera started.
  const submitRef = useRef<(url: string) => Promise<void>>(async () => {});

  const startScanning = useCallback(() => {
    stopScanning();
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    timerRef.current = setInterval(() => {
      if (!video || !ctx || video.videoWidth === 0 || busyRef.current) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const hit = jsQR(img.data, img.width, img.height);
      if (hit && parsePairUrl(hit.data)) {
        stopScanning();
        void submitRef.current(hit.data);
      }
    }, SCAN_INTERVAL_MS);
  }, [stopScanning]);

  const submit = useCallback(async (url: string) => {
    if (busyRef.current) return;
    if (!parsePairUrl(url)) { setError('not a SAI pairing code'); return; }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const m = await pairFn(url, label.trim() || 'iPhone');
      stopCamera();
      if (mounted.current) onPaired(m);
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof PairError ? e.message : "can't reach desktop — is Tailscale on?");
        // Camera still on: keep looking so the user can point at a fresh code.
        if (streamRef.current) startScanning();
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [label, onPaired, pairFn, stopCamera, startScanning]);
  submitRef.current = submit;

  const startCamera = useCallback(async () => {
    if (startingRef.current || streamRef.current) return;
    startingRef.current = true;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (!mounted.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) { video.srcObject = stream; await video.play().catch(() => {}); }
      if (!mounted.current) { stopCamera(); return; }
      setScanning(true);
      startScanning();
    } catch {
      if (mounted.current) setError('camera unavailable, paste the pairing link instead');
    } finally {
      startingRef.current = false;
    }
  }, [startScanning, stopCamera]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stopCamera(); };
  }, [stopCamera]);

  const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--surface-4)', borderRadius: 8, padding: 10, fontSize: 16 };

  return (
    <div style={{ background: 'var(--surface-1)', color: 'var(--text)', minHeight: '100%', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h1 style={{ fontSize: 'var(--text-xl)', margin: 0 }}>Pair a desktop</h1>
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-md)' }}>
        In SAI on your desktop open Settings, Remote, then scan the QR code. Tailscale must be on.
      </p>
      <video ref={videoRef} playsInline muted style={{ width: '100%', borderRadius: 10, background: 'var(--surface-0)', display: scanning ? 'block' : 'none' }} />
      {!scanning && <button type="button" onClick={startCamera} disabled={busy}>Scan QR code</button>}
      {scanning && <button type="button" onClick={stopCamera}>Stop camera</button>}
      <label style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
        Pairing link
        <textarea aria-label="Pairing link" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="http://host:port/?code=..." style={field} />
      </label>
      <label style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
        This device's name
        <input aria-label="Device name" value={label} onChange={(e) => setLabel(e.target.value)} style={field} />
      </label>
      {error && <div role="alert" style={{ color: '#e5534b', fontSize: 'var(--text-md)' }}>{error}</div>}
      <button
        type="button"
        disabled={busy || !text.trim()}
        onClick={() => void submit(text)}
        style={{ padding: 14, border: 0, borderRadius: 10, background: 'var(--accent)', color: 'var(--surface-0)', fontSize: 'var(--text-lg)' }}
      >
        {busy ? 'Pairing…' : 'Pair'}
      </button>
      {onCancel && <button type="button" onClick={onCancel}>Cancel</button>}
    </div>
  );
}
