import { readSaiSetting } from '../claude';
export * from './types';

export function getClaudeBackendSetting(): 'cli' | 'sdk' {
  return readSaiSetting('claudeBackend') === 'sdk' ? 'sdk' : 'cli';
}

import { CliBackend } from './cliBackend';
import type { ClaudeBackend } from './types';

let active: ClaudeBackend | null = null;

export function getClaudeBackend(): ClaudeBackend {
  if (active) return active;
  const which = getClaudeBackendSetting();
  if (which === 'sdk') {
    // eslint-disable-next-line no-console
    console.warn('[claude] claudeBackend=sdk requested but SDK backend not implemented; using CLI');
  }
  active = new CliBackend();
  return active;
}

/** Test-only seam to inject a stub or reset the cached backend. */
export function __setClaudeBackendForTests(b: ClaudeBackend | null): void { active = b; }
