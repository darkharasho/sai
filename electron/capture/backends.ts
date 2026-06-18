// electron/capture/backends.ts
import { desktopCapturer, nativeImage, screen } from 'electron';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spectacleArgs, grimArgs, screencaptureArgs } from './cliArgs';

export async function listDesktopWindows(): Promise<Array<{ id: string; title: string }>> {
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1, height: 1 } });
  return sources.map((s) => ({ id: s.id, title: s.name }));
}

export async function captureDesktopSource(
  id: string,
): Promise<{ base64: string; rgba: Buffer; empty: boolean }> {
  const { width, height } = screen.getPrimaryDisplay().size;
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: width * 2, height: height * 2 },
  });
  const match = sources.find((s) => s.id === id);
  if (!match) return { base64: '', rgba: Buffer.alloc(0), empty: true };
  const img = match.thumbnail;
  const rgba = img.toBitmap(); // BGRA/RGBA byte order per platform; treated channel-agnostically by blank detector
  const base64 = img.toPNG().toString('base64');
  return { base64, rgba, empty: img.isEmpty() };
}

async function spawnToFile(bin: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (d) => { stderr += String(d); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${bin} exited ${code}: ${stderr.trim()}`))));
  });
}

export async function captureViaCli(
  backend: 'spectacle' | 'grim' | 'screencapture',
): Promise<{ base64: string; rgba: Buffer }> {
  const out = join(tmpdir(), `sai-capture-${backend}-${process.pid}.png`);
  const argv = backend === 'spectacle' ? spectacleArgs(out)
    : backend === 'grim' ? grimArgs(out)
    : screencaptureArgs(out);
  try {
    await spawnToFile(backend, argv);
    const png = await fs.readFile(out);
    const img = nativeImage.createFromBuffer(png);
    return { base64: png.toString('base64'), rgba: img.toBitmap() };
  } finally {
    await fs.rm(out, { force: true }).catch((err) => { console.warn('capture: temp file cleanup failed', err); });
  }
}
