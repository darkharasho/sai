# Mobile Remote Phase 0 — Manual Smoke Checklist

Run this on real hardware (laptop + iPhone) before declaring Phase 0 done.

## Prerequisites

- [ ] Tailscale installed and logged in on both laptop and iPhone
- [ ] iPhone and laptop on the same tailnet (verify with `tailscale status`)
- [ ] SAI built from this branch (`npm run build` succeeded)

## Happy path

- [ ] Launch SAI. Open Settings → Mobile Remote.
- [ ] Status shows `running: false, reason: disabled`. Toggle Enable → status flips to `running`, URL shows `http://<host>.<tailnet>.ts.net:17829`.
- [ ] Click "Pair a new device". QR appears with 120s countdown.
- [ ] On iPhone, open Camera and point at the QR. Safari opens to the bridge URL.
- [ ] PWA shows "Pairing…" briefly then "Paired ✓" with green WS dot.
- [ ] Back on laptop, Settings shows the new device in "Paired devices" with a fresh `last seen`.

## Persistence

- [ ] Quit SAI. Relaunch.
- [ ] On iPhone (PWA still open via Add-to-Home-Screen or browser tab), WS reconnects automatically within ~10s.
- [ ] Settings → Mobile Remote shows the device still paired.

## Revoke

- [ ] In Settings, click Revoke on the device row.
- [ ] iPhone PWA dot flips red, then page transitions to "Re-pair required" within 30s.
- [ ] Re-scanning the same QR (if still valid) fails with 401.

## Failure modes

- [ ] Toggle Tailscale OFF on phone → WS disconnects within ~10s, dot flips red.
- [ ] Toggle Tailscale back on → WS reconnects automatically.
- [ ] On laptop, disable Tailscale → status flips to `reason: tailnet IP not detected`, no URL.

## Add to Home Screen

- [ ] In Safari, Share → Add to Home Screen. App icon appears on iPhone home screen.
- [ ] Tap icon → opens as PWA with no Safari chrome, still paired.
- [ ] Quit SAI, relaunch → home-screen icon still reconnects (proves stable port).

## Network change

- [ ] Move laptop to a different network (e.g. cellular hotspot vs. home wifi). Tailnet IP may change.
- [ ] Within 60s of the change, status URL updates. iPhone PWA reconnects.
