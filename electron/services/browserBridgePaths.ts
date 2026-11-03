/**
 * Paths shared by the SAI main process and the native-messaging relay host.
 *
 * The relay is spawned by Chrome, not by SAI, so it cannot be told where to
 * look — the locations have to be derivable from $HOME alone. That rules out
 * the PID-suffixed socket that swarmMcpHost uses, so the bridge gets a stable
 * path plus a rotating token file for auth.
 *
 * Must not import electron: the relay runs as a bare Node process.
 */
import * as os from 'node:os';
import * as path from 'node:path';

export const BRIDGE_DIR_NAME = 'browser-bridge';

export function bridgeDir(home: string = os.homedir()): string {
  return path.join(home, '.sai', BRIDGE_DIR_NAME);
}

/**
 * Windows named pipes don't live on disk, so they can't be derived from a
 * directory the way a unix socket can. Both sides compute the same constant.
 */
export function bridgeSocketPath(
  home: string = os.homedir(),
  platform: string = process.platform,
): string {
  if (platform === 'win32') return '\\\\.\\pipe\\sai-browser-bridge';
  return path.join(bridgeDir(home), 'bridge.sock');
}

export function bridgeTokenPath(home: string = os.homedir()): string {
  return path.join(bridgeDir(home), 'token');
}
