# Mobile Remote

Bridge between the desktop SAI Electron app and a Tailscale-private PWA running on the user's phone. See `docs/superpowers/specs/2026-05-25-mobile-remote-roadmap.md`.

Modules:
- `tailnet.ts` — resolves the Tailscale IP/hostname for this host
- `pairing-store.ts` — argon2id-hashed bearer tokens, single-table sqlite
- `screenshot-urls.ts` — signed single-use URLs for binary payloads
- `session-bus.ts` — output fan-out: subscribeAll + per-topic subscribe + history
- `bridge-server.ts` — HTTP + WS, binds tailnet IP only
- `index.ts` — RemoteModule supervisor

Tests live under `tests/unit/remote/` and `tests/integration/remote/` per SAI's vitest project layout.
