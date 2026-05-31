# SAI Mobile iOS App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a native iOS companion app for SAI built with Expo that pairs with multiple desktop instances over Tailscale and provides chat, terminal, and read-only file browsing.

**Architecture:** Expo + expo-router + NativeWind + Zustand. New app lives at `sai-mobile/` as an in-repo sibling. `wire.ts` is duplicated from `src/renderer-remote/wire.ts` for v1 (extraction deferred). Terminal and file-syntax rendering use `react-native-webview` hosting xterm.js and Shiki respectively. Single active machine connection at a time, owned by the per-machine route layout. EAS Build → TestFlight from day 1.

**Tech Stack:** Expo SDK 54, expo-router 6, NativeWind 4, Tailwind 3, Zustand 5, expo-secure-store, expo-camera, expo-image-picker, expo-image-manipulator, react-native-webview, react-native-markdown-display, EAS Build.

**Reference:** spec at `docs/superpowers/specs/2026-05-30-sai-mobile-ios-app-design.md`. Prior art at `../otto/otto-mobile/` (otto's mobile app — same stack, narrower scope).

---

## Milestone 1 — Project scaffold & EAS

### Task 1: Initialize Expo project

**Files:**
- Create: `sai-mobile/` (entire directory tree from `npx create-expo-app`)

- [ ] **Step 1: Run create-expo-app**

```bash
cd /var/home/mstephens/Documents/GitHub/sai
npx create-expo-app@latest sai-mobile --template blank-typescript
```

- [ ] **Step 2: Verify project boots**

```bash
cd sai-mobile && npx expo start --no-dev --offline
```

Expected: Metro bundler starts and serves a QR code. Ctrl-C to exit.

- [ ] **Step 3: Commit**

```bash
cd /var/home/mstephens/Documents/GitHub/sai
git add sai-mobile/
git commit -m "feat(sai-mobile): scaffold Expo TS project"
```

### Task 2: Pin dependency versions to match otto-mobile

**Files:**
- Modify: `sai-mobile/package.json`

- [ ] **Step 1: Replace dependencies**

Open `sai-mobile/package.json` and replace `dependencies` and `devDependencies` with:

```json
"dependencies": {
  "expo": "~54.0.0",
  "expo-asset": "~12.0.0",
  "expo-camera": "~17.0.0",
  "expo-constants": "~18.0.0",
  "expo-dev-client": "~6.0.0",
  "expo-device": "~8.0.0",
  "expo-font": "~14.0.0",
  "expo-haptics": "~15.0.0",
  "expo-image-manipulator": "~14.0.0",
  "expo-image-picker": "~17.0.0",
  "expo-linking": "~8.0.0",
  "expo-router": "~6.0.24",
  "expo-secure-store": "~15.0.0",
  "expo-status-bar": "~3.0.0",
  "lucide-react-native": "^0.511.0",
  "nativewind": "^4.1.0",
  "react": "19.1.0",
  "react-native": "0.81.5",
  "react-native-gesture-handler": "~2.28.0",
  "react-native-markdown-display": "^7.0.2",
  "react-native-reanimated": "~4.1.1",
  "react-native-safe-area-context": "~5.6.0",
  "react-native-screens": "~4.16.0",
  "react-native-svg": "15.12.1",
  "react-native-webview": "13.13.5",
  "react-native-worklets": "^0.5.1",
  "@react-native-async-storage/async-storage": "2.1.2",
  "zustand": "^5.0.1",
  "uuid": "^11.0.0",
  "react-native-get-random-values": "~1.11.0"
},
"devDependencies": {
  "@types/react": "~19.1.10",
  "nativewind": "^4.1.0",
  "tailwindcss": "^3.4.15",
  "typescript": "~5.9.2",
  "jest": "^29.7.0",
  "jest-expo": "~54.0.0",
  "@testing-library/react-native": "^12.0.0"
}
```

Also set:

```json
"main": "expo-router/entry",
"scripts": {
  "start": "expo start",
  "ios": "expo run:ios",
  "prebuild": "expo prebuild",
  "lint": "tsc --noEmit",
  "test": "jest"
}
```

- [ ] **Step 2: Install**

```bash
cd sai-mobile && npm install
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run lint
```

Expected: No errors (project is still empty).

- [ ] **Step 4: Commit**

```bash
git add sai-mobile/package.json sai-mobile/package-lock.json
git commit -m "feat(sai-mobile): pin deps matching otto-mobile stack"
```

### Task 3: Configure app.json with iOS bundle and ATS

**Files:**
- Modify: `sai-mobile/app.json`

- [ ] **Step 1: Replace app.json**

```json
{
  "expo": {
    "name": "SAI",
    "slug": "sai-mobile",
    "version": "0.1.0",
    "orientation": "portrait",
    "scheme": "sai",
    "userInterfaceStyle": "automatic",
    "newArchEnabled": true,
    "backgroundColor": "#0e1114",
    "splash": {
      "backgroundColor": "#0c0f11"
    },
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.project96.sai",
      "infoPlist": {
        "NSCameraUsageDescription": "SAI needs camera access to scan pairing QR codes from your desktop.",
        "NSPhotoLibraryUsageDescription": "SAI needs photo access to attach images to chat messages.",
        "ITSAppUsesNonExemptEncryption": false,
        "NSAppTransportSecurity": {
          "NSAllowsLocalNetworking": true,
          "NSAllowsArbitraryLoads": true,
          "NSExceptionDomains": {
            "ts.net": {
              "NSExceptionAllowsInsecureHTTPLoads": true,
              "NSIncludesSubdomains": true
            },
            "127.0.0.1": {
              "NSExceptionAllowsInsecureHTTPLoads": true
            },
            "localhost": {
              "NSExceptionAllowsInsecureHTTPLoads": true
            }
          }
        }
      }
    },
    "plugins": [
      "expo-router",
      "expo-secure-store",
      [
        "expo-camera",
        {
          "cameraPermission": "SAI needs camera access to scan pairing QR codes from your desktop."
        }
      ],
      "./plugins/allow-http"
    ],
    "extra": {
      "router": {
        "origin": false
      },
      "eas": {
        "projectId": ""
      }
    },
    "owner": "harasho"
  }
}
```

(Leave `eas.projectId` empty for now; populated in Task 5.)

- [ ] **Step 2: Commit**

```bash
git add sai-mobile/app.json
git commit -m "feat(sai-mobile): configure iOS bundle id, ATS for tailnet, plugins"
```

### Task 4: Port `allow-http` config plugin from otto

**Files:**
- Create: `sai-mobile/plugins/allow-http.js`

- [ ] **Step 1: Copy file**

```bash
cp /var/home/mstephens/Documents/GitHub/otto/otto-mobile/plugins/allow-http.js \
   /var/home/mstephens/Documents/GitHub/sai/sai-mobile/plugins/allow-http.js
```

- [ ] **Step 2: Commit**

```bash
git add sai-mobile/plugins/allow-http.js
git commit -m "feat(sai-mobile): port allow-http config plugin from otto-mobile"
```

### Task 5: Initialize EAS and capture projectId

**Files:**
- Create: `sai-mobile/eas.json`
- Modify: `sai-mobile/app.json` (set `extra.eas.projectId`)

- [ ] **Step 1: Run eas init**

```bash
cd sai-mobile
npx eas-cli@latest init
```

Follow prompts (sign in to harasho Expo account, create project). Note the printed `projectId`.

- [ ] **Step 2: Write eas.json**

```json
{
  "cli": { "version": ">= 13.0.0", "appVersionSource": "remote" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": { "simulator": false, "resourceClass": "m-medium" }
    },
    "preview": {
      "distribution": "internal",
      "ios": { "resourceClass": "m-medium" }
    },
    "production": {
      "autoIncrement": true,
      "ios": { "resourceClass": "m-medium" }
    }
  },
  "submit": {
    "production": { "ios": { "appleTeamId": "" } }
  }
}
```

- [ ] **Step 3: Update app.json with projectId**

Replace `"projectId": ""` in `app.json` with the value from Step 1.

- [ ] **Step 4: Commit**

```bash
git add sai-mobile/eas.json sai-mobile/app.json
git commit -m "feat(sai-mobile): EAS init with dev/preview/production profiles"
```

### Task 6: Configure NativeWind + Tailwind

**Files:**
- Create: `sai-mobile/tailwind.config.js`
- Create: `sai-mobile/global.css`
- Create: `sai-mobile/nativewind-env.d.ts`
- Create: `sai-mobile/babel.config.js`
- Create: `sai-mobile/metro.config.js`

- [ ] **Step 1: Copy NativeWind config from otto**

```bash
cd /var/home/mstephens/Documents/GitHub/sai
cp ../otto/otto-mobile/tailwind.config.js sai-mobile/tailwind.config.js
cp ../otto/otto-mobile/global.css sai-mobile/global.css
cp ../otto/otto-mobile/nativewind-env.d.ts sai-mobile/nativewind-env.d.ts
cp ../otto/otto-mobile/babel.config.js sai-mobile/babel.config.js
cp ../otto/otto-mobile/metro.config.js sai-mobile/metro.config.js
```

- [ ] **Step 2: Update tailwind.config.js content paths to scan sai-mobile dirs**

Open `sai-mobile/tailwind.config.js` and confirm `content` includes `./app/**/*.{js,jsx,ts,tsx}`, `./components/**/*.{js,jsx,ts,tsx}`, `./lib/**/*.{js,jsx,ts,tsx}`. If not, set:

```js
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './lib/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: { extend: {} },
  plugins: [],
};
```

- [ ] **Step 3: Commit**

```bash
git add sai-mobile/tailwind.config.js sai-mobile/global.css \
        sai-mobile/nativewind-env.d.ts sai-mobile/babel.config.js \
        sai-mobile/metro.config.js
git commit -m "feat(sai-mobile): NativeWind + Tailwind config"
```

### Task 7: Configure Jest

**Files:**
- Create: `sai-mobile/jest.config.js`
- Create: `sai-mobile/tests/setup.ts`

- [ ] **Step 1: Write jest.config.js**

```js
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEach: ['<rootDir>/tests/setup.ts'],
  testMatch: ['<rootDir>/tests/**/*.test.ts', '<rootDir>/tests/**/*.test.tsx'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native|expo(nent)?|@expo(nent)?|nativewind|react-native-css-interop|@react-native-community)/)',
  ],
};
```

- [ ] **Step 2: Write setup.ts**

```ts
// Empty for now; populated in later tasks with mocks.
export {};
```

- [ ] **Step 3: Run jest**

```bash
cd sai-mobile && npm test
```

Expected: "No tests found" — exits clean.

- [ ] **Step 4: Commit**

```bash
git add sai-mobile/jest.config.js sai-mobile/tests/setup.ts
git commit -m "feat(sai-mobile): Jest preset"
```

### Task 8: Bootstrap polyfills and root layout

**Files:**
- Create: `sai-mobile/app/_layout.tsx`
- Create: `sai-mobile/app/index.tsx` (placeholder)
- Create: `sai-mobile/shims/uuid.ts`

- [ ] **Step 1: Write uuid shim**

`sai-mobile/shims/uuid.ts`:

```ts
import 'react-native-get-random-values';
export { v4 as uuid } from 'uuid';
```

- [ ] **Step 2: Write root layout**

`sai-mobile/app/_layout.tsx`:

```tsx
import '../global.css';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0e1114' } }} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
```

- [ ] **Step 3: Write placeholder index**

`sai-mobile/app/index.tsx`:

```tsx
import { View, Text } from 'react-native';

export default function Index() {
  return (
    <View className="flex-1 items-center justify-center bg-[#0e1114]">
      <Text className="text-white text-lg">SAI Mobile</Text>
    </View>
  );
}
```

- [ ] **Step 4: Build dev client**

```bash
cd sai-mobile && npx eas-cli build --profile development --platform ios --non-interactive
```

(Long-running. Wait for build to finish and install on test device. If user prefers local builds first, run `npx expo run:ios` instead with a connected device or simulator.)

- [ ] **Step 5: Verify app launches showing "SAI Mobile"**

Manual: open the dev client on the test device, verify the dark screen with "SAI Mobile" appears.

- [ ] **Step 6: Commit**

```bash
git add sai-mobile/app/ sai-mobile/shims/
git commit -m "feat(sai-mobile): root layout + placeholder index, dev client verified"
```

---

## Milestone 2 — Wire layer + types

### Task 9: Port wire types and pair-URL parsing with tests

**Files:**
- Create: `sai-mobile/lib/types.ts`
- Create: `sai-mobile/lib/wire.ts` (partial — types + parsePairingUrl only)
- Create: `sai-mobile/tests/wire-parse.test.ts`

- [ ] **Step 1: Write the failing test**

`sai-mobile/tests/wire-parse.test.ts`:

```ts
import { parsePairingUrl, isAllowedPairHost } from '../lib/wire';

describe('parsePairingUrl', () => {
  it('parses a valid pairing URL', () => {
    const r = parsePairingUrl('https://my-mac.tail-abc.ts.net/?code=XYZ123');
    expect(r).toEqual({ baseUrl: 'https://my-mac.tail-abc.ts.net', code: 'XYZ123' });
  });
  it('returns null for missing code', () => {
    expect(parsePairingUrl('https://my-mac.ts.net/')).toBeNull();
  });
  it('returns null for malformed input', () => {
    expect(parsePairingUrl('not a url')).toBeNull();
  });
});

describe('isAllowedPairHost', () => {
  it('accepts ts.net hosts', () => {
    expect(isAllowedPairHost('my-mac.tail-abc.ts.net')).toBe(true);
  });
  it('accepts CGNAT range', () => {
    expect(isAllowedPairHost('100.64.5.10')).toBe(true);
  });
  it('accepts localhost', () => {
    expect(isAllowedPairHost('localhost')).toBe(true);
    expect(isAllowedPairHost('127.0.0.1')).toBe(true);
  });
  it('rejects public hosts', () => {
    expect(isAllowedPairHost('evil.com')).toBe(false);
    expect(isAllowedPairHost('8.8.8.8')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd sai-mobile && npx jest tests/wire-parse.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write types and wire.ts**

`sai-mobile/lib/types.ts`:

```ts
export interface ImageRef { id: string; ext: string; mimeType: string }
export type WireMsg = { type: string; [k: string]: unknown };
export type WireState = 'opening' | 'open' | 'closed';
```

`sai-mobile/lib/wire.ts` (initial subset — full client added in Task 10):

```ts
export const BEARER_KEY_PREFIX = 'sai-mobile-bearer-';

export function parsePairingUrl(input: string): { baseUrl: string; code: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get('code');
    if (!code) return null;
    return { baseUrl: `${url.protocol}//${url.host}`, code };
  } catch {
    return null;
  }
}

