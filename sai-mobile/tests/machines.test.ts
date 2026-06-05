import { createMachinesStore } from '../lib/machines';

const fakeStorage = (() => {
  const m = new Map<string, string>();
  return {
    getItem: async (k: string) => m.get(k) ?? null,
    setItem: async (k: string, v: string) => { m.set(k, v); },
    removeItem: async (k: string) => { m.delete(k); },
  };
})();
const fakeSecure = (() => {
  const m = new Map<string, string>();
  return {
    getItemAsync: async (k: string) => m.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => { m.set(k, v); },
    deleteItemAsync: async (k: string) => { m.delete(k); },
  };
})();

describe('machines store', () => {
  it('adds, lists, and removes machines', async () => {
    const store = createMachinesStore({ storage: fakeStorage, secure: fakeSecure });
    await store.add({ label: 'Mac', hostUrl: 'https://h.ts.net', deviceId: 'd1', token: 'tok1' });
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe('Mac');
    const tok = await store.getToken(list[0].machineId);
    expect(tok).toBe('tok1');
    await store.remove(list[0].machineId);
    expect(await store.list()).toHaveLength(0);
    expect(await store.getToken(list[0].machineId)).toBeNull();
  });
});
