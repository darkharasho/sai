import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { createMachinesStore, type Machine, type MachinesStore } from './machines';

// iOS Keychain default accessibility is WhenUnlocked, which throws
// "User interaction is not allowed" on background reads and during
// app foreground transitions. AFTER_FIRST_UNLOCK lets us read tokens
// any time after the first unlock since boot.
const KC_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

const secureAdapter = {
  async getItemAsync(k: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(k, KC_OPTS);
    } catch (e) {
      // Swallow keychain errors so callers see "no token" rather than
      // an unhandled promise rejection that surfaces as a red-screen.
      // We log to aid debugging but don't throw.
      console.warn('[secure] getItemAsync failed for', k, e);
      return null;
    }
  },
  async setItemAsync(k: string, v: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(k, v, KC_OPTS);
    } catch (e) {
      console.warn('[secure] setItemAsync failed for', k, e);
    }
  },
  async deleteItemAsync(k: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(k, KC_OPTS);
    } catch (e) {
      console.warn('[secure] deleteItemAsync failed for', k, e);
    }
  },
};

const backend: MachinesStore = createMachinesStore({
  storage: AsyncStorage,
  secure: secureAdapter,
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
