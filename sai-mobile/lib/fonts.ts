// Centralized font-family tokens. Geist + Geist Mono are loaded at app boot
// via expo-font in app/_layout.tsx; components import FONT.sans / FONT.mono
// to ensure typography matches the PWA pixel-for-pixel.
export const FONT = {
  sans: 'Geist',
  mono: 'GeistMono',
} as const;
