import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Node 22+ ships a built-in `localStorage` global that takes precedence over
// jsdom's Storage implementation and lacks methods like `clear()`. Replace it
// with an in-memory polyfill so tests that exercise localStorage behave
// consistently across environments.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear() { this.store.clear(); }
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string) { this.store.set(String(key), String(value)); }
  removeItem(key: string) { this.store.delete(key); }
  key(index: number) { return Array.from(this.store.keys())[index] ?? null; }
}
for (const name of ['localStorage', 'sessionStorage'] as const) {
  Object.defineProperty(globalThis, name, {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}

// Automatically cleanup after each test to prevent DOM accumulation across tests
afterEach(() => {
  cleanup();
  (globalThis.localStorage as Storage).clear();
  (globalThis.sessionStorage as Storage).clear();
});
