import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSubagentTranscript, findSubagentId } from '../../../electron/services/claudeBackend/subagentTranscripts';

let root: string;
function writeMeta(proj: string, sid: string, agentId: string, meta: object) {
  const dir = path.join(root, proj, sid, 'subagents');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `agent-${agentId}.meta.json`), JSON.stringify(meta));
}
const msg = (n: number) => ({ type: 'assistant', uuid: `u${n}`, session_id: 's', message: {}, parent_tool_use_id: null });

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('subagentTranscripts', () => {
  it('finds agent by toolUseId across project dirs', async () => {
    writeMeta('-proj-a', 'sess-1', 'aaa', { toolUseId: 'toolu_other' });
    writeMeta('-proj-b', 'sess-1', 'bbb', { toolUseId: 'toolu_x', finished: false });
    expect(await findSubagentId('sess-1', 'toolu_x', root)).toEqual({ agentId: 'bbb', finished: false });
  });

  it('returns null when no meta matches', async () => {
    writeMeta('-proj-a', 'sess-0', 'aaa', { toolUseId: 'toolu_other' });
    const getMessages = vi.fn();
    expect(await findSubagentId('sess-0', 'toolu_x', root)).toBeNull();
    expect(await readSubagentTranscript('sess-0', 'toolu_x', 0, { projectsRoot: root, getMessages })).toBeNull();
    expect(getMessages).not.toHaveBeenCalled();
  });

  it('reports finished from meta and advances offset', async () => {
    writeMeta('-proj-a', 'sess-2', 'ccc', { toolUseId: 'toolu_y', finished: true });
    const getMessages = vi.fn().mockResolvedValue([msg(1), msg(2)]);
    const chunk = await readSubagentTranscript('sess-2', 'toolu_y', 3, { projectsRoot: root, getMessages });
    expect(getMessages).toHaveBeenCalledWith('sess-2', 'ccc', { offset: 3 });
    expect(chunk).toMatchObject({ agentId: 'ccc', finished: true, nextOffset: 5 });
    expect(chunk!.messages).toHaveLength(2);
  });

  it('re-reads finished on each call while caching the agent id', async () => {
    writeMeta('-proj-a', 'sess-3', 'ddd', { toolUseId: 'toolu_z', finished: false });
    const getMessages = vi.fn().mockResolvedValue([]);
    const deps = { projectsRoot: root, getMessages };
    expect((await readSubagentTranscript('sess-3', 'toolu_z', 0, deps))!.finished).toBe(false);
    writeMeta('-proj-a', 'sess-3', 'ddd', { toolUseId: 'toolu_z', finished: true });
    expect((await readSubagentTranscript('sess-3', 'toolu_z', 0, deps))!.finished).toBe(true);
  });

  it('returns null when getMessages throws', async () => {
    writeMeta('-proj-a', 'sess-4', 'eee', { toolUseId: 'toolu_w' });
    const getMessages = vi.fn().mockRejectedValue(new Error('boom'));
    expect(await readSubagentTranscript('sess-4', 'toolu_w', 0, { projectsRoot: root, getMessages })).toBeNull();
  });
});
