export type BackendName = 'desktopCapturer' | 'spectacle' | 'grim' | 'screencapture';

export interface CaptureEnv {
  platform: NodeJS.Platform;
  sessionType?: string;
  desktop?: string;
  has: (bin: string) => boolean;
}

export function selectBackendChain(env: CaptureEnv): BackendName[] {
  const chain: BackendName[] = ['desktopCapturer'];
  if (env.platform === 'darwin') {
    if (env.has('screencapture')) chain.push('screencapture');
    return chain;
  }
  if (env.platform === 'linux' && (env.sessionType ?? '').toLowerCase() === 'wayland') {
    const isKde = (env.desktop ?? '').toLowerCase().includes('kde');
    if (isKde && env.has('spectacle')) chain.push('spectacle');
    else if (!isKde && env.has('grim')) chain.push('grim');
  }
  return chain;
}
