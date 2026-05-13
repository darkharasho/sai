// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/sai-meta-test' },
}));

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  listMetaWorkspaces, createMetaWorkspace, updateMetaWorkspace,
  deleteMetaWorkspace, getMetaWorkspace,
} from '../../electron/services/metaWorkspace';

const dir = '/tmp/sai-meta-test';
const file = path.join(dir, 'settings.json');

beforeEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
});

describe('metaWorkspace store', () => {
  it('returns empty list when no settings file', () => {
    expect(listMetaWorkspaces()).toEqual([]);
  });

  it('creates a meta workspace with stable id and persists it', () => {
    const m = createMetaWorkspace({
      name: 'axi-marketing',
      projects: [{ path: '/p/a', linkName: 'a' }],
    });
    expect(m.id).toMatch(/[0-9a-f-]{36}/);
    const saved = JSON.parse(fs.readFileSync(file, 'utf-8')).metaWorkspaces;
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('axi-marketing');
  });

  it('updates only the targeted record', () => {
    const a = createMetaWorkspace({ name: 'a', projects: [] });
    const b = createMetaWorkspace({ name: 'b', projects: [] });
    updateMetaWorkspace(a.id, { name: 'a-renamed' });
    expect(getMetaWorkspace(a.id)?.name).toBe('a-renamed');
    expect(getMetaWorkspace(b.id)?.name).toBe('b');
  });

  it('deletes by id', () => {
    const m = createMetaWorkspace({ name: 'x', projects: [] });
    deleteMetaWorkspace(m.id);
    expect(listMetaWorkspaces()).toEqual([]);
  });
});
