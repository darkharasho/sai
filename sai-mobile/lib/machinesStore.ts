import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { createMachinesStore, type Machine, type MachinesStore } from './machines';

const backend: MachinesStore = createMachinesStore({
  storage: AsyncStorage,
  secure: SecureStore,
});

interface MachinesState {
  machines: Machine[];
  loaded: boolean;
  refresh(): Promise<void>;
  add(input: { label: string; hostUrl: string; deviceId: string; token: string }): Promise<Machine>;
  remove(machineId: string): Promise<void>;
  rename(machineId: string, label: string): Promise<void>;
  touch(machineId: string, ts: number): Promise<void>;
  getToken(machineId: string): Promise<string | null>;
}

export const useMachines = create<MachinesState>((set) => ({
  machines: [],
  loaded: false,
  refresh: async () => set({ machines: await backend.list(), loaded: true }),
  add: async (input) => {
    const m = await backend.add(input);
    set({ machines: await backend.list() });
    return m;
  },
  remove: async (id) => {
    await backend.remove(id);
    set({ machines: await backend.list() });
  },
  rename: async (id, label) => {
    await backend.rename(id, label);
    set({ machines: await backend.list() });
  },
  touch: async (id, ts) => {
    await backend.touch(id, ts);
    set({ machines: await backend.list() });
  },
  getToken: (id) => backend.getToken(id),
}));
