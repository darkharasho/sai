// Single source of truth lives in the desktop tree; the PWA build (vite root
// src/renderer-remote) resolves imports outside its root fine. Re-export so
// the two copies can't drift again (they did — audit 2026-06-10).
export { default } from '../../components/SaiLogo';
export type { SaiLogoMode } from '../../components/SaiLogo';
