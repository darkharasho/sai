// Orchestration for Wayland capture via the xdg-desktop-portal ScreenCast API.
// The portal shows a system picker once; persist_mode=2 plus a stored
// restore_token makes every subsequent capture silent. Tokens are single-use:
// each successful Start() mints a fresh one, which must replace the stored one.
export interface PortalStream {
  nodeId: number;
  restoreToken: string | null;
  close: () => Promise<void>;
}

export interface PortalCaptureDeps {
  // False when the session bus, the portal ScreenCast service, or the
  // GStreamer frame grabber is missing — callers then fall back to other backends.
  available: () => boolean | Promise<boolean>;
  // CreateSession → SelectSources(persist_mode=2, restore_token?) → Start.
  // Shows the system picker when the token is absent or stale; throws on
  // cancel or timeout.
  openStream: (restoreToken: string | null) => Promise<PortalStream>;
  grabFrame: (nodeId: number) => Promise<{ base64: string; rgba: Buffer }>;
  readToken: () => string | null;
  writeToken: (token: string | null) => void;
}

export type PortalCaptureResult =
  | { ok: true; base64: string; rgba: Buffer }
  | { ok: false; reason: 'unavailable' | 'declined' | 'error'; message: string };

export async function capturePortal(deps: PortalCaptureDeps): Promise<PortalCaptureResult> {
  if (!(await deps.available())) {
    return { ok: false, reason: 'unavailable', message: 'screen-capture portal unavailable' };
  }
  const token = deps.readToken();
  let stream: PortalStream;
  try {
    stream = await deps.openStream(token);
  } catch (e) {
    // A stale token is cleared so the next attempt starts a clean interactive pick.
    if (token) deps.writeToken(null);
    return {
      ok: false,
      reason: 'declined',
      message: `Screen capture was not granted (${(e as Error).message}). When the system picker appears, select the app window — the choice is remembered for future captures.`,
    };
  }
  try {
    deps.writeToken(stream.restoreToken);
    const frame = await deps.grabFrame(stream.nodeId);
    return { ok: true, ...frame };
  } catch (e) {
    return { ok: false, reason: 'error', message: `portal capture failed: ${(e as Error).message}` };
  } finally {
    await stream.close().catch(() => {});
  }
}
