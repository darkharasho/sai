import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The SAI iOS app: the phone web build (mobile/vite.config.ts → dist/mobile)
 * inside a Capacitor shell (mobile/ios). Build with `npm run build:ios`, then
 * Xcode or CI on macOS. See mobile/README.md.
 */
const config: CapacitorConfig = {
  appId: 'com.project96.sai',
  appName: 'SAI',
  webDir: 'dist/mobile',
  // The default theme's --surface-0 (src/styles/globals.css).
  backgroundColor: '#090c0e',
  ios: {
    path: 'mobile/ios',
    // The page lays itself out under the status bar and home indicator (viewport-fit=cover).
    contentInset: 'never',
    scheme: 'capacitor',
  },
  plugins: {
    Keyboard: { resize: 'native', resizeOnFullScreen: true },
  },
};

export default config;
