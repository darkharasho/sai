// Notification taps: the Notification Service Extension writes
// {m: keyId, c: chatId, p: projectPath} into the notification's userInfo
// after opening the sealed payload (keyId is the machine id). A tap selects
// that machine, workspace and chat; an unknown machine opens the machine list.
import type { Machine } from '../machines/store';

export interface PushTap { machineId: string | null; chatId: string | null; projectPath: string | null }

export type TapRoute =
  | { kind: 'chat'; machine: Machine; projectPath: string | null; chatId: string | null }
  | { kind: 'machines' };

const CHAT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const PATH_MAX = 512; // PUSH_PATH_MAX

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** Reads the tap's userInfo; anything malformed becomes null. */
export function parseTap(data: unknown): PushTap {
  const o = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
  const c = str(o.c);
  const p = str(o.p);
  return {
    machineId: str(o.m),
    chatId: c && CHAT_ID.test(c) ? c : null,
    projectPath: p && p.length <= PATH_MAX ? p : null,
  };
}

/** Where a tap goes, given the paired machines. */
export function routeTap(tap: PushTap, machines: Machine[]): TapRoute {
  const machine = tap.machineId ? machines.find((m) => m.id === tap.machineId) : undefined;
  if (!machine) return { kind: 'machines' };
  // A chat without its workspace can't be selected: fall back to the machine.
  return tap.projectPath
    ? { kind: 'chat', machine, projectPath: tap.projectPath, chatId: tap.chatId }
    : { kind: 'chat', machine, projectPath: null, chatId: null };
}
