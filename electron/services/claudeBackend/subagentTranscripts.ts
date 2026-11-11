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
  const key = `${sessionId}:${toolUseId}`;
  try {
    const cached = agentCache.get(key);
    if (cached) {
      try {
        const meta = JSON.parse(await fs.readFile(cached.metaPath, 'utf8'));
        return { agentId: cached.agentId, finished: meta?.finished === true };
      } catch {
        agentCache.delete(key); // next call re-scans
        return null;
      }
    }
    const found = await scanForAgent(sessionId, toolUseId, projectsRoot);
    if (!found) return null;
    agentCache.set(key, { agentId: found.agentId, metaPath: found.metaPath });
    return { agentId: found.agentId, finished: found.finished };
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
    const found = await findSubagentId(sessionId, toolUseId, deps.projectsRoot);
    if (!found) return null;
    const getMessages = deps.getMessages ?? getSubagentMessages;
    const messages = await getMessages(sessionId, found.agentId, { offset });
    return { agentId: found.agentId, finished: found.finished, messages, nextOffset: offset + messages.length };
  } catch {
    return null;
  }
}
