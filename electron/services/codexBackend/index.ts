import { app, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { emitChatMessage } from '../claude';
import { CliCodexBackend, fetchCodexModels } from './cliBackend';
import { SdkCodexBackend } from './sdkBackend';
import type { CodexBackend, CodexBackendKind } from './types';

export * from './types';

/**
 * Read the Codex transport escape hatch directly from SAI settings.
 * This intentionally does not share Claude's setting accessor: selecting a
 * Codex transport must not read or mutate SAI's default AI provider.
 */
export function getCodexBackendSetting(): CodexBackendKind {
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
    return settings.codexBackend === 'cli' ? 'cli' : 'sdk';
  } catch {
    return 'sdk';
  }
}

let active: CodexBackend | null = null;
let cliWindow: BrowserWindow | null = null;

/** Configure the window needed by the legacy CLI transport without creating it. */
export function configureCodexBackendWindow(win: BrowserWindow | null): void {
  cliWindow = win;
}

/** Return the selected backend, constructing it only on first use. */
export function getCodexBackend(): CodexBackend {
  if (active) return active;

  if (getCodexBackendSetting() === 'cli') {
    if (!cliWindow) {
      throw new Error('The Codex CLI backend requires a configured BrowserWindow');
    }
    active = new CliCodexBackend(cliWindow);
    return active;
  }

  const sdk = new SdkCodexBackend({
    emit: emitChatMessage,
    getModels: fetchCodexModels,
  });

  // Task 7 replaces the singleton workspace hook with a provider-keyed
  // registry. Registering here today would overwrite Claude's lifecycle hooks,
  // so Codex registration deliberately waits for that safe registry.
  active = sdk;
  return active;
}

/** Destroy and forget the active backend, if one has been selected. */
export function destroyCodexBackendIfActive(): void {
  const backend = active;
  active = null;
  backend?.destroy();
}

/** Test seam that replaces the singleton without leaking its lifecycle. */
export function __setCodexBackendForTests(backend: CodexBackend | null): void {
  if (active === backend) return;
  destroyCodexBackendIfActive();
  active = backend;
}
