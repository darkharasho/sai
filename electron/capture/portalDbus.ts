// D-Bus + GStreamer implementation behind portalCapture.ts (Wayland only).
// dbus-next is imported lazily so non-Linux platforms never load it.
import { spawn, execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { nativeImage } from 'electron';
import { capturePortal, type PortalCaptureResult, type PortalStream } from './portalCapture';

const PORTAL_NAME = 'org.freedesktop.portal.Desktop';
const PORTAL_PATH = '/org/freedesktop/portal/desktop';
const REQUEST_XML = `<node>
  <interface name="org.freedesktop.portal.Request">
    <signal name="Response"><arg type="u" name="response"/><arg type="a{sv}" name="results"/></signal>
  </interface>
</node>`;
const SESSION_XML = `<node>
  <interface name="org.freedesktop.portal.Session"><method name="Close"/></interface>
</node>`;

// Interactive picks need time for the user to respond to the system dialog.
const RESPONSE_TIMEOUT_MS = 120_000;

type BusHandle = { dbus: typeof import('dbus-next'); bus: import('dbus-next').MessageBus };
let busHandle: BusHandle | null = null;

async function getBus(): Promise<BusHandle> {
  if (busHandle) return busHandle;
  const dbus = await import('dbus-next');
  const bus = dbus.sessionBus();
  // Drop the cached bus on connection errors so the next capture reconnects.
  bus.on('error', () => { busHandle = null; });
  busHandle = { dbus, bus };
  return busHandle;
}

let seq = 0;
function nextToken(): string {
  return `sai_capture_${process.pid}_${++seq}`;
}

function requestPath(busName: string, token: string): string {
  return `/org/freedesktop/portal/desktop/request/${busName.slice(1).replace(/\./g, '_')}/${token}`;
}

// Portal methods reply asynchronously via a Response signal on a Request
// object whose path is derivable from our bus name + handle_token. Subscribe
// (with static XML, the object may not exist yet) BEFORE calling the method.
async function expectResponse(handle: BusHandle, token: string): Promise<Record<string, { value: unknown }>> {
  const obj = await handle.bus.getProxyObject(PORTAL_NAME, requestPath(handle.bus.name, token), REQUEST_XML);
  const iface = obj.getInterface('org.freedesktop.portal.Request');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      iface.removeAllListeners('Response');
      reject(new Error('timed out waiting for the system capture picker'));
    }, RESPONSE_TIMEOUT_MS);
    iface.once('Response', (code: number | bigint, results: Record<string, { value: unknown }>) => {
      clearTimeout(timer);
      if (Number(code) === 0) resolve(results);
      else reject(new Error(code === 1 || code === 1n ? 'the picker was cancelled' : `portal error (response=${code})`));
    });
  });
}

async function openStreamViaPortal(restoreToken: string | null): Promise<PortalStream> {
  const handle = await getBus();
  const { Variant } = handle.dbus;
  const desktop = await handle.bus.getProxyObject(PORTAL_NAME, PORTAL_PATH);
  const sc = desktop.getInterface('org.freedesktop.portal.ScreenCast');

  let tok = nextToken();
  let waiter = expectResponse(handle, tok);
  await sc.CreateSession({
    handle_token: new Variant('s', tok),
    session_handle_token: new Variant('s', nextToken()),
  });
  const sessionHandle = String((await waiter).session_handle.value);

  tok = nextToken();
  waiter = expectResponse(handle, tok);
  const options: Record<string, InstanceType<typeof Variant>> = {
    handle_token: new Variant('s', tok),
    types: new Variant('u', 1 | 2), // MONITOR | WINDOW
    multiple: new Variant('b', false),
    cursor_mode: new Variant('u', 1), // hidden
    persist_mode: new Variant('u', 2), // persist until explicitly revoked
  };
  if (restoreToken) options.restore_token = new Variant('s', restoreToken);
  await sc.SelectSources(sessionHandle, options);
  await waiter;

  tok = nextToken();
  waiter = expectResponse(handle, tok);
  await sc.Start(sessionHandle, '', { handle_token: new Variant('s', tok) });
  const results = await waiter;
  const streams = results.streams.value as Array<[number, unknown]>;
  if (!streams?.length) throw new Error('portal returned no streams');

  return {
    nodeId: Number(streams[0][0]),
    restoreToken: results.restore_token ? String(results.restore_token.value) : null,
    close: async () => {
      const sess = await handle.bus.getProxyObject(PORTAL_NAME, sessionHandle, SESSION_XML);
      await sess.getInterface('org.freedesktop.portal.Session').Close();
    },
  };
}

