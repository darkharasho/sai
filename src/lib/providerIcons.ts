import type { AIProvider } from '../types';

// Bundled by Vite (like the fonts in src/styles/fonts.ts), so they also exist in
// the phone build, which ships no public/ folder.
const ICONS: Record<AIProvider, string> = {
  claude: new URL('../../public/svg/claude.svg', import.meta.url).href,
  codex: new URL('../../public/svg/codex.svg', import.meta.url).href,
  gemini: new URL('../../public/svg/antigravity.svg', import.meta.url).href,
  kimi: new URL('../../public/svg/kimi.svg', import.meta.url).href,
};

/** The provider's monochrome mark (use as a CSS mask). */
export function providerIconUrl(provider: AIProvider): string {
  return ICONS[provider] ?? ICONS.claude;
}
