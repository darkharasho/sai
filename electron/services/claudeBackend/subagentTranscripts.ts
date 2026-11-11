import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getSubagentMessages, type SessionMessage } from '@anthropic-ai/claude-agent-sdk';

export type SessionMessageLike = SessionMessage;

export interface SubagentTranscriptChunk {
  agentId: string;
  finished: boolean;
  messages: SessionMessageLike[];
  nextOffset: number;
}

const defaultRoot = () => path.join(os.homedir(), '.claude', 'projects');

// sessionId:toolUseId -> agent id + resolved meta path, so polling re-reads
// only that one meta file (for `finished`) instead of rescanning every project dir.
const agentCache = new Map<string, { agentId: string; metaPath: string }>();

// sessionId:toolUseId -> transcript .jsonl size/mtime at the last SDK read and the
// offset that read ended at. getSubagentMessages re-reads and parses the whole
// file, so an unchanged file polled at that same offset skips it entirely.
const statCache = new Map<string, { size: number; mtimeMs: number; nextOffset: number }>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,200}$/;

/** IPC argument guard: session must be a UUID, tool id a plain token (no path separators), offset a non-negative integer. */
export function isValidTranscriptRequest(sessionId: unknown, toolUseId: unknown, offset: unknown): boolean {
  return typeof sessionId === 'string' && UUID_RE.test(sessionId) &&
    typeof toolUseId === 'string' && SAFE_ID_RE.test(toolUseId) &&
    typeof offset === 'number' && Number.isInteger(offset) && offset >= 0;
}

async function scanForAgent(
  sessionId: string,
  toolUseId: string,
  projectsRoot: string,
): Promise<{ agentId: string; metaPath: string; finished: boolean } | null> {
  const entries = await fs.readdir(projectsRoot);
  for (const entry of entries) {
    const dir = path.join(projectsRoot, entry, sessionId, 'subagents');
    let files: string[];
    try { files = await fs.readdir(dir); } catch { continue; }
    for (const f of files) {
      const m = /^agent-(.+)\.meta\.json$/.exec(f);
      if (!m) continue;
      const metaPath = path.join(dir, f);
      try {
        const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
        if (meta && meta.toolUseId === toolUseId) {
          return { agentId: m[1], metaPath, finished: meta.finished === true };
        }
      } catch { /* unreadable meta: skip */ }
    }
  }
  return null;
}

export async function findSubagentId(
  sessionId: string,
  toolUseId: string,
  projectsRoot: string = defaultRoot(),
): Promise<{ agentId: string; finished: boolean } | null> {
  const found = await locateSubagent(sessionId, toolUseId, projectsRoot);
  return found ? { agentId: found.agentId, finished: found.finished } : null;
}

async function locateSubagent(
  sessionId: string,
  toolUseId: string,
  projectsRoot: string = defaultRoot(),
): Promise<{ agentId: string; metaPath: string; finished: boolean } | null> {
  const key = `${sessionId}:${toolUseId}`;
  try {
    const cached = agentCache.get(key);
    if (cached) {
      try {
        const meta = JSON.parse(await fs.readFile(cached.metaPath, 'utf8'));
        return { agentId: cached.agentId, metaPath: cached.metaPath, finished: meta?.finished === true };
      } catch {
        agentCache.delete(key); // next call re-scans
        return null;
      }
    }
    const found = await scanForAgent(sessionId, toolUseId, projectsRoot);
    if (!found) return null;
    agentCache.set(key, { agentId: found.agentId, metaPath: found.metaPath });
    return found;
  } catch {
    return null;
  }
}

export async function readSubagentTranscript(
  sessionId: string,
  toolUseId: string,
  offset: number,
  deps: { projectsRoot?: string; getMessages?: typeof getSubagentMessages } = {},
): Promise<SubagentTranscriptChunk | null> {
  try {
    const key = `${sessionId}:${toolUseId}`;
    const found = await locateSubagent(sessionId, toolUseId, deps.projectsRoot);
    if (!found) return null;
    // Stat before reading: if the file grows mid-read, the next stat differs and re-reads.
    let st: { size: number; mtimeMs: number } | null = null;
    try { st = await fs.stat(found.metaPath.replace(/\.meta\.json$/, '.jsonl')); } catch { /* not written yet */ }
    const prev = statCache.get(key);
    if (st && prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs && prev.nextOffset === offset) {
      return { agentId: found.agentId, finished: found.finished, messages: [], nextOffset: offset };
    }
    // No `dir` option: the SDK's `dir` is the session's original project cwd,
    // which can't be recovered from the encoded projects/<name> directory.
    const getMessages = deps.getMessages ?? getSubagentMessages;
    const messages = await getMessages(sessionId, found.agentId, { offset });
    const nextOffset = offset + messages.length;
    if (st) statCache.set(key, { size: st.size, mtimeMs: st.mtimeMs, nextOffset });
    else statCache.delete(key);
    return { agentId: found.agentId, finished: found.finished, messages, nextOffset };
  } catch {
    return null;
  }
}
