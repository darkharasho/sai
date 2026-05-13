import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MetaWorkspace } from '../../src/types';

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readAll(): Record<string, any> {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf-8')); }
  catch { return {}; }
}

function writeAll(settings: Record<string, any>) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings));
}

function readList(): MetaWorkspace[] {
  const v = readAll().metaWorkspaces;
  return Array.isArray(v) ? v : [];
}

function writeList(list: MetaWorkspace[]) {
  const all = readAll();
  all.metaWorkspaces = list;
  writeAll(all);
}

export function listMetaWorkspaces(): MetaWorkspace[] {
  return readList();
}

export function getMetaWorkspace(id: string): MetaWorkspace | undefined {
  return readList().find(m => m.id === id);
}

export function createMetaWorkspace(input: {
  name: string;
  projects: { path: string; linkName: string; description?: string }[];
}): MetaWorkspace {
  const now = Date.now();
  const meta: MetaWorkspace = {
    id: randomUUID(),
    name: input.name,
    projects: input.projects,
    createdAt: now,
    lastActivity: now,
  };
  writeList([...readList(), meta]);
  return meta;
}

export function updateMetaWorkspace(
  id: string,
  patch: Partial<Pick<MetaWorkspace, 'name' | 'projects' | 'lastActivity'>>,
): MetaWorkspace | undefined {
  const list = readList();
  const idx = list.findIndex(m => m.id === id);
  if (idx === -1) return undefined;
  list[idx] = { ...list[idx], ...patch };
  writeList(list);
  return list[idx];
}

export function deleteMetaWorkspace(id: string): void {
  writeList(readList().filter(m => m.id !== id));
}
