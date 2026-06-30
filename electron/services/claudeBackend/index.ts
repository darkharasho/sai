import { readSaiSetting } from '../claude';
import { CliBackend } from './cliBackend';
import { SdkBackend } from './sdkBackend';
import type { ClaudeBackend } from './types';
export * from './types';

export function getClaudeBackendSetting(): 'cli' | 'sdk' {
  return readSaiSetting('claudeBackend') === 'sdk' ? 'sdk' : 'cli';
}

let active: ClaudeBackend | null = null;

export function getClaudeBackend(): ClaudeBackend {
  if (active) return active;
  const which = getClaudeBackendSetting();
  if (which === 'sdk') {
    active = new SdkBackend();
  } else {
    active = new CliBackend();
  }
  return active;
}

/** Test-only seam to inject a stub or reset the cached backend. */
export function __setClaudeBackendForTests(b: ClaudeBackend | null): void { active = b; }
