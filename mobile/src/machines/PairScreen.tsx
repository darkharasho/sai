import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScanLine } from 'lucide-react';
import SaiLogo from '../../../src/components/SaiLogo';
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
  // The last code that failed to pair: the camera still sees it, so scans of it are ignored until a different code appears.
  const lastFailedRef = useRef<string | null>(null);
  const mounted = useRef(true);

  const stopScanning = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const stopCamera = useCallback(() => {
    stopScanning();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    lastFailedRef.current = null;
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
        if (hit.data === lastFailedRef.current) return;
        lastFailedRef.current = null;
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
      lastFailedRef.current = url;
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
    lastFailedRef.current = null;
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

  return (
    <div className="sai-phone-page">
      <div className="sai-phone-page-head">
        <SaiLogo mode="static" size={26} />
        <h1>Pair a desktop</h1>
      </div>
      <p className="sai-phone-page-lede">
        In SAI on your desktop open Settings, Remote, then scan the QR code. Tailscale must be on.
      </p>
      <video ref={videoRef} playsInline muted style={{ width: '100%', borderRadius: 10, background: 'var(--surface-0)', display: scanning ? 'block' : 'none' }} />
      {!scanning && <button type="button" className="sai-phone-secondary" onClick={startCamera} disabled={busy}><ScanLine size={18} aria-hidden="true" />Scan QR code</button>}
      {scanning && <button type="button" className="sai-phone-secondary" onClick={stopCamera}>Stop camera</button>}
      <label className="sai-phone-field">
        Pairing link
        <textarea aria-label="Pairing link" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="http://host:port/?code=..." />
      </label>
      <label className="sai-phone-field">
        This device's name
        <input aria-label="Device name" value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      {error && <div role="alert" className="sai-phone-danger" style={{ fontSize: 'var(--text-md)' }}>{error}</div>}
      <button type="button" className="sai-phone-primary" disabled={busy || !text.trim()} onClick={() => void submit(text)}>
        {busy ? 'Pairing…' : 'Pair'}
      </button>
      {onCancel && <button type="button" className="sai-phone-secondary" onClick={onCancel}>Cancel</button>}
    </div>
  );
}
