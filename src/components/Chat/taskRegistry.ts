import { createContext } from 'react';
import type { ChatMessage } from '../../types';

export interface TaskInfo {
  id: string;
  subject: string;
  description?: string;
  activeForm?: string;
  status: 'pending' | 'in_progress' | 'completed';
  owner?: string;
}

/** Extract a TaskCreate id from its output ("Task #1 created successfully: ..."),
 *  falling back to the provided value (a sequence counter). Mirrors the legacy
 *  TodoProgress behavior. */
export function extractTaskCreateId(output: string | undefined, fallback: string): string {
  if (!output) return fallback;
  const m = /Task\s*#?\s*([0-9a-zA-Z_-]+)\b/i.exec(output);
  if (m) return m[1];
  try {
    const parsed = JSON.parse(output);
    if (parsed && (parsed.id || parsed.taskId)) return String(parsed.id || parsed.taskId);
  } catch { /* ignore */ }
  return fallback;
}

/** Replay TaskCreate/TaskUpdate calls across the whole conversation into a
 *  task-id → TaskInfo map. TaskCreate seeds an entry; TaskUpdate mutates it
 *  (status 'deleted' removes it). Malformed inputs are skipped. */
export function buildTaskRegistry(messages: ChatMessage[]): Map<string, TaskInfo> {
  const tasks = new Map<string, TaskInfo>();
  let createSeq = 0;
  for (const m of messages) {
    if (m.role !== 'assistant' || !m.toolCalls?.length) continue;
    for (const tcall of m.toolCalls) {
      if (tcall.name === 'TaskCreate') {
        try {
          const input = JSON.parse(tcall.input || '{}');
          createSeq += 1;
          const id = extractTaskCreateId(tcall.output, String(createSeq));
          if (tasks.has(id)) continue;
          tasks.set(id, {
            id,
            subject: input.subject || input.description || 'Task',
            description: input.description,
            activeForm: input.activeForm,
            status: 'pending',
            owner: input.owner,
          });
        } catch { /* ignore malformed input */ }
      } else if (tcall.name === 'TaskUpdate') {
        try {
          const input = JSON.parse(tcall.input || '{}');
          const id = input.taskId != null ? String(input.taskId) : '';
          if (!id) continue;
          if (input.status === 'deleted') { tasks.delete(id); continue; }
          const existing = tasks.get(id);
          if (!existing) continue;
          if (input.status === 'pending' || input.status === 'in_progress' || input.status === 'completed') {
            existing.status = input.status;
          }
          if (typeof input.subject === 'string') existing.subject = input.subject;
          if (typeof input.description === 'string') existing.description = input.description;
          if (typeof input.activeForm === 'string') existing.activeForm = input.activeForm;
          if (typeof input.owner === 'string') existing.owner = input.owner;
        } catch { /* ignore malformed input */ }
      }
    }
  }
  return tasks;
}

export const TaskRegistryContext = createContext<Map<string, TaskInfo>>(new Map());