// PATH order can shadow the distro GStreamer with one lacking pipewiresrc
// (e.g. linuxbrew), so probe candidates and remember the first that has it.
let gstBin: string | null | undefined;
function findGst(): string | null {
  if (gstBin !== undefined) return gstBin;
  gstBin = null;
  for (const candidate of ['/usr/bin/gst-launch-1.0', 'gst-launch-1.0']) {
    try {
      if (candidate.includes('/') && !fs.existsSync(candidate)) continue;
      const inspect = candidate.includes('/') ? join(dirname(candidate), 'gst-inspect-1.0') : 'gst-inspect-1.0';
      execFileSync(inspect, ['pipewiresrc'], { stdio: 'ignore' });
      gstBin = candidate;
      break;
    } catch {
      // try the next candidate
    }
  }
  return gstBin;
}

async function grabFrameViaGst(nodeId: number): Promise<{ base64: string; rgba: Buffer }> {
  const bin = findGst();
  if (!bin) throw new Error('gst-launch-1.0 with pipewiresrc not found');
  const out = join(tmpdir(), `sai-capture-portal-${process.pid}.png`);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(bin, [
        'pipewiresrc', `path=${nodeId}`, 'num-buffers=1',
        '!', 'videoconvert', '!', 'pngenc', '!', 'filesink', `location=${out}`,
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr?.on('data', (d) => { stderr += String(d); });
      const timer = setTimeout(() => { child.kill(); reject(new Error('gstreamer frame grab timed out')); }, 15_000);
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (code) => {
        clearTimeout(timer);
        code === 0 ? resolve() : reject(new Error(`gst-launch exited ${code}: ${stderr.trim()}`));
      });
    });
    const png = await fs.promises.readFile(out);
    return { base64: png.toString('base64'), rgba: nativeImage.createFromBuffer(png).toBitmap() };
  } finally {
    await fs.promises.rm(out, { force: true }).catch(() => {});
  }
}

async function portalAvailable(): Promise<boolean> {
  if (!findGst()) return false;
  try {
    const handle = await getBus();
    const desktop = await handle.bus.getProxyObject(PORTAL_NAME, PORTAL_PATH);
    desktop.getInterface('org.freedesktop.portal.ScreenCast');
    return true;
  } catch {
    return false;
  }
}

function readTokenFile(file: string): string | null {
  try {
    const token = JSON.parse(fs.readFileSync(file, 'utf-8')).restoreToken;
    return typeof token === 'string' && token ? token : null;
  } catch {
    return null;
  }
}

function writeTokenFile(file: string, token: string | null): void {
  try {
    if (token) fs.writeFileSync(file, JSON.stringify({ restoreToken: token }));
    else fs.rmSync(file, { force: true });
  } catch (err) {
    console.warn('capture: could not persist portal restore token', err);
  }
}

export function capturePortalViaDbus(tokenFile: string): Promise<PortalCaptureResult> {
  return capturePortal({
    available: portalAvailable,
    openStream: openStreamViaPortal,
    grabFrame: grabFrameViaGst,
    readToken: () => readTokenFile(tokenFile),
    writeToken: (t) => writeTokenFile(tokenFile, t),
  });
}
