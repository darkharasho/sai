export type BackendName = 'desktopCapturer' | 'spectacle' | 'grim' | 'screencapture';

export interface CaptureEnv {
  platform: NodeJS.Platform;
  sessionType?: string;
  desktop?: string;
  has: (bin: string) => boolean;
}

export function selectBackendChain(env: CaptureEnv): BackendName[] {
  if (env.platform === 'darwin') {
    const chain: BackendName[] = ['desktopCapturer'];
    if (env.has('screencapture')) chain.push('screencapture');
    return chain;
  }
  if (env.platform === 'linux' && (env.sessionType ?? '').toLowerCase() === 'wayland') {
    // desktopCapturer's per-window capture is unreliable on Wayland (blank or
    // title-less sources), so the CLI backend leads and it becomes the backstop.
    const isKde = (env.desktop ?? '').toLowerCase().includes('kde');
    if (isKde && env.has('spectacle')) return ['spectacle', 'desktopCapturer'];
    if (!isKde && env.has('grim')) return ['grim', 'desktopCapturer'];
  }
  return ['desktopCapturer'];
}
