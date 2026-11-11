import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readSubagentTranscript, findSubagentId, isValidTranscriptRequest } from '../../../electron/services/claudeBackend/subagentTranscripts';

let root: string;
function writeMeta(proj: string, sid: string, agentId: string, meta: object) {
  const dir = path.join(root, proj, sid, 'subagents');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `agent-${agentId}.meta.json`), JSON.stringify(meta));
}
function writeJsonl(proj: string, sid: string, agentId: string, body: string, mtime?: Date) {
  const file = path.join(root, proj, sid, 'subagents', `agent-${agentId}.jsonl`);
  fs.writeFileSync(file, body);
  if (mtime) fs.utimesSync(file, mtime, mtime);
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

  it('finds an agent nested under its parent agent, and reads it from that path', async () => {
    // The CLI writes a nested agent at subagents/<parent agent id>/agent-<id>.jsonl.
    const dir = path.join(root, '-proj-a', 'sess-n', 'subagents', 'aaa', 'bbb');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'agent-ccc.meta.json'), JSON.stringify({ toolUseId: 'toolu_deep', spawnDepth: 3 }));
    fs.writeFileSync(path.join(dir, 'agent-ccc.jsonl'), '{"a":1}\n');
    expect(await findSubagentId('sess-n', 'toolu_deep', root)).toEqual({ agentId: 'ccc', finished: false });
    const getMessages = vi.fn().mockResolvedValue([msg(1)]);
    expect(await readSubagentTranscript('sess-n', 'toolu_deep', 0, { projectsRoot: root, getMessages }))
      .toMatchObject({ agentId: 'ccc', nextOffset: 1 });
  });

  it('reports finished false when the meta omits the flag (current CLI behaviour)', async () => {
    writeMeta('-proj-a', 'sess-m', 'mmm', { agentType: 'Explore', description: 'd', toolUseId: 'toolu_m', spawnDepth: 1 });
    const getMessages = vi.fn().mockResolvedValue([]);
    expect(await readSubagentTranscript('sess-m', 'toolu_m', 0, { projectsRoot: root, getMessages }))
      .toMatchObject({ agentId: 'mmm', finished: false });
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

  it('does not rescan project dirs on later calls', async () => {
    writeMeta('-proj-a', 'sess-5', 'fff', { toolUseId: 'toolu_c', finished: false });
    writeMeta('-proj-b', 'sess-5', 'ggg', { toolUseId: 'toolu_d', finished: false });
    const getMessages = vi.fn().mockResolvedValue([]);
    const deps = { projectsRoot: root, getMessages };
    await readSubagentTranscript('sess-5', 'toolu_d', 0, deps);
    const spy = vi.spyOn(fsp, 'readdir');
    expect((await readSubagentTranscript('sess-5', 'toolu_d', 0, deps))!.agentId).toBe('ggg');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('drops the cache and returns null when the cached meta is gone, then re-scans', async () => {
    writeMeta('-proj-a', 'sess-6', 'hhh', { toolUseId: 'toolu_e' });
    const getMessages = vi.fn().mockResolvedValue([]);
    const deps = { projectsRoot: root, getMessages };
    await readSubagentTranscript('sess-6', 'toolu_e', 0, deps);
    fs.rmSync(path.join(root, '-proj-a', 'sess-6'), { recursive: true });
    expect(await readSubagentTranscript('sess-6', 'toolu_e', 0, deps)).toBeNull();
    writeMeta('-proj-b', 'sess-6', 'hhh', { toolUseId: 'toolu_e' });
    expect((await readSubagentTranscript('sess-6', 'toolu_e', 0, deps))!.agentId).toBe('hhh');
  });

  it('skips the SDK when the transcript file is unchanged since the last read at that offset', async () => {
    writeMeta('-proj-a', 'sess-7', 'iii', { toolUseId: 'toolu_f', finished: false });
    writeJsonl('-proj-a', 'sess-7', 'iii', '{"a":1}\n', new Date(1_000_000));
    const getMessages = vi.fn().mockResolvedValue([msg(1)]);
    const deps = { projectsRoot: root, getMessages };
    expect(await readSubagentTranscript('sess-7', 'toolu_f', 0, deps)).toMatchObject({ nextOffset: 1 });
    const again = await readSubagentTranscript('sess-7', 'toolu_f', 1, deps);
    expect(again).toMatchObject({ agentId: 'iii', finished: false, messages: [], nextOffset: 1 });
    expect(getMessages).toHaveBeenCalledTimes(1);
    // file grows: read again
    writeJsonl('-proj-a', 'sess-7', 'iii', '{"a":1}\n{"b":2}\n', new Date(2_000_000));
    getMessages.mockResolvedValue([msg(2)]);
    expect(await readSubagentTranscript('sess-7', 'toolu_f', 1, deps)).toMatchObject({ nextOffset: 2 });
    expect(getMessages).toHaveBeenCalledTimes(2);
    // a different offset (e.g. a fresh renderer) always reads
    await readSubagentTranscript('sess-7', 'toolu_f', 0, deps);
    expect(getMessages).toHaveBeenCalledTimes(3);
  });

  it('isValidTranscriptRequest accepts a UUID session and plain ids, rejects path tricks', () => {
    const sid = '0f8fad5b-d9cb-469f-a165-70867728950e';
    expect(isValidTranscriptRequest(sid, 'toolu_01AbC', 0)).toBe(true);
    expect(isValidTranscriptRequest(sid, 'toolu_01AbC', 12)).toBe(true);
    expect(isValidTranscriptRequest('../etc', 'toolu_01AbC', 0)).toBe(false);
    expect(isValidTranscriptRequest('sess-1', 'toolu_01AbC', 0)).toBe(false);
    expect(isValidTranscriptRequest(sid, '../x', 0)).toBe(false);
    expect(isValidTranscriptRequest(sid, 'a/b', 0)).toBe(false);
    expect(isValidTranscriptRequest(sid, 'a\\b', 0)).toBe(false);
    expect(isValidTranscriptRequest(sid, '', 0)).toBe(false);
    expect(isValidTranscriptRequest(sid, 'toolu_x', -1)).toBe(false);
    expect(isValidTranscriptRequest(sid, 'toolu_x', 1.5)).toBe(false);
    expect(isValidTranscriptRequest(sid as any, 5 as any, 0)).toBe(false);
  });
});
