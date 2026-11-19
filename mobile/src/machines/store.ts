import { getNative, type FullNativeApi } from '../native';

export interface Machine {
  id: string;
  label: string;
  baseUrl: string;
  deviceId: string;
  addedAt: number;
}

export const MACHINES_KEY = 'sai.machines.v1';
export const CLIENT_ID_KEY = 'sai.clientId.v1';
export const tokenKey = (id: string) => `token:${id}`;

export function listMachines(): Machine[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(MACHINES_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as Machine[]) : [];
  } catch {
    return [];
  }
}

function save(list: Machine[]): void {
  localStorage.setItem(MACHINES_KEY, JSON.stringify(list));
}

/** Stable per-install id sent at pairing so the desktop can recognise a re-pair. */
export function getClientId(): string {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

/** Adds a machine, replacing any existing entry (and token) for the same baseUrl. */
export async function addMachine(
  m: { label: string; baseUrl: string; deviceId: string; token: string },
  native: FullNativeApi = getNative(),
): Promise<Machine> {
  const list = listMachines();
  const existing = list.find((x) => x.baseUrl === m.baseUrl);
  const machine: Machine = {
    id: existing?.id ?? crypto.randomUUID(),
    label: existing?.label ?? m.label,
    baseUrl: m.baseUrl,
    deviceId: m.deviceId,
    addedAt: existing?.addedAt ?? Date.now(),
  };
  await native.keychainSet(tokenKey(machine.id), m.token);
  save(existing ? list.map((x) => (x.id === machine.id ? machine : x)) : [...list, machine]);
  return machine;
}

export function renameMachine(id: string, label: string): void {
  save(listMachines().map((m) => (m.id === id ? { ...m, label } : m)));
}

/** Deletes the token and the list entry. Closing a live connection is the caller's job. */
export async function removeMachine(id: string, native: FullNativeApi = getNative()): Promise<void> {
  await native.keychainRemove(tokenKey(id));
  save(listMachines().filter((m) => m.id !== id));
}

export function getToken(id: string, native: FullNativeApi = getNative()): Promise<string | null> {
  return native.keychainGet(tokenKey(id));
}
