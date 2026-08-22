/**
 * slashCommands.ts — the per-project slash-command cache.
 *
 * Three sources feed it, in ascending order of authority:
 *   1. the `system/init` frame's `slash_commands` (bare names, no descriptions)
 *   2. `query.supportedCommands()` (structured — names AND descriptions)
 *   3. `system/commands_changed` (structured; REPLACES the list — the SDK
 *      captures supportedCommands() at initialize and never revises it)
 *
 * Two invariants make the sources composable:
 *   - names are stored BARE (no leading `/`); every consumer adds its own
 *   - a write whose descriptions are empty inherits them from what's already
 *     cached, so a name-only init frame can't wipe out a structured refresh
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { app } from 'electron';

export interface SlashCommandInfo {
  /** Bare name — no leading slash. May be namespaced (`plugin:command`). */
  name: string;
  description: string;
  argumentHint?: string;
  aliases?: string[];
}

interface ProjectEntry {
  commands: SlashCommandInfo[];
  updatedAt: number;
}
interface CacheFile {
  version: 2;
  projects: Record<string, ProjectEntry>;
}

function cachePath(): string {
  return path.join(app.getPath('userData'), 'slash-commands-cache.json');
}

/** Read the whole cache. A v1 file (a flat, project-less array) is discarded
 *  rather than migrated — it was global, so its contents belong to no project. */
function readFile(): CacheFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath(), 'utf-8'));
    if (parsed && parsed.version === 2 && parsed.projects && typeof parsed.projects === 'object') {
      return parsed as CacheFile;
    }
  } catch { /* missing or corrupt — start clean */ }
  return { version: 2, projects: {} };
}

function writeFile(cache: CacheFile): void {
  try {
    fs.writeFileSync(cachePath(), JSON.stringify(cache));
  } catch { /* ignore write errors */ }
}

/** Accept either a bare/slashed name string or an SDK SlashCommand object. */
export function normalizeSlashCommand(input: unknown): SlashCommandInfo | null {
  if (typeof input === 'string') {
    const name = input.trim().replace(/^\/+/, '');
    return name ? { name, description: '' } : null;
  }
  if (!input || typeof input !== 'object') return null;
  const c = input as Record<string, unknown>;
  const raw = typeof c.name === 'string' ? c.name : '';
  const name = raw.trim().replace(/^\/+/, '');
  if (!name) return null;
  const out: SlashCommandInfo = {
    name,
    description: typeof c.description === 'string' ? c.description.trim() : '',
  };
  const hint = c.argumentHint ?? c.argument_hint;
  if (typeof hint === 'string' && hint.trim()) out.argumentHint = hint.trim();
  if (Array.isArray(c.aliases)) {
    const aliases = c.aliases
      .filter((a): a is string => typeof a === 'string' && !!a.trim())
      .map(a => a.trim().replace(/^\/+/, ''));
    if (aliases.length) out.aliases = aliases;
  }
  return out;
}

/** Normalize a mixed list, dropping blanks and duplicate names (first wins). */
export function normalizeSlashCommands(input: unknown): SlashCommandInfo[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: SlashCommandInfo[] = [];
  for (const item of input) {
    const cmd = normalizeSlashCommand(item);
    if (!cmd || seen.has(cmd.name)) continue;
    seen.add(cmd.name);
    out.push(cmd);
  }
  return out;
}

export function readCachedSlashCommands(projectPath?: string): SlashCommandInfo[] {
  if (!projectPath) return [];
  return readFile().projects[projectPath]?.commands ?? [];
}

export function hasCachedSlashCommands(projectPath: string): boolean {
  return readCachedSlashCommands(projectPath).length > 0;
}

/**
 * Replace this project's list. Incoming entries with no description inherit
 * one from the same-named cached entry — a `system/init` frame carries names
 * only, and must not undo a structured supportedCommands() refresh.
 */
export function writeCachedSlashCommands(projectPath: string, commands: unknown): SlashCommandInfo[] {
  if (!projectPath) return [];
  const incoming = normalizeSlashCommands(commands);
  const cache = readFile();
  const previous = cache.projects[projectPath]?.commands ?? [];
  const byName = new Map(previous.map(c => [c.name, c]));

  const merged = incoming.map(cmd => {
    const prev = byName.get(cmd.name);
    if (!prev) return cmd;
    return {
      ...cmd,
      description: cmd.description || prev.description,
      argumentHint: cmd.argumentHint ?? prev.argumentHint,
      aliases: cmd.aliases ?? prev.aliases,
    };
  });

  // No-op writes are common (every init frame re-sends the same list).
  if (JSON.stringify(merged) === JSON.stringify(previous)) return previous;

  cache.projects[projectPath] = { commands: merged, updatedAt: Date.now() };
  writeFile(cache);
  return merged;
}

/** Drop a project's entry (workspace removed). */
export function clearCachedSlashCommands(projectPath: string): void {
  const cache = readFile();
  if (!(projectPath in cache.projects)) return;
  delete cache.projects[projectPath];
  writeFile(cache);
}
