import { uuid } from '../shims/uuid';

export interface Machine {
  machineId: string;
  label: string;
  hostUrl: string;
  deviceId: string;
  pairedAt: number;
  lastSeenAt: number | null;
}

interface Storage {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
  removeItem(k: string): Promise<void>;
}
interface Secure {
  getItemAsync(k: string): Promise<string | null>;
  setItemAsync(k: string, v: string): Promise<void>;
  deleteItemAsync(k: string): Promise<void>;
}

const LIST_KEY = 'sai-mobile-machines';
const TOKEN_KEY = (id: string) => `sai-mobile-bearer-${id}`;

export function createMachinesStore({ storage, secure }: { storage: Storage; secure: Secure }) {
  return {
    async list(): Promise<Machine[]> {
      const raw = await storage.getItem(LIST_KEY);
      if (!raw) return [];
      try { return JSON.parse(raw) as Machine[]; } catch { return []; }
    },
    async add(input: { label: string; hostUrl: string; deviceId: string; token: string }): Promise<Machine> {
      const m: Machine = {
        machineId: uuid(),
        label: input.label,
        hostUrl: input.hostUrl,
        deviceId: input.deviceId,
        pairedAt: Date.now(),
        lastSeenAt: null,
      };
      const current = await this.list();
      await storage.setItem(LIST_KEY, JSON.stringify([...current, m]));
      await secure.setItemAsync(TOKEN_KEY(m.machineId), input.token);
      return m;
    },
    async remove(machineId: string): Promise<void> {
      const current = await this.list();
      await storage.setItem(LIST_KEY, JSON.stringify(current.filter(x => x.machineId !== machineId)));
      await secure.deleteItemAsync(TOKEN_KEY(machineId));
    },
    async rename(machineId: string, label: string): Promise<void> {
      const current = await this.list();
      await storage.setItem(LIST_KEY, JSON.stringify(
        current.map(x => x.machineId === machineId ? { ...x, label } : x)
      ));
    },
    async touch(machineId: string, ts: number): Promise<void> {
      const current = await this.list();
      await storage.setItem(LIST_KEY, JSON.stringify(
        current.map(x => x.machineId === machineId ? { ...x, lastSeenAt: ts } : x)
      ));
    },
    async getToken(machineId: string): Promise<string | null> {
      return secure.getItemAsync(TOKEN_KEY(machineId));
    },
  };
}

export type MachinesStore = ReturnType<typeof createMachinesStore>;
