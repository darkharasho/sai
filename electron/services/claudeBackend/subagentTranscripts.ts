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

// sessionId:toolUseId -> agentId. Only the id is cached; `finished` is re-read.
const agentIdCache = new Map<string, string>();

async function scanForAgent(
  sessionId: string,
  toolUseId: string,
  projectsRoot: string,
): Promise<{ agentId: string; finished: boolean } | null> {
  const entries = await fs.readdir(projectsRoot);
  for (const entry of entries) {
    const dir = path.join(projectsRoot, entry, sessionId, 'subagents');
    let files: string[];
    try { files = await fs.readdir(dir); } catch { continue; }
    for (const f of files) {
      const m = /^agent-(.+)\.meta\.json$/.exec(f);
      if (!m) continue;
      try {
        const meta = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
        if (meta && meta.toolUseId === toolUseId) {
          return { agentId: m[1], finished: meta.finished === true };
        }
      } catch { /* unreadable meta: skip */ }
    }
  }
  return null;
}

async function readFinished(sessionId: string, agentId: string, projectsRoot: string): Promise<boolean> {
  const entries = await fs.readdir(projectsRoot);
  for (const entry of entries) {
    const file = path.join(projectsRoot, entry, sessionId, 'subagents', `agent-${agentId}.meta.json`);
    try {
      const meta = JSON.parse(await fs.readFile(file, 'utf8'));
      return meta?.finished === true;
    } catch { /* not in this project dir */ }
  }
  return false;
}

export async function findSubagentId(
  sessionId: string,
  toolUseId: string,
  projectsRoot: string = defaultRoot(),
): Promise<{ agentId: string; finished: boolean } | null> {
  try {
    const key = `${sessionId}:${toolUseId}`;
    const cached = agentIdCache.get(key);
    if (cached) return { agentId: cached, finished: await readFinished(sessionId, cached, projectsRoot) };
    const found = await scanForAgent(sessionId, toolUseId, projectsRoot);
    if (found) agentIdCache.set(key, found.agentId);
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
    const found = await findSubagentId(sessionId, toolUseId, deps.projectsRoot);
    if (!found) return null;
    const getMessages = deps.getMessages ?? getSubagentMessages;
    const messages = await getMessages(sessionId, found.agentId, { offset });
    return { agentId: found.agentId, finished: found.finished, messages, nextOffset: offset + messages.length };
  } catch {
    return null;
  }
}