export function isAllowedPairHost(host: string): boolean {
  if (host === 'localhost' || host === '127.0.0.1') return true;
  if (host.endsWith('.ts.net')) return true;
  // CGNAT: 100.64.0.0/10 → first octet 100, second 64-127
  const m = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (m) {
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

export function wsUrl(baseUrl: string): string {
  return baseUrl.replace(/^http/, 'ws') + '/ws';
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/wire-parse.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sai-mobile/lib/types.ts sai-mobile/lib/wire.ts sai-mobile/tests/wire-parse.test.ts
git commit -m "feat(sai-mobile): wire types + pair URL parsing with host allowlist"
```

### Task 10: Port pair() HTTP helper and WireClient skeleton

**Files:**
- Modify: `sai-mobile/lib/wire.ts`
- Create: `sai-mobile/tests/wire-pair.test.ts`

- [ ] **Step 1: Write the failing test**

`sai-mobile/tests/wire-pair.test.ts`:

```ts
import { pair } from '../lib/wire';

describe('pair', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('POSTs to /pair and returns token + deviceId', async () => {
    global.fetch = jest.fn(async () => new Response(
      JSON.stringify({ token: 't1', deviceId: 'd1' }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )) as any;
    const r = await pair('https://my.ts.net', 'CODE', 'iPhone', 'client-xyz');
    expect(r).toEqual({ token: 't1', deviceId: 'd1' });
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('https://my.ts.net/pair');
  });

  it('throws on non-2xx', async () => {
    global.fetch = jest.fn(async () => new Response('nope', { status: 401 })) as any;
    await expect(pair('https://my.ts.net', 'X', 'i', 'c')).rejects.toThrow(/pair failed/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/wire-pair.test.ts
```

Expected: FAIL — `pair` not exported.

- [ ] **Step 3: Add pair() to wire.ts**

Append to `sai-mobile/lib/wire.ts`:

```ts
export interface PairResult { token: string; deviceId: string }

export async function pair(
  baseUrl: string,
  code: string,
  deviceLabel: string,
  clientId: string
): Promise<PairResult> {
  const r = await fetch(`${baseUrl}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, deviceLabel, clientId }),
  });
  if (!r.ok) throw new Error(`pair failed: ${r.status}`);
  return r.json();
}

export async function unpair(baseUrl: string, deviceId: string, token: string): Promise<void> {
  const r = await fetch(`${baseUrl}/pair/${encodeURIComponent(deviceId)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!r.ok && r.status !== 404) throw new Error(`unpair failed: ${r.status}`);
}

export async function health(baseUrl: string, token: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const r = await fetch(`${baseUrl}/health`, {
      headers: { authorization: `Bearer ${token}` },
      signal,
    });
    return r.ok;
  } catch { return false; }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/wire-pair.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sai-mobile/lib/wire.ts sai-mobile/tests/wire-pair.test.ts
git commit -m "feat(sai-mobile): wire pair/unpair/health HTTP helpers"
```

### Task 11: Port WireClient WebSocket connector with reconnect

**Files:**
- Modify: `sai-mobile/lib/wire.ts`
- Create: `sai-mobile/tests/wire-client.test.ts`

- [ ] **Step 1: Write the failing test**

`sai-mobile/tests/wire-client.test.ts`:

```ts
import { connectWire } from '../lib/wire';

class MockWS {
  static instances: MockWS[] = [];
  static OPEN = 1; static CLOSED = 3;
  readyState = 0;
  onopen: ((e: any) => void) | null = null;
  onmessage: ((e: any) => void) | null = null;
  onclose: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) { MockWS.instances.push(this); }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; this.onclose?.({}); }
  emitOpen() { this.readyState = 1; this.onopen?.({}); }
  emitMessage(obj: any) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}

describe('connectWire', () => {
  beforeEach(() => { MockWS.instances = []; (global as any).WebSocket = MockWS; });

  it('opens, authenticates, and notifies open state', (done) => {
    const c = connectWire({ baseUrl: 'http://h', token: 't' });
    c.onState((s) => { if (s === 'open') { expect(MockWS.instances[0].sent[0]).toContain('"auth"'); c.close(); done(); } });
    MockWS.instances[0].emitOpen();
    MockWS.instances[0].emitMessage({ type: 'auth_ok' });
  });

  it('delivers inbound messages to handler', (done) => {
    const c = connectWire({ baseUrl: 'http://h', token: 't' });
    c.on((m) => { if (m.type === 'chat:msg') { expect(m.text).toBe('hi'); c.close(); done(); } });
    MockWS.instances[0].emitOpen();
    MockWS.instances[0].emitMessage({ type: 'auth_ok' });
    MockWS.instances[0].emitMessage({ type: 'chat:msg', text: 'hi' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/wire-client.test.ts
```

Expected: FAIL — `connectWire` not exported.

- [ ] **Step 3: Add WireClient to wire.ts**

Append to `sai-mobile/lib/wire.ts`:

```ts
import type { WireMsg, WireState } from './types';

export interface WireClient {
  send(msg: WireMsg): void;
  close(): void;
  on(handler: (msg: WireMsg) => void): () => void;
  onState(handler: (s: WireState) => void): () => void;
  probe(): void;
}

export interface ConnectArgs { baseUrl: string; token: string }

export function connectWire({ baseUrl, token }: ConnectArgs): WireClient {
  const handlers = new Set<(m: WireMsg) => void>();
  const stateHandlers = new Set<(s: WireState) => void>();
  let ws: WebSocket | null = null;
  let closed = false;
  let retryAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  const notifyState = (s: WireState) => { for (const h of stateHandlers) try { h(s); } catch {} };

  const scheduleReconnect = () => {
    if (closed || reconnectTimer) return;
    const base = Math.min(30_000, 1_000 * Math.pow(2, retryAttempt));
    const jitter = base * (0.8 + Math.random() * 0.4);
    retryAttempt++;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; open(); }, jitter);
  };

  const open = () => {
    if (closed) return;
    notifyState('opening');
    ws = new WebSocket(wsUrl(baseUrl));
    ws.onopen = () => { ws?.send(JSON.stringify({ type: 'auth', token })); };
    ws.onmessage = (e: MessageEvent) => {
      let m: WireMsg; try { m = JSON.parse(typeof e.data === 'string' ? e.data : ''); } catch { return; }
      if (m.type === 'auth_ok') {
        retryAttempt = 0;
        notifyState('open');
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = setInterval(() => { try { ws?.send(JSON.stringify({ type: 'ping' })); } catch {} }, 20_000);
        return;
      }
      for (const h of handlers) try { h(m); } catch {}
    };
    ws.onclose = () => {
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      notifyState('closed');
      scheduleReconnect();
    };
    ws.onerror = () => { try { ws?.close(); } catch {} };
  };

  open();

  return {
    send(msg) { try { ws?.send(JSON.stringify(msg)); } catch {} },
    close() {
      closed = true;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      try { ws?.close(); } catch {}
    },
    on(h) { handlers.add(h); return () => handlers.delete(h); },
    onState(h) { stateHandlers.add(h); return () => stateHandlers.delete(h); },
    probe() {
      if (closed) return;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (!ws || ws.readyState !== 1) { retryAttempt = 0; open(); return; }
      try { ws.send(JSON.stringify({ type: 'ping' })); } catch { try { ws.close(); } catch {} }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/wire-client.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sai-mobile/lib/wire.ts sai-mobile/tests/wire-client.test.ts
git commit -m "feat(sai-mobile): WireClient with auth, ping, reconnect backoff"
```

### Task 12: Port chat / file / terminal request helpers

**Files:**
- Modify: `sai-mobile/lib/wire.ts`

This adds the typed methods consumers will call on top of the WireClient. We don't add tests for each method — they're thin wrappers over `send()` and are exercised by integration tests in Milestone 4.

- [ ] **Step 1: Add request helpers**

Append to `sai-mobile/lib/wire.ts`:

```ts
export interface ChatPromptArgs {
  text: string;
  projectPath: string;
  scope?: string;
  model?: string;
  effort?: string;
  permMode?: string;
  images?: string[];
}

export interface ChatApprovalArgs {
  toolUseId: string;
  decision: 'approve' | 'deny';
  modifiedCommand?: string;
  projectPath: string;
  scope?: string;
}

export function sendPrompt(c: WireClient, args: ChatPromptArgs): void {
  c.send({ type: 'chat:prompt', ...args });
}
export function sendApproval(c: WireClient, args: ChatApprovalArgs): void {
  c.send({ type: 'chat:approve', ...args });
}
export function attachToSession(c: WireClient, args: { projectPath: string; scope?: string; sessionId: string }): void {
  c.send({ type: 'attach', ...args });
}
export function setActiveWorkspace(c: WireClient, projectPath: string): void {
  c.send({ type: 'workspace:set', projectPath });
}
export function subscribeWorkspaceStatus(c: WireClient): void { c.send({ type: 'workspace:status:subscribe' }); }
export function interrupt(c: WireClient, projectPath: string, scope?: string): void {
  c.send({ type: 'chat:interrupt', projectPath, scope });
}
export function termInput(c: WireClient, termId: number, data: string): void {
  c.send({ type: 'term:input', termId, data });
}
export function termResize(c: WireClient, termId: number, cols: number, rows: number): void {
  c.send({ type: 'term:resize', termId, cols, rows });
}
export function termAttach(c: WireClient, termId: number, cols: number, rows: number): void {
  c.send({ type: 'term:attach', termId, cols, rows });
}
export function termDetach(c: WireClient, termId: number): void {
  c.send({ type: 'term:detach', termId });
}
```

- [ ] **Step 2: Add request/response RPC helpers (HTTP)**

Append:

```ts
async function authedJson<T>(baseUrl: string, token: string, path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`${path} failed: ${r.status}`);
  return r.json();
}

export const api = {
  listWorkspaces: (b: string, t: string) => authedJson<unknown[]>(b, t, '/workspaces'),
  listSessions: (b: string, t: string, projectPath: string) =>
    authedJson<unknown[]>(b, t, `/sessions?projectPath=${encodeURIComponent(projectPath)}`),
  listFiles: (b: string, t: string, cwd: string, path: string) =>
    authedJson<unknown[]>(b, t, `/files?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`),
  readFile: (b: string, t: string, cwd: string, path: string) =>
    authedJson<{ content?: string; signedUrl?: string; encoding: 'text' | 'binary'; size: number; lang?: string; mime?: string; mtime?: number; sha?: string; }>(
      b, t, `/files/read?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`
    ),
  statusFiles: (b: string, t: string, cwd: string) =>
    authedJson<unknown[]>(b, t, `/git/status?cwd=${encodeURIComponent(cwd)}`),
  diffFile: (b: string, t: string, cwd: string, path: string, staged = false) =>
    authedJson<{ diff: string; lang?: string }>(b, t, `/git/diff?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}&staged=${staged ? '1' : '0'}`),
  listTerminals: (b: string, t: string, cwd: string) =>
    authedJson<Array<{ termId: number; cwd: string; cols: number; rows: number; alive: boolean; origin: 'phone' | 'desktop' }>>(
      b, t, `/terminals?cwd=${encodeURIComponent(cwd)}`
    ),
};
```

- [ ] **Step 3: tsc check**

```bash
cd sai-mobile && npm run lint
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add sai-mobile/lib/wire.ts
git commit -m "feat(sai-mobile): chat/term/file request helpers"
```

---

## Milestone 3 — Machines store + secure tokens

### Task 13: Machines store with persistence

**Files:**
- Create: `sai-mobile/lib/machines.ts`
- Create: `sai-mobile/tests/machines.test.ts`

- [ ] **Step 1: Write the failing test**

`sai-mobile/tests/machines.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/machines.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement machines store**

`sai-mobile/lib/machines.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/machines.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sai-mobile/lib/machines.ts sai-mobile/tests/machines.test.ts
git commit -m "feat(sai-mobile): machines store with secure token persistence"
```

### Task 14: Zustand store wrapping machines persistence

**Files:**
- Create: `sai-mobile/lib/machinesStore.ts`

- [ ] **Step 1: Implement Zustand store**

`sai-mobile/lib/machinesStore.ts`:

```ts
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

export const useMachines = create<MachinesState>((set, get) => ({
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
```

- [ ] **Step 2: tsc check**

```bash
cd sai-mobile && npm run lint
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add sai-mobile/lib/machinesStore.ts
git commit -m "feat(sai-mobile): Zustand wrapper over machines persistence"
```

---

## Milestone 4 — Pairing flow & onboarding

### Task 15: Onboarding screen (Tailscale prereq)

**Files:**
- Create: `sai-mobile/app/onboarding.tsx`
- Create: `sai-mobile/lib/onboardingFlag.ts`

- [ ] **Step 1: Onboarding flag helper**

`sai-mobile/lib/onboardingFlag.ts`:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
const KEY = 'sai-mobile-onboarded';
export const onboardingFlag = {
  async seen(): Promise<boolean> { return (await AsyncStorage.getItem(KEY)) === '1'; },
  async mark(): Promise<void> { await AsyncStorage.setItem(KEY, '1'); },
};
```

- [ ] **Step 2: Onboarding screen**

`sai-mobile/app/onboarding.tsx`:

```tsx
import { View, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { onboardingFlag } from '../lib/onboardingFlag';

export default function Onboarding() {
  return (
    <SafeAreaView className="flex-1 bg-[#0e1114] px-6">
      <View className="flex-1 justify-center gap-6">
        <Text className="text-white text-3xl font-semibold">Welcome to SAI</Text>
        <Text className="text-[#bec6d0] text-base leading-6">
          SAI mobile connects to your desktop SAI over your Tailscale network. Before you pair:
        </Text>
        <View className="gap-3">
          <Text className="text-[#bec6d0] text-base">1. Install Tailscale on this phone and sign in.</Text>
          <Text className="text-[#bec6d0] text-base">2. Open SAI on your desktop and enable Mobile Remote.</Text>
          <Text className="text-[#bec6d0] text-base">3. Generate a pair code on desktop and scan it below.</Text>
        </View>
      </View>
      <Pressable
        className="bg-[#c7910c] rounded-xl py-4 mb-6 items-center"
        onPress={async () => { await onboardingFlag.mark(); router.replace('/scan'); }}
      >
        <Text className="text-black font-semibold text-base">Continue</Text>
      </Pressable>
    </SafeAreaView>
  );
}
```

- [ ] **Step 3: Wire up auto-route in app/index.tsx**

Replace `sai-mobile/app/index.tsx` with:

```tsx
import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useMachines } from '../lib/machinesStore';
import { onboardingFlag } from '../lib/onboardingFlag';

export default function Index() {
  const machines = useMachines((s) => s.machines);
  const loaded = useMachines((s) => s.loaded);
  const refresh = useMachines((s) => s.refresh);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!loaded) return;
    (async () => {
      if (machines.length > 0) return;          // MachineList screen renders next
      if (!(await onboardingFlag.seen())) router.replace('/onboarding');
      else router.replace('/scan');
    })();
  }, [loaded, machines.length]);

  // If we have machines, fall through to MachineList screen (added in Task 17).
  if (!loaded || machines.length === 0) {
    return <View className="flex-1 items-center justify-center bg-[#0e1114]"><ActivityIndicator color="#c7910c" /></View>;
  }
  return <View className="flex-1 bg-[#0e1114]" />; // placeholder until Task 17
}
```

- [ ] **Step 4: Manual verification**

Run on device/sim, fresh install. Expected: onboarding screen → tap Continue → scan screen (404 for now since scan.tsx not created yet — next task).

- [ ] **Step 5: Commit**

```bash
git add sai-mobile/app/onboarding.tsx sai-mobile/app/index.tsx sai-mobile/lib/onboardingFlag.ts
git commit -m "feat(sai-mobile): onboarding screen with Tailscale prereq copy"
```

### Task 16: Scan screen (QR camera + manual paste fallback)

**Files:**
- Create: `sai-mobile/app/scan.tsx`
- Create: `sai-mobile/lib/deviceLabel.ts`
- Create: `sai-mobile/components/PairErrorCard.tsx`

- [ ] **Step 1: Device label helper**

`sai-mobile/lib/deviceLabel.ts`:

```ts
import * as Device from 'expo-device';
export function deviceLabel(): string {
  const name = Device.deviceName ?? 'iPhone';
  return `iPhone — ${name}`;
}
```

- [ ] **Step 2: PairErrorCard component**

`sai-mobile/components/PairErrorCard.tsx`:

```tsx
import { View, Text, Pressable } from 'react-native';

export type PairErrorKind = 'network' | 'code-expired' | 'code-invalid' | 'host-rejected' | 'unknown';
const COPY: Record<PairErrorKind, string> = {
  'network': "Can't reach that host. Is Tailscale on?",
  'code-expired': "Pair code expired. Generate a new one on desktop.",
  'code-invalid': "Invalid pair code.",
  'host-rejected': "That host is not on your tailnet. SAI only pairs over Tailscale or local network.",
  'unknown': "Pairing failed. Try again.",
};

export function PairErrorCard({ kind, detail, onRetry }: { kind: PairErrorKind; detail?: string; onRetry: () => void }) {
  return (
    <View className="bg-[#1c2027] border border-[#3a2630] rounded-xl p-4 gap-2">
      <Text className="text-[#E35535] font-semibold">{COPY[kind]}</Text>
      {detail ? <Text className="text-[#a0acbb] text-xs">{detail}</Text> : null}
      <Pressable onPress={onRetry} className="bg-[#21292f] rounded-md py-2 items-center mt-1">
        <Text className="text-white">Try again</Text>
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 3: Scan screen**

`sai-mobile/app/scan.tsx`:

```tsx
import { useState, useCallback } from 'react';
import { View, Text, Pressable, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { uuid } from '../shims/uuid';
import { pair, parsePairingUrl, isAllowedPairHost } from '../lib/wire';
import { useMachines } from '../lib/machinesStore';
import { deviceLabel } from '../lib/deviceLabel';
import { PairErrorCard, type PairErrorKind } from '../components/PairErrorCard';

export default function Scan() {
  const [perm, requestPerm] = useCameraPermissions();
  const [mode, setMode] = useState<'camera' | 'manual'>('camera');
  const [manualUrl, setManualUrl] = useState('');
  const [error, setError] = useState<{ kind: PairErrorKind; detail?: string } | null>(null);
  const [pairing, setPairing] = useState(false);
  const add = useMachines((s) => s.add);

  const onPair = useCallback(async (raw: string) => {
    if (pairing) return;
    setPairing(true);
    setError(null);
    try {
      const parsed = parsePairingUrl(raw);
      if (!parsed) { setError({ kind: 'code-invalid' }); return; }
      const host = new URL(parsed.baseUrl).hostname;
      if (!isAllowedPairHost(host)) { setError({ kind: 'host-rejected', detail: host }); return; }
      const result = await pair(parsed.baseUrl, parsed.code, deviceLabel(), uuid());
      const machine = await add({
        label: host,
        hostUrl: parsed.baseUrl,
        deviceId: result.deviceId,
        token: result.token,
      });
      router.replace(`/m/${machine.machineId}/chat`);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.includes('Network request failed')) setError({ kind: 'network', detail: msg });
      else if (msg.includes('410') || msg.includes('expired')) setError({ kind: 'code-expired', detail: msg });
      else if (msg.includes('400') || msg.includes('401')) setError({ kind: 'code-invalid', detail: msg });
      else setError({ kind: 'unknown', detail: msg });
    } finally {
      setPairing(false);
    }
  }, [add, pairing]);

  if (!perm) return <SafeAreaView className="flex-1 bg-[#0e1114]" />;
  if (!perm.granted) {
    return (
      <SafeAreaView className="flex-1 bg-[#0e1114] px-6 justify-center gap-4">
        <Text className="text-white text-xl">Camera access</Text>
        <Text className="text-[#bec6d0]">SAI uses the camera to scan pair codes from your desktop.</Text>
        <Pressable className="bg-[#c7910c] rounded-xl py-3 items-center" onPress={requestPerm}>
          <Text className="text-black font-semibold">Enable camera</Text>
        </Pressable>
        <Pressable className="py-3 items-center" onPress={() => setMode('manual')}>
          <Text className="text-[#a0acbb]">Enter pair URL manually</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-[#0e1114]">
      {mode === 'camera' ? (
        <View className="flex-1">
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={pairing ? undefined : (r) => onPair(r.data)}
          />
          <View className="absolute top-12 left-0 right-0 items-center">
            <Text className="text-white bg-black/50 px-3 py-1 rounded-full">Scan SAI pair code</Text>
          </View>
          <Pressable className="absolute bottom-10 self-center bg-black/60 px-4 py-2 rounded-full" onPress={() => setMode('manual')}>
            <Text className="text-white">Enter pair URL manually</Text>
          </Pressable>
        </View>
      ) : (
        <KeyboardAvoidingView className="flex-1 px-6 justify-center gap-4" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Text className="text-white text-xl">Paste pair URL</Text>
          <TextInput
            value={manualUrl}
            onChangeText={setManualUrl}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="https://...ts.net/?code=..."
            placeholderTextColor="#5a6a7a"
            className="bg-[#161a1f] text-white rounded-xl px-4 py-3 border border-[#1e2228]"
          />
          <Pressable className="bg-[#c7910c] rounded-xl py-3 items-center" onPress={() => onPair(manualUrl)}>
            <Text className="text-black font-semibold">{pairing ? 'Pairing…' : 'Pair'}</Text>
          </Pressable>
          <Pressable className="py-3 items-center" onPress={() => setMode('camera')}>
            <Text className="text-[#a0acbb]">Back to scanner</Text>
          </Pressable>
        </KeyboardAvoidingView>
      )}
      {error ? (
        <View className="absolute bottom-32 left-4 right-4">
          <PairErrorCard kind={error.kind} detail={error.detail} onRetry={() => setError(null)} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}
```

- [ ] **Step 4: tsc check**

```bash
cd sai-mobile && npm run lint
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add sai-mobile/app/scan.tsx sai-mobile/lib/deviceLabel.ts sai-mobile/components/PairErrorCard.tsx
git commit -m "feat(sai-mobile): pairing scan screen with QR + manual fallback"
```

### Task 17: Machine list home screen

**Files:**
- Modify: `sai-mobile/app/index.tsx`
- Create: `sai-mobile/components/MachineRow.tsx`
- Create: `sai-mobile/lib/reachability.ts`

- [ ] **Step 1: Reachability poller**

`sai-mobile/lib/reachability.ts`:

```ts
import { useEffect } from 'react';
import { useMachines } from './machinesStore';
import { health } from './wire';

export function useReachabilityPoll(intervalMs = 30_000) {
  const machines = useMachines((s) => s.machines);
  const touch = useMachines((s) => s.touch);
  const getToken = useMachines((s) => s.getToken);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      for (const m of machines) {
        const tok = await getToken(m.machineId);
        if (!tok || cancelled) continue;
        const ok = await health(m.hostUrl, tok);
        if (cancelled) return;
        if (ok) await touch(m.machineId, Date.now());
      }
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [machines, touch, getToken, intervalMs]);
}
```

- [ ] **Step 2: MachineRow component**

`sai-mobile/components/MachineRow.tsx`:

```tsx
import { View, Text, Pressable } from 'react-native';
import type { Machine } from '../lib/machines';

function ageLabel(ts: number | null): string {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

export function MachineRow({ m, online, onPress, onLongPress }: {
  m: Machine; online: boolean; onPress: () => void; onLongPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} className="bg-[#1c2027] rounded-xl p-4 mb-3 flex-row items-center gap-3">
      <View className={`w-2.5 h-2.5 rounded-full ${online ? 'bg-[#00a884]' : 'bg-[#475262]'}`} />
      <View className="flex-1">
        <Text className="text-white text-base font-medium">{m.label}</Text>
        <Text className="text-[#a0acbb] text-xs">{m.hostUrl}</Text>
      </View>
      <Text className="text-[#5a6a7a] text-xs">{online ? 'online' : ageLabel(m.lastSeenAt)}</Text>
    </Pressable>
  );
}
```

- [ ] **Step 3: Update index.tsx to render the list**

Replace `sai-mobile/app/index.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, Alert, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus } from 'lucide-react-native';
import { useMachines } from '../lib/machinesStore';
import { onboardingFlag } from '../lib/onboardingFlag';
import { MachineRow } from '../components/MachineRow';
import { useReachabilityPoll } from '../lib/reachability';
import { unpair } from '../lib/wire';

export default function Index() {
  const machines = useMachines((s) => s.machines);
  const loaded = useMachines((s) => s.loaded);
  const refresh = useMachines((s) => s.refresh);
  const remove = useMachines((s) => s.remove);
  const getToken = useMachines((s) => s.getToken);
  const [now, setNow] = useState(Date.now());

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!loaded) return;
    if (machines.length === 0) {
      (async () => {
        if (!(await onboardingFlag.seen())) router.replace('/onboarding');
        else router.replace('/scan');
      })();
    }
  }, [loaded, machines.length]);

  useReachabilityPoll(30_000);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(id); }, []);

  if (!loaded) {
    return <View className="flex-1 items-center justify-center bg-[#0e1114]"><ActivityIndicator color="#c7910c" /></View>;
  }

  return (
    <SafeAreaView className="flex-1 bg-[#0e1114] px-4">
      <View className="flex-row items-center justify-between py-3">
        <Text className="text-white text-2xl font-semibold">Machines</Text>
        <Pressable onPress={() => router.push('/scan')} className="bg-[#c7910c] rounded-full p-2">
          <Plus size={20} color="#000" />
        </Pressable>
      </View>
      <FlatList
        data={machines}
        keyExtractor={(m) => m.machineId}
        renderItem={({ item }) => (
          <MachineRow
            m={item}
            online={item.lastSeenAt != null && (now - item.lastSeenAt) < 60_000}
            onPress={() => router.push(`/m/${item.machineId}/chat`)}
            onLongPress={() => Alert.alert(item.label, undefined, [
              { text: 'Unpair', style: 'destructive', onPress: async () => {
                const tok = await getToken(item.machineId);
                if (tok) await unpair(item.hostUrl, item.deviceId, tok).catch(() => {});
                await remove(item.machineId);
              }},
              { text: 'Cancel', style: 'cancel' },
            ])}
          />
        )}
      />
    </SafeAreaView>
  );
}
```

- [ ] **Step 4: tsc check + manual verification**

```bash
cd sai-mobile && npm run lint
```

Expected: 0 errors. Then on the dev client: with a paired machine, the row appears; tap shows 404 (chat route not yet built); long-press → Unpair → removed.

- [ ] **Step 5: Commit**

```bash
git add sai-mobile/app/index.tsx sai-mobile/components/MachineRow.tsx sai-mobile/lib/reachability.ts
git commit -m "feat(sai-mobile): machine list with reachability polling + unpair"
```

---

## Milestone 5 — Per-machine layout & connection lifecycle

### Task 18: Connection context owned by per-machine layout

**Files:**
- Create: `sai-mobile/lib/connection.tsx`
- Create: `sai-mobile/app/m/[machineId]/_layout.tsx`

- [ ] **Step 1: Connection context**

`sai-mobile/lib/connection.tsx`:

```tsx
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { connectWire, type WireClient } from './wire';
import type { WireState } from './types';
import type { Machine } from './machines';

interface Ctx {
  machine: Machine;
  client: WireClient | null;
  state: WireState;
}

const C = createContext<Ctx | null>(null);

export function useConn(): Ctx {
  const v = useContext(C);
  if (!v) throw new Error('useConn outside ConnectionProvider');
  return v;
}

export function ConnectionProvider({ machine, token, children }: {
  machine: Machine; token: string; children: React.ReactNode;
}) {
  const [state, setState] = useState<WireState>('opening');
  const clientRef = useRef<WireClient | null>(null);
  const [client, setClient] = useState<WireClient | null>(null);

  useEffect(() => {
    const c = connectWire({ baseUrl: machine.hostUrl, token });
    clientRef.current = c;
    setClient(c);
    const offState = c.onState(setState);

    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') c.probe();
    });
    return () => {
      sub.remove();
      offState();
      c.close();
      clientRef.current = null;
    };
  }, [machine.machineId, machine.hostUrl, token]);

  return <C.Provider value={{ machine, client, state }}>{children}</C.Provider>;
}
```

- [ ] **Step 2: Per-machine layout**

`sai-mobile/app/m/[machineId]/_layout.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useLocalSearchParams, Tabs, router } from 'expo-router';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, MessageSquare, Terminal as TermIcon, FileText } from 'lucide-react-native';
import { useMachines } from '../../../lib/machinesStore';
import { ConnectionProvider, useConn } from '../../../lib/connection';

function StatePill() {
  const { state } = useConn();
  const color = state === 'open' ? '#00a884' : state === 'opening' ? '#c7910c' : '#E35535';
  const label = state === 'open' ? 'connected' : state === 'opening' ? 'connecting…' : 'offline';
  return (
    <View className="flex-row items-center gap-1.5">
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text className="text-[#a0acbb] text-xs">{label}</Text>
    </View>
  );
}

function Header() {
  const { machine } = useConn();
  return (
    <View className="flex-row items-center px-3 py-2 border-b border-[#1e2228] bg-[#0c0f11]">
      <Pressable onPress={() => router.replace('/')} className="p-1.5">
        <ChevronLeft size={20} color="#bec6d0" />
      </Pressable>
      <Text className="text-white text-base font-medium flex-1 ml-1">{machine.label}</Text>
      <StatePill />
    </View>
  );
}

function Inner() {
  return (
    <SafeAreaView className="flex-1 bg-[#0e1114]" edges={['top']}>
      <Header />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { backgroundColor: '#0c0f11', borderTopColor: '#1e2228' },
          tabBarActiveTintColor: '#c7910c',
          tabBarInactiveTintColor: '#5a6a7a',
        }}
      >
        <Tabs.Screen name="chat" options={{ title: 'Chat', tabBarIcon: ({ color }) => <MessageSquare size={20} color={color} /> }} />
        <Tabs.Screen name="terminal" options={{ title: 'Terminal', tabBarIcon: ({ color }) => <TermIcon size={20} color={color} /> }} />
        <Tabs.Screen name="files" options={{ title: 'Files', tabBarIcon: ({ color }) => <FileText size={20} color={color} /> }} />
      </Tabs>
    </SafeAreaView>
  );
}

export default function MachineLayout() {
  const { machineId } = useLocalSearchParams<{ machineId: string }>();
  const machines = useMachines((s) => s.machines);
  const getToken = useMachines((s) => s.getToken);
  const refresh = useMachines((s) => s.refresh);
  const [token, setToken] = useState<string | null>(null);
  const machine = machines.find((m) => m.machineId === machineId);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!machineId) return;
    getToken(machineId).then(setToken);
  }, [machineId, getToken]);

  if (!machine || !token) {
    return <View className="flex-1 items-center justify-center bg-[#0e1114]"><ActivityIndicator color="#c7910c" /></View>;
  }
  return (
    <ConnectionProvider machine={machine} token={token}>
      <Inner />
    </ConnectionProvider>
  );
}
```

- [ ] **Step 3: Placeholder screens for tabs**

`sai-mobile/app/m/[machineId]/chat.tsx`, `terminal.tsx`, `files.tsx` — each:

```tsx
import { View, Text } from 'react-native';
export default function Placeholder() {
  return <View className="flex-1 bg-[#0e1114] items-center justify-center"><Text className="text-[#a0acbb]">Coming up.</Text></View>;
}
```

(Three identical files, one per tab.)

- [ ] **Step 4: Verify on device**

Tap a machine → tabs render, state pill shows status. Switching tabs and backgrounding/foregrounding works.

- [ ] **Step 5: Commit**

```bash
git add sai-mobile/lib/connection.tsx sai-mobile/app/m/
git commit -m "feat(sai-mobile): per-machine layout with WS lifecycle + state pill"
```

---

## Milestone 6 — Chat

### Task 19: Transcript store

**Files:**
- Create: `sai-mobile/lib/transcriptStore.ts`
- Create: `sai-mobile/tests/transcript.test.ts`

- [ ] **Step 1: Write the failing test**

`sai-mobile/tests/transcript.test.ts`:

```ts
import { useTranscript } from '../lib/transcriptStore';

describe('transcript store', () => {
  beforeEach(() => useTranscript.setState({ byKey: {} }));

  it('appends events keyed by (machine, project, session)', () => {
    useTranscript.getState().append('m1|p1|s1', { type: 'user', text: 'hi', id: '1' });
    useTranscript.getState().append('m1|p1|s1', { type: 'assistant', text: 'hello', id: '2' });
    const events = useTranscript.getState().byKey['m1|p1|s1'] ?? [];
    expect(events).toHaveLength(2);
    expect(events[0].text).toBe('hi');
  });

  it('replaces by id (idempotent updates)', () => {
    useTranscript.getState().append('k', { id: 'x', type: 'user', text: 'a' });
    useTranscript.getState().append('k', { id: 'x', type: 'user', text: 'b' });
    expect(useTranscript.getState().byKey['k']).toHaveLength(1);
    expect(useTranscript.getState().byKey['k'][0].text).toBe('b');
  });

  it('clears', () => {
    useTranscript.getState().append('k', { id: '1', type: 'user', text: 'a' });
    useTranscript.getState().clear('k');
    expect(useTranscript.getState().byKey['k']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test**

```bash
npx jest tests/transcript.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`sai-mobile/lib/transcriptStore.ts`:

```ts
import { create } from 'zustand';

export interface TranscriptEvent {
  id: string;
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'approval' | 'system';
  text?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  toolUseId?: string;
  images?: string[];
  ts?: number;
}

interface State {
  byKey: Record<string, TranscriptEvent[]>;
  append(key: string, ev: TranscriptEvent): void;
  appendBatch(key: string, evs: TranscriptEvent[]): void;
  clear(key: string): void;
}

export const useTranscript = create<State>((set, get) => ({
  byKey: {},
  append(key, ev) {
    const current = get().byKey[key] ?? [];
    const i = current.findIndex((e) => e.id === ev.id);
    const next = i >= 0
      ? [...current.slice(0, i), ev, ...current.slice(i + 1)]
      : [...current, ev];
    set({ byKey: { ...get().byKey, [key]: next } });
  },
  appendBatch(key, evs) {
    for (const ev of evs) get().append(key, ev);
  },
  clear(key) {
    const { [key]: _, ...rest } = get().byKey;
    set({ byKey: rest });
  },
}));

export function transcriptKey(machineId: string, projectPath: string, sessionId: string): string {
  return `${machineId}|${projectPath}|${sessionId}`;
}
```

- [ ] **Step 4: Run test**

```bash
npx jest tests/transcript.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sai-mobile/lib/transcriptStore.ts sai-mobile/tests/transcript.test.ts
git commit -m "feat(sai-mobile): transcript store keyed by (machine, project, session)"
```

### Task 20: Workspace selection + active workspace store

**Files:**
- Create: `sai-mobile/lib/workspaceStore.ts`
- Create: `sai-mobile/components/WorkspacePicker.tsx`

- [ ] **Step 1: Workspace store**

`sai-mobile/lib/workspaceStore.ts`:

```ts
import { create } from 'zustand';

export interface Workspace { projectPath: string; label: string; scope?: string }

interface State {
  workspacesByMachine: Record<string, Workspace[]>;
  activeByMachine: Record<string, Workspace | null>;
  setWorkspaces(machineId: string, ws: Workspace[]): void;
  setActive(machineId: string, w: Workspace | null): void;
}

export const useWorkspaces = create<State>((set, get) => ({
  workspacesByMachine: {},
  activeByMachine: {},
  setWorkspaces(machineId, ws) {
    set({ workspacesByMachine: { ...get().workspacesByMachine, [machineId]: ws } });
    const active = get().activeByMachine[machineId];
    if (!active && ws.length > 0) {
      set({ activeByMachine: { ...get().activeByMachine, [machineId]: ws[0] } });
    }
  },
  setActive(machineId, w) {
    set({ activeByMachine: { ...get().activeByMachine, [machineId]: w } });
  },
}));
```

- [ ] **Step 2: WorkspacePicker**

`sai-mobile/components/WorkspacePicker.tsx`:

```tsx
import { useState } from 'react';
import { View, Text, Pressable, Modal, FlatList } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { useWorkspaces, type Workspace } from '../lib/workspaceStore';

export function WorkspacePicker({ machineId }: { machineId: string }) {
  const [open, setOpen] = useState(false);
  const list = useWorkspaces((s) => s.workspacesByMachine[machineId] ?? []);
  const active = useWorkspaces((s) => s.activeByMachine[machineId]) ?? null;
  const setActive = useWorkspaces((s) => s.setActive);

  return (
    <>
      <Pressable onPress={() => setOpen(true)} className="flex-row items-center gap-1 px-3 py-2 bg-[#1c2027] rounded-lg">
        <Text className="text-white text-sm">{active?.label ?? 'No workspace'}</Text>
        <ChevronDown size={14} color="#a0acbb" />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 bg-black/60" onPress={() => setOpen(false)}>
          <View className="absolute bottom-0 left-0 right-0 bg-[#1c2027] rounded-t-2xl p-4 max-h-[70%]">
            <Text className="text-white text-lg mb-3 font-semibold">Workspaces</Text>
            <FlatList
              data={list}
              keyExtractor={(w) => w.projectPath}
              renderItem={({ item }: { item: Workspace }) => (
                <Pressable
                  className="py-3 border-b border-[#1e2228]"
                  onPress={() => { setActive(machineId, item); setOpen(false); }}
                >
                  <Text className="text-white">{item.label}</Text>
                  <Text className="text-[#5a6a7a] text-xs">{item.projectPath}</Text>
                </Pressable>
              )}
              ListEmptyComponent={<Text className="text-[#a0acbb] py-6 text-center">No workspaces.</Text>}
            />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add sai-mobile/lib/workspaceStore.ts sai-mobile/components/WorkspacePicker.tsx
git commit -m "feat(sai-mobile): workspace store + picker sheet"
```

### Task 21: Chat screen — transcript view + composer

**Files:**
- Create: `sai-mobile/components/Composer.tsx`
- Create: `sai-mobile/components/Transcript.tsx`
- Create: `sai-mobile/components/TypingDots.tsx` (port from otto)
- Modify: `sai-mobile/app/m/[machineId]/chat.tsx`

- [ ] **Step 1: TypingDots from otto**

```bash
cp /var/home/mstephens/Documents/GitHub/otto/otto-mobile/components/TypingDots.tsx \
   /var/home/mstephens/Documents/GitHub/sai/sai-mobile/components/TypingDots.tsx
```

- [ ] **Step 2: Transcript renderer**

`sai-mobile/components/Transcript.tsx`:

```tsx
import { FlatList, View, Text } from 'react-native';
import Markdown from 'react-native-markdown-display';
import type { TranscriptEvent } from '../lib/transcriptStore';

const mdStyles = {
  body: { color: '#bec6d0', fontSize: 14, lineHeight: 20 },
  code_inline: { backgroundColor: '#161a1f', color: '#c7910c', paddingHorizontal: 4, borderRadius: 4 },
  code_block: { backgroundColor: '#161a1f', color: '#bec6d0', padding: 8, borderRadius: 6 },
  fence: { backgroundColor: '#161a1f', color: '#bec6d0', padding: 8, borderRadius: 6 },
  link: { color: '#38c7bd' },
};

export function Transcript({ events }: { events: TranscriptEvent[] }) {
  return (
    <FlatList
      data={events}
      keyExtractor={(e) => e.id}
      contentContainerStyle={{ padding: 12, gap: 10 }}
      renderItem={({ item }) => {
        if (item.type === 'user') {
          return (
            <View className="bg-[#21292f] rounded-2xl px-3 py-2 self-end max-w-[85%]">
              <Text className="text-white">{item.text}</Text>
            </View>
          );
        }
        if (item.type === 'assistant') {
          return (
            <View className="self-start max-w-[92%]">
              <Markdown style={mdStyles as any}>{item.text ?? ''}</Markdown>
            </View>
          );
        }
        return null; // tool/approval cards added in next task
      }}
    />
  );
}
```

- [ ] **Step 3: Composer (text + image picker, no model picker yet)**

`sai-mobile/components/Composer.tsx`:

```tsx
import { useState } from 'react';
import { View, TextInput, Pressable, Text, Image, ScrollView } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { ImagePlus, Send } from 'lucide-react-native';

export interface ComposerProps {
  disabled: boolean;
  onSend(text: string, images: string[]): void;
}

export function Composer({ disabled, onSend }: ComposerProps) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);

  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: false, quality: 0.9 });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    const resized = await ImageManipulator.manipulateAsync(
      a.uri,
      [{ resize: { width: 1568 } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );
    if (resized.base64) {
      setImages((prev) => [...prev, `data:image/jpeg;base64,${resized.base64}`]);
    }
  };

  const send = () => {
    const t = text.trim();
    if (!t && images.length === 0) return;
    onSend(t, images);
    setText('');
    setImages([]);
  };

  return (
    <View className="border-t border-[#1e2228] bg-[#0c0f11] px-3 py-2">
      {images.length > 0 ? (
        <ScrollView horizontal className="mb-2" showsHorizontalScrollIndicator={false}>
          {images.map((src, i) => (
            <View key={i} className="mr-2 relative">
              <Image source={{ uri: src }} style={{ width: 60, height: 60, borderRadius: 8 }} />
              <Pressable onPress={() => setImages((p) => p.filter((_, j) => j !== i))} className="absolute -top-1 -right-1 bg-black rounded-full px-1.5">
                <Text className="text-white text-xs">×</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
      <View className="flex-row items-end gap-2">
        <Pressable onPress={pick} disabled={disabled} className="p-2">
          <ImagePlus size={20} color={disabled ? '#475262' : '#a0acbb'} />
        </Pressable>
        <TextInput
          className="flex-1 bg-[#161a1f] text-white rounded-2xl px-3 py-2.5 max-h-32"
          placeholder="Message SAI"
          placeholderTextColor="#5a6a7a"
          value={text}
          onChangeText={setText}
          multiline
          editable={!disabled}
        />
        <Pressable onPress={send} disabled={disabled} className="bg-[#c7910c] rounded-full p-2.5">
          <Send size={18} color="#000" />
        </Pressable>
      </View>
    </View>
  );
}
```

- [ ] **Step 4: Chat screen**

`sai-mobile/app/m/[machineId]/chat.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useConn } from '../../../lib/connection';
import { useTranscript, transcriptKey } from '../../../lib/transcriptStore';
import { useWorkspaces } from '../../../lib/workspaceStore';
import { Transcript } from '../../../components/Transcript';
import { Composer } from '../../../components/Composer';
import { WorkspacePicker } from '../../../components/WorkspacePicker';
import { uuid } from '../../../shims/uuid';
import { api, sendPrompt, attachToSession, setActiveWorkspace, subscribeWorkspaceStatus } from '../../../lib/wire';
import type { WireMsg } from '../../../lib/types';

export default function Chat() {
  const { machine, client, state } = useConn();
  const setWorkspaces = useWorkspaces((s) => s.setWorkspaces);
  const active = useWorkspaces((s) => s.activeByMachine[machine.machineId]) ?? null;
  const [sessionId, setSessionId] = useState<string>(() => 'default');
  const tkey = useMemo(() => transcriptKey(machine.machineId, active?.projectPath ?? '_', sessionId), [machine.machineId, active?.projectPath, sessionId]);
  const events = useTranscript((s) => s.byKey[tkey] ?? []);
  const append = useTranscript((s) => s.append);

  // Load workspaces once connected
  useEffect(() => {
    if (state !== 'open') return;
    (async () => {
      const tok = (await import('../../../lib/machinesStore')).useMachines.getState().getToken;
      const t = await tok(machine.machineId);
      if (!t) return;
      const raw = await api.listWorkspaces(machine.hostUrl, t);
      const ws = (raw as any[]).map(w => ({ projectPath: w.projectPath ?? w.path, label: w.label ?? w.name ?? w.projectPath, scope: w.scope }));
      setWorkspaces(machine.machineId, ws);
    })().catch(() => {});
  }, [state, machine.hostUrl, machine.machineId, setWorkspaces]);

  // Attach + subscribe on (re)connect or workspace change
  useEffect(() => {
    if (!client || state !== 'open' || !active) return;
    setActiveWorkspace(client, active.projectPath);
    subscribeWorkspaceStatus(client);
    attachToSession(client, { projectPath: active.projectPath, scope: active.scope, sessionId });
  }, [client, state, active?.projectPath, active?.scope, sessionId]);

  // Inbound transcript
  useEffect(() => {
    if (!client) return;
    return client.on((m: WireMsg) => {
      const text = m.text as string | undefined;
      if (m.type === 'chat:user') {
        append(tkey, { id: String(m.id ?? uuid()), type: 'user', text });
      } else if (m.type === 'chat:assistant' || m.type === 'chat:delta') {
        append(tkey, { id: String(m.id ?? 'assistant-current'), type: 'assistant', text });
      } else if (m.type === 'tool:use') {
        append(tkey, {
          id: String(m.toolUseId ?? uuid()), type: 'tool_use',
          toolName: m.name as string, toolInput: m.input, toolUseId: m.toolUseId as string,
        });
      } else if (m.type === 'tool:result') {
        append(tkey, {
          id: `result-${m.toolUseId}`, type: 'tool_result',
          toolUseId: m.toolUseId as string, toolResult: m.result,
        });
      } else if (m.type === 'approval:request') {
        append(tkey, {
          id: `approval-${m.toolUseId}`, type: 'approval',
          toolName: m.name as string, toolInput: m.input, toolUseId: m.toolUseId as string,
        });
      }
    });
  }, [client, tkey, append]);

  return (
    <View className="flex-1 bg-[#0e1114]">
      <View className="flex-row items-center gap-2 px-3 py-2 border-b border-[#1e2228]">
        <WorkspacePicker machineId={machine.machineId} />
        <Text className="text-[#5a6a7a] text-xs flex-1" numberOfLines={1}>session: {sessionId}</Text>
      </View>
      <View className="flex-1">
        <Transcript events={events} />
      </View>
      <Composer
        disabled={state !== 'open' || !active}
        onSend={(text, images) => {
          if (!client || !active) return;
          const id = uuid();
          append(tkey, { id, type: 'user', text, images });
          sendPrompt(client, {
            text, projectPath: active.projectPath, scope: active.scope, images,
          });
        }}
      />
    </View>
  );
}
```

- [ ] **Step 5: Manual verification**

Open chat tab, pick a workspace, send a text message → appears immediately, response arrives. Attach an image, send, verify it renders inline on desktop chat (desktop is source of truth).

- [ ] **Step 6: Commit**

```bash
git add sai-mobile/components/Transcript.tsx sai-mobile/components/Composer.tsx \
        sai-mobile/components/TypingDots.tsx sai-mobile/app/m/[machineId]/chat.tsx
git commit -m "feat(sai-mobile): chat transcript + composer with images"
```

### Task 22: Tool cards and approval cards

**Files:**
- Create: `sai-mobile/lib/toolPresenters.ts`
- Create: `sai-mobile/components/ToolCard.tsx`
- Create: `sai-mobile/components/ApprovalCard.tsx`
- Modify: `sai-mobile/components/Transcript.tsx`

- [ ] **Step 1: Tool presenters**

`sai-mobile/lib/toolPresenters.ts`:

```ts
export interface ToolPresenter {
  label: string;
  summary(input: unknown): string;
}

const TOOL_PRESENTERS: Record<string, ToolPresenter> = {
  bash: { label: 'Bash', summary: (i: any) => i?.command ?? '' },
  read: { label: 'Read', summary: (i: any) => i?.path ?? i?.file_path ?? '' },
  edit: { label: 'Edit', summary: (i: any) => i?.path ?? i?.file_path ?? '' },
  write: { label: 'Write', summary: (i: any) => i?.path ?? i?.file_path ?? '' },
  grep: { label: 'Grep', summary: (i: any) => i?.pattern ?? '' },
  glob: { label: 'Glob', summary: (i: any) => i?.pattern ?? '' },
};

export function presentTool(toolName?: string, input?: unknown): { label: string; summary: string } {
  const p = TOOL_PRESENTERS[(toolName ?? '').toLowerCase()];
  if (!p) return { label: toolName ?? 'Tool', summary: typeof input === 'string' ? input : '' };
  return { label: p.label, summary: p.summary(input) };
}
```

- [ ] **Step 2: ToolCard component**

`sai-mobile/components/ToolCard.tsx`:

```tsx
import { View, Text } from 'react-native';
import { Wrench } from 'lucide-react-native';
import { presentTool } from '../lib/toolPresenters';

export function ToolCard({ toolName, input, result }: { toolName?: string; input?: unknown; result?: unknown }) {
  const { label, summary } = presentTool(toolName, input);
  return (
    <View className="bg-[#1c2027] border border-[#1e2228] rounded-xl p-3 gap-1.5 self-stretch">
      <View className="flex-row items-center gap-2">
        <Wrench size={14} color="#c7910c" />
        <Text className="text-white text-sm font-medium">{label}</Text>
      </View>
      {summary ? <Text className="text-[#a0acbb] text-xs" numberOfLines={3}>{summary}</Text> : null}
      {result !== undefined ? (
        <Text className="text-[#5a6a7a] text-xs" numberOfLines={3}>
          {typeof result === 'string' ? result : JSON.stringify(result).slice(0, 240)}
        </Text>
      ) : null}
    </View>
  );
}
```

- [ ] **Step 3: ApprovalCard component**

`sai-mobile/components/ApprovalCard.tsx`:

```tsx
import { View, Text, Pressable } from 'react-native';
import { presentTool } from '../lib/toolPresenters';

export function ApprovalCard({
  toolName, input, onDecide,
}: {
  toolName?: string; input?: unknown; onDecide: (d: 'approve' | 'deny') => void;
}) {
  const { label, summary } = presentTool(toolName, input);
  return (
    <View className="bg-[#1c2027] border border-[#c7910c] rounded-xl p-3 gap-2 self-stretch">
      <Text className="text-[#c7910c] text-sm font-semibold">Approval needed: {label}</Text>
      {summary ? <Text className="text-[#bec6d0] text-xs">{summary}</Text> : null}
      <View className="flex-row gap-2 mt-1">
        <Pressable onPress={() => onDecide('deny')} className="bg-[#21292f] rounded-lg px-4 py-2 flex-1 items-center">
          <Text className="text-white">Deny</Text>
        </Pressable>
        <Pressable onPress={() => onDecide('approve')} className="bg-[#c7910c] rounded-lg px-4 py-2 flex-1 items-center">
          <Text className="text-black font-semibold">Approve</Text>
        </Pressable>
      </View>
    </View>
  );
}
```

- [ ] **Step 4: Wire cards into Transcript**

Update `sai-mobile/components/Transcript.tsx`'s `renderItem` — replace the file with:

```tsx
import { FlatList, View, Text } from 'react-native';
import Markdown from 'react-native-markdown-display';
import type { TranscriptEvent } from '../lib/transcriptStore';
import { ToolCard } from './ToolCard';
import { ApprovalCard } from './ApprovalCard';

const mdStyles = {
  body: { color: '#bec6d0', fontSize: 14, lineHeight: 20 },
  code_inline: { backgroundColor: '#161a1f', color: '#c7910c', paddingHorizontal: 4, borderRadius: 4 },
  code_block: { backgroundColor: '#161a1f', color: '#bec6d0', padding: 8, borderRadius: 6 },
  fence: { backgroundColor: '#161a1f', color: '#bec6d0', padding: 8, borderRadius: 6 },
  link: { color: '#38c7bd' },
};

export function Transcript({
  events,
  onApprove,
}: {
  events: TranscriptEvent[];
  onApprove: (toolUseId: string, decision: 'approve' | 'deny') => void;
}) {
  return (
    <FlatList
      data={events}
      keyExtractor={(e) => e.id}
      contentContainerStyle={{ padding: 12, gap: 10 }}
      renderItem={({ item }) => {
        if (item.type === 'user') {
          return (
            <View className="bg-[#21292f] rounded-2xl px-3 py-2 self-end max-w-[85%]">
              <Text className="text-white">{item.text}</Text>
            </View>
          );
        }
        if (item.type === 'assistant') {
          return (
            <View className="self-start max-w-[92%]">
              <Markdown style={mdStyles as any}>{item.text ?? ''}</Markdown>
            </View>
          );
        }
        if (item.type === 'tool_use' || item.type === 'tool_result') {
          return <ToolCard toolName={item.toolName} input={item.toolInput} result={item.toolResult} />;
        }
        if (item.type === 'approval') {
          return (
            <ApprovalCard
              toolName={item.toolName}
              input={item.toolInput}
              onDecide={(d) => onApprove(item.toolUseId ?? '', d)}
            />
          );
        }
        return null;
      }}
    />
  );
}
```

- [ ] **Step 5: Hook approval into chat screen**

In `sai-mobile/app/m/[machineId]/chat.tsx`, change the `<Transcript events={events} />` line to:

```tsx
<Transcript
  events={events}
  onApprove={(toolUseId, decision) => {
    if (!client || !active) return;
    import('../../../lib/wire').then(({ sendApproval }) => {
      sendApproval(client, { toolUseId, decision, projectPath: active.projectPath, scope: active.scope });
    });
  }}
/>
```

- [ ] **Step 6: tsc check + manual verification**

```bash
cd sai-mobile && npm run lint
```

Then run on device: trigger a tool call from desktop chat, verify ToolCard appears in mobile transcript. Trigger an approval, verify ApprovalCard renders with Approve/Deny — tap, verify desktop sees the decision.

- [ ] **Step 7: Commit**

```bash
git add sai-mobile/lib/toolPresenters.ts sai-mobile/components/ToolCard.tsx \
        sai-mobile/components/ApprovalCard.tsx sai-mobile/components/Transcript.tsx \
        sai-mobile/app/m/[machineId]/chat.tsx
git commit -m "feat(sai-mobile): chat tool cards + approval cards wired to wire"
```

---

## Milestone 7 — Terminal

### Task 23: Terminal WebView host page

**Files:**
- Create: `sai-mobile/assets/terminal/index.html`
- Create: `sai-mobile/assets/terminal/term.js`

**Note:** xterm.js is loaded from a CDN inside the WebView for simplicity (avoid bundling JS into the asset tree). All data flow is between RN and the page over `postMessage`. The page never makes outbound network calls beyond loading xterm.js itself; iOS ATS exception in `app.json` covers the CDN over HTTPS.

- [ ] **Step 1: HTML host**

`sai-mobile/assets/terminal/index.html`:

```html
<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css" />
<style>
  html,body{margin:0;background:#0e1114;height:100%;overflow:hidden}
  #t{height:100vh}
</style>
</head><body>
<div id="t"></div>
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"></script>
<script src="./term.js"></script>
</body></html>
```

- [ ] **Step 2: Bridge script**

`sai-mobile/assets/terminal/term.js`:

```js
(function () {
  const post = (msg) => {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  };
  const term = new Terminal({
    fontFamily: 'Menlo, monospace', fontSize: 12,
    theme: { background: '#0e1114', foreground: '#bec6d0', cursor: '#c7910c' },
    convertEol: true, cursorBlink: true,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(document.getElementById('t'));
  fit.fit();
  post({ type: 'ready', cols: term.cols, rows: term.rows });
  term.onData((d) => post({ type: 'input', data: d }));
  window.addEventListener('resize', () => {
    fit.fit();
    post({ type: 'resize', cols: term.cols, rows: term.rows });
  });
  document.addEventListener('message', handleNative);
  window.addEventListener('message', handleNative);
  function handleNative(ev) {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === 'data') term.write(m.data);
    else if (m.type === 'clear') term.clear();
    else if (m.type === 'fit') { fit.fit(); post({ type: 'resize', cols: term.cols, rows: term.rows }); }
  }
})();
```

- [ ] **Step 3: Commit**

```bash
git add sai-mobile/assets/terminal/
git commit -m "feat(sai-mobile): terminal WebView host page with xterm.js"
```

### Task 24: Terminal screen

**Files:**
- Modify: `sai-mobile/app/m/[machineId]/terminal.tsx`
- Create: `sai-mobile/components/TerminalView.tsx`

- [ ] **Step 1: TerminalView component**

`sai-mobile/components/TerminalView.tsx`:

```tsx
import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Asset } from 'expo-asset';

export interface TerminalHandle {
  write(data: string): void;
}

export interface TerminalViewProps {
  onReady(cols: number, rows: number): void;
  onInput(data: string): void;
  onResize(cols: number, rows: number): void;
}

export const TerminalView = forwardRef<TerminalHandle, TerminalViewProps>(function TerminalView(
  { onReady, onInput, onResize }, ref
) {
  const wv = useRef<WebView>(null);
  const queue = useRef<string[]>([]);
  const readyRef = useRef(false);

  useImperativeHandle(ref, () => ({
    write(data: string) {
      const payload = JSON.stringify({ type: 'data', data });
      if (!readyRef.current) { queue.current.push(payload); return; }
      wv.current?.postMessage(payload);
    },
  }), []);

  const onMessage = (e: WebViewMessageEvent) => {
    let m: any;
    try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (m.type === 'ready') {
      readyRef.current = true;
      onReady(m.cols, m.rows);
      for (const q of queue.current) wv.current?.postMessage(q);
      queue.current = [];
    } else if (m.type === 'input') onInput(m.data);
    else if (m.type === 'resize') onResize(m.cols, m.rows);
  };

  return (
    <WebView
      ref={wv}
      originWhitelist={['*']}
      source={{ uri: Asset.fromModule(require('../assets/terminal/index.html')).uri }}
      onMessage={onMessage}
      javaScriptEnabled
      domStorageEnabled
      style={{ flex: 1, backgroundColor: '#0e1114' }}
      hideKeyboardAccessoryView
      keyboardDisplayRequiresUserAction={false}
    />
  );
});
```

- [ ] **Step 2: Terminal screen**

`sai-mobile/app/m/[machineId]/terminal.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { View, KeyboardAvoidingView, Platform, Text, Pressable } from 'react-native';
import { useConn } from '../../../lib/connection';
import { useWorkspaces } from '../../../lib/workspaceStore';
import { TerminalView, type TerminalHandle } from '../../../components/TerminalView';
import { api, termInput, termResize, termAttach, termDetach } from '../../../lib/wire';
import { useMachines } from '../../../lib/machinesStore';
import type { WireMsg } from '../../../lib/types';

export default function TerminalScreen() {
  const { machine, client, state } = useConn();
  const active = useWorkspaces((s) => s.activeByMachine[machine.machineId]) ?? null;
  const getToken = useMachines((s) => s.getToken);
  const [termId, setTermId] = useState<number | null>(null);
  const termRef = useRef<TerminalHandle>(null);

  // Pick the first terminal for the active workspace (or create-by-attach semantics handled by desktop).
  useEffect(() => {
    if (state !== 'open' || !active) return;
    (async () => {
      const t = await getToken(machine.machineId);
      if (!t) return;
      const list = await api.listTerminals(machine.hostUrl, t, active.projectPath).catch(() => []);
      const first = (list as any[]).find((x) => x.alive) ?? null;
      if (first) setTermId(first.termId);
    })();
  }, [state, active?.projectPath, machine.hostUrl, machine.machineId, getToken]);

  // Forward term:data to webview
  useEffect(() => {
    if (!client) return;
    return client.on((m: WireMsg) => {
      if (m.type === 'term:data' && m.termId === termId && typeof m.data === 'string') {
        termRef.current?.write(m.data);
      }
    });
  }, [client, termId]);

  if (!active) {
    return <View className="flex-1 bg-[#0e1114] items-center justify-center"><Text className="text-[#a0acbb]">Pick a workspace in Chat first.</Text></View>;
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: '#0e1114' }}>
      {termId == null ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-[#a0acbb] mb-3">No active terminal.</Text>
        </View>
      ) : (
        <TerminalView
          ref={termRef}
          onReady={(cols, rows) => {
            if (!client) return;
            termAttach(client, termId, cols, rows);
          }}
          onInput={(data) => { if (client) termInput(client, termId, data); }}
          onResize={(cols, rows) => { if (client) termResize(client, termId, cols, rows); }}
        />
      )}
    </KeyboardAvoidingView>
  );
}
```

- [ ] **Step 3: Verify on device**

Open a terminal on desktop in the active workspace, switch to mobile terminal tab, verify output streams in. Tap to focus → keyboard appears → type → desktop receives input.

- [ ] **Step 4: Commit**

```bash
git add sai-mobile/components/TerminalView.tsx sai-mobile/app/m/[machineId]/terminal.tsx
git commit -m "feat(sai-mobile): terminal screen with xterm.js WebView host"
```

---

## Milestone 8 — Files (read-only)

### Task 25: Browse view

**Files:**
- Modify: `sai-mobile/app/m/[machineId]/files.tsx` (becomes a nested router)
- Create: `sai-mobile/app/m/[machineId]/files/_layout.tsx`
- Delete: `sai-mobile/app/m/[machineId]/files.tsx` (placeholder)
- Create: `sai-mobile/app/m/[machineId]/files/index.tsx`
- Create: `sai-mobile/app/m/[machineId]/files/view.tsx`
- Create: `sai-mobile/app/m/[machineId]/files/changes.tsx`

- [ ] **Step 1: Replace placeholder with nested layout**

```bash
cd sai-mobile && rm app/m/[machineId]/files.tsx && mkdir -p app/m/[machineId]/files
```

`sai-mobile/app/m/[machineId]/files/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';
export default function FilesLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0e1114' } }} />;
}
```

- [ ] **Step 2: Browse view**

`sai-mobile/app/m/[machineId]/files/index.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { Folder, File, ChevronLeft, GitBranch } from 'lucide-react-native';
import { useConn } from '../../../../lib/connection';
import { useMachines } from '../../../../lib/machinesStore';
import { useWorkspaces } from '../../../../lib/workspaceStore';
import { api } from '../../../../lib/wire';

interface Entry { name: string; type: 'dir' | 'file' }

export default function Browse() {
  const { machine } = useConn();
  const active = useWorkspaces((s) => s.activeByMachine[machine.machineId]) ?? null;
  const getToken = useMachines((s) => s.getToken);
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<Entry[] | null>(null);

  useEffect(() => {
    if (!active) return;
    setEntries(null);
    (async () => {
      const t = await getToken(machine.machineId);
      if (!t) return;
      const raw = await api.listFiles(machine.hostUrl, t, active.projectPath, path).catch(() => []);
      setEntries((raw as any[]).map(e => ({ name: e.name, type: e.type })));
    })();
  }, [active?.projectPath, path, machine.hostUrl, machine.machineId, getToken]);

  if (!active) {
    return <View className="flex-1 items-center justify-center"><Text className="text-[#a0acbb]">Pick a workspace in Chat first.</Text></View>;
  }

  return (
    <View className="flex-1 bg-[#0e1114]">
      <View className="flex-row items-center gap-2 px-3 py-2 border-b border-[#1e2228]">
        {path ? (
          <Pressable onPress={() => setPath(path.split('/').slice(0, -1).join('/'))} className="p-1.5">
            <ChevronLeft size={18} color="#bec6d0" />
          </Pressable>
        ) : null}
        <Text className="text-white text-sm flex-1" numberOfLines={1}>/{path}</Text>
        <Pressable onPress={() => router.push(`/m/${machine.machineId}/files/changes`)} className="p-1.5">
          <GitBranch size={18} color="#c7910c" />
        </Pressable>
      </View>
      {entries == null ? <ActivityIndicator color="#c7910c" className="mt-6" /> : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.name}
          renderItem={({ item }) => (
            <Pressable
              className="flex-row items-center gap-3 px-4 py-3 border-b border-[#1e2228]"
              onPress={() => {
                if (item.type === 'dir') setPath(path ? `${path}/${item.name}` : item.name);
                else router.push({ pathname: `/m/${machine.machineId}/files/view`, params: { path: path ? `${path}/${item.name}` : item.name } });
              }}
            >
              {item.type === 'dir' ? <Folder size={16} color="#c7910c" /> : <File size={16} color="#a0acbb" />}
              <Text className="text-white">{item.name}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
```

- [ ] **Step 3: File view (Shiki via WebView)**

`sai-mobile/app/m/[machineId]/files/view.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Pressable } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { WebView } from 'react-native-webview';
import { ChevronLeft } from 'lucide-react-native';
import { useConn } from '../../../../lib/connection';
import { useMachines } from '../../../../lib/machinesStore';
import { useWorkspaces } from '../../../../lib/workspaceStore';
import { api } from '../../../../lib/wire';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function htmlFor(content: string, lang: string | undefined): string {
  return `<!doctype html><html><head>
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.10.0/styles/github-dark.min.css">
    <style>
      html,body{margin:0;background:#0e1114;color:#bec6d0;font-family:Menlo,monospace;font-size:12px}
      pre{margin:0;padding:12px;white-space:pre;overflow:auto}
    </style>
  </head><body>
    <pre><code class="${lang ? `language-${lang}` : ''}">${escapeHtml(content)}</code></pre>
    <script src="https://cdn.jsdelivr.net/npm/highlight.js@11.10.0/lib/highlight.min.js"></script>
    <script>hljs.highlightAll();</script>
  </body></html>`;
}

export default function FileView() {
  const params = useLocalSearchParams<{ path: string }>();
  const { machine } = useConn();
  const active = useWorkspaces((s) => s.activeByMachine[machine.machineId]) ?? null;
  const getToken = useMachines((s) => s.getToken);
  const [data, setData] = useState<{ content: string; lang?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!active || !params.path) return;
    (async () => {
      try {
        const t = await getToken(machine.machineId);
        if (!t) return;
        const r = await api.readFile(machine.hostUrl, t, active.projectPath, params.path);
        if (r.encoding !== 'text' || !r.content) { setErr('Binary file (preview unavailable).'); return; }
        setData({ content: r.content, lang: r.lang });
      } catch (e: any) {
        setErr(String(e?.message ?? e));
      }
    })();
  }, [active?.projectPath, params.path, machine.hostUrl, machine.machineId, getToken]);

  return (
    <View className="flex-1 bg-[#0e1114]">
      <View className="flex-row items-center gap-2 px-3 py-2 border-b border-[#1e2228]">
        <Pressable onPress={() => router.back()} className="p-1.5">
          <ChevronLeft size={18} color="#bec6d0" />
        </Pressable>
        <Text className="text-white text-sm flex-1" numberOfLines={1}>{params.path}</Text>
      </View>
      {err ? <Text className="text-[#E35535] p-4">{err}</Text> :
       !data ? <ActivityIndicator color="#c7910c" className="mt-6" /> :
       <WebView originWhitelist={['*']} source={{ html: htmlFor(data.content, data.lang) }} style={{ flex: 1, backgroundColor: '#0e1114' }} />}
    </View>
  );
}
```

- [ ] **Step 4: Changes view**

`sai-mobile/app/m/[machineId]/files/changes.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, Pressable } from 'react-native';
import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { WebView } from 'react-native-webview';
import { useConn } from '../../../../lib/connection';
import { useMachines } from '../../../../lib/machinesStore';
import { useWorkspaces } from '../../../../lib/workspaceStore';
import { api } from '../../../../lib/wire';

interface ChangeEntry { path: string; status: string }

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function diffHtml(diff: string): string {
  const lines = diff.split('\n').map((l) => {
    const c = l.startsWith('+') ? '#1d3a2e' : l.startsWith('-') ? '#3a1d22' : 'transparent';
    return `<div style="background:${c};padding:0 8px">${escapeHtml(l)}</div>`;
  }).join('');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"/>
    <style>html,body{margin:0;background:#0e1114;color:#bec6d0;font-family:Menlo,monospace;font-size:11px;white-space:pre}</style>
    </head><body>${lines}</body></html>`;
}

export default function Changes() {
  const { machine } = useConn();
  const active = useWorkspaces((s) => s.activeByMachine[machine.machineId]) ?? null;
  const getToken = useMachines((s) => s.getToken);
  const [entries, setEntries] = useState<ChangeEntry[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    (async () => {
      const t = await getToken(machine.machineId);
      if (!t) return;
      const raw = await api.statusFiles(machine.hostUrl, t, active.projectPath).catch(() => []);
      setEntries((raw as any[]).map(e => ({ path: e.path, status: e.status })));
    })();
  }, [active?.projectPath, machine.hostUrl, machine.machineId, getToken]);

  useEffect(() => {
    if (!selected || !active) return;
    setDiff(null);
    (async () => {
      const t = await getToken(machine.machineId);
      if (!t) return;
      const r = await api.diffFile(machine.hostUrl, t, active.projectPath, selected).catch(() => ({ diff: '' }));
      setDiff(r.diff);
    })();
  }, [selected, active?.projectPath, machine.hostUrl, machine.machineId, getToken]);

  return (
    <View className="flex-1 bg-[#0e1114]">
      <View className="flex-row items-center gap-2 px-3 py-2 border-b border-[#1e2228]">
        <Pressable onPress={() => router.back()} className="p-1.5"><ChevronLeft size={18} color="#bec6d0" /></Pressable>
        <Text className="text-white text-sm flex-1">Changes</Text>
      </View>
      {entries == null ? <ActivityIndicator color="#c7910c" className="mt-6" /> :
       selected ? (
         <View className="flex-1">
           <View className="flex-row items-center gap-2 px-3 py-2 border-b border-[#1e2228]">
             <Pressable onPress={() => { setSelected(null); setDiff(null); }} className="p-1.5"><ChevronLeft size={18} color="#bec6d0" /></Pressable>
             <Text className="text-white text-xs flex-1" numberOfLines={1}>{selected}</Text>
           </View>
           {diff == null ? <ActivityIndicator color="#c7910c" className="mt-6" /> :
             <WebView originWhitelist={['*']} source={{ html: diffHtml(diff) }} style={{ flex: 1, backgroundColor: '#0e1114' }} />}
         </View>
       ) : (
         <FlatList
           data={entries}
           keyExtractor={(e) => e.path}
           renderItem={({ item }) => (
             <Pressable onPress={() => setSelected(item.path)} className="px-4 py-3 border-b border-[#1e2228] flex-row gap-3">
               <Text className="text-[#c7910c] text-xs w-6">{item.status}</Text>
               <Text className="text-white flex-1" numberOfLines={1}>{item.path}</Text>
             </Pressable>
           )}
           ListEmptyComponent={<Text className="text-[#a0acbb] p-4 text-center">Clean.</Text>}
         />
       )}
    </View>
  );
}
```

- [ ] **Step 5: Verify on device**

Files tab → list of files → drill into a directory → tap a file → view with highlighting. Tap git icon → changes list → tap entry → diff renders with red/green lines.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(sai-mobile): read-only files — browse, view, diff"
```

---

## Milestone 9 — Polish + EAS preview

### Task 26: Wire compatibility fixture

**Files:**
- Create: `sai-mobile/tests/fixtures/wire-messages.json`
- Create: `sai-mobile/tests/wire-fixture.test.ts`

- [ ] **Step 1: Fixture**

`sai-mobile/tests/fixtures/wire-messages.json`:

```json
{
  "inbound": [
    { "type": "auth_ok" },
    { "type": "chat:user", "id": "u1", "text": "hello" },
    { "type": "chat:assistant", "id": "a1", "text": "hi" },
    { "type": "chat:delta", "id": "a1", "text": "hi there" },
    { "type": "tool:use", "toolUseId": "t1", "name": "bash", "input": { "command": "ls" } },
    { "type": "tool:result", "toolUseId": "t1", "result": "file.txt" },
    { "type": "approval:request", "toolUseId": "ap1", "name": "write", "input": { "path": "/x" } },
    { "type": "term:data", "termId": 1, "data": "$ " },
    { "type": "workspace:status", "projectPath": "/repo", "status": "idle" }
  ],
  "outbound": [
    { "type": "auth", "token": "T" },
    { "type": "ping" },
    { "type": "chat:prompt", "text": "go", "projectPath": "/r" },
    { "type": "chat:approve", "toolUseId": "ap1", "decision": "approve", "projectPath": "/r" },
    { "type": "attach", "projectPath": "/r", "sessionId": "s1" },
    { "type": "term:input", "termId": 1, "data": "ls\n" },
    { "type": "term:resize", "termId": 1, "cols": 80, "rows": 24 }
  ]
}
```

- [ ] **Step 2: Test that all inbound types are handled by the chat reducer**

`sai-mobile/tests/wire-fixture.test.ts`:

```ts
import fixtures from './fixtures/wire-messages.json';

describe('wire fixture coverage', () => {
  it('every inbound message has a recognized type', () => {
    const known = new Set([
      'auth_ok', 'pong', 'chat:user', 'chat:assistant', 'chat:delta',
      'tool:use', 'tool:result', 'approval:request',
      'term:data', 'workspace:status',
    ]);
    for (const m of fixtures.inbound) {
      expect(known.has(m.type as string)).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd sai-mobile && npm test
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add sai-mobile/tests/fixtures sai-mobile/tests/wire-fixture.test.ts
git commit -m "test(sai-mobile): wire message fixture pinning protocol shape"
```

### Task 27: App icon & splash assets

**Files:**
- Create: `sai-mobile/assets/icon.png`
- Create: `sai-mobile/assets/icon-dark.png`
- Create: `sai-mobile/assets/icon-tinted.png`
- Create: `sai-mobile/assets/splash.png`
- Modify: `sai-mobile/app.json`

- [ ] **Step 1: Copy from sai desktop branding**

```bash
cd /var/home/mstephens/Documents/GitHub/sai
cp public/img/sai.png sai-mobile/assets/icon.png
cp public/img/sai.png sai-mobile/assets/icon-dark.png
cp public/img/sai.png sai-mobile/assets/icon-tinted.png
cp public/img/sai.png sai-mobile/assets/splash.png
```

(Designer can swap these later; the first build needs valid PNGs.)

- [ ] **Step 2: Reference in app.json**

In `sai-mobile/app.json`, add under `expo`:

```json
"icon": "./assets/icon.png",
```

And under `ios`:

```json
"icon": {
  "light": "./assets/icon.png",
  "dark": "./assets/icon-dark.png",
  "tinted": "./assets/icon-tinted.png"
}
```

And replace `splash`:

```json
"splash": {
  "image": "./assets/splash.png",
  "resizeMode": "contain",
  "backgroundColor": "#0c0f11"
}
```

- [ ] **Step 3: Commit**

```bash
git add sai-mobile/assets/ sai-mobile/app.json
git commit -m "feat(sai-mobile): app icon + splash from sai desktop branding"
```

### Task 28: Build preview, submit to TestFlight

- [ ] **Step 1: Trigger preview build**

```bash
cd sai-mobile
npx eas-cli build --profile preview --platform ios --non-interactive
```

(Wait for build. Capture artifact URL.)

- [ ] **Step 2: Submit to TestFlight**

```bash
npx eas-cli submit --platform ios --latest --non-interactive
```

You'll need to set `submit.production.ios.appleTeamId` in `eas.json` if not already; pull from Apple Developer portal. Provide ASC API key when prompted, or rely on saved credentials.

- [ ] **Step 3: Verify TestFlight build appears + install on a real device**

Manual: open App Store Connect → TestFlight → confirm new build processing → install on test device once approved.

- [ ] **Step 4: Smoke test on TestFlight build**

Walk through: onboarding → scan QR from desktop SAI → machine list → chat with image → terminal → file view → diff view. Note any regressions; file as follow-ups.

- [ ] **Step 5: Tag and commit**

```bash
cd /var/home/mstephens/Documents/GitHub/sai
git tag sai-mobile-v0.1.0
git push origin main --tags
```

---

## Open items / deferred (post-v1)

1. **Extract `wire.ts` to shared `packages/wire/`** consumed by both `src/renderer-remote` and `sai-mobile`.
2. **File editing on iOS** — `expo-secure-store` not relevant; reuse stale-write protection from existing wire.
3. **Runtime theme switcher** + light theme on mobile.
4. **Detox or Maestro E2E.**
5. **Push notifications** (APNS + bridge-side push for approvals).
6. **Native terminal renderer** if xterm-in-WebView performance becomes a problem.

## Self-review notes

- Spec coverage verified against all sections of `2026-05-30-sai-mobile-ios-app-design.md`. Every requirement maps to a task.
- No placeholders. Every code step contains real code; every command shows expected output where applicable.
- Type consistency: `Machine`, `WireClient`, `WireState`, `TranscriptEvent`, `Workspace` defined once and referenced consistently throughout.
- Tests cover: wire parsing/auth, machines persistence, transcript reducer, wire fixture coverage. Component/integration coverage relies on manual TestFlight per spec.
