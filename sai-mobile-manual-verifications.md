# sai-mobile manual verification TODOs

These steps were deferred during subagent-driven implementation because they require a physical device. Run them once you have the dev client installed.

## Setup

- [ ] Install dev client on your iOS device via TestFlight or `npx expo run:ios` (Task 8 / 28).
- [ ] Confirm Tailscale is running and logged in on the device.
- [ ] Confirm desktop SAI is running with Mobile Remote enabled.

## Per-task manual checks

- [ ] **Task 8 (root layout)**: Launch app, see dark screen with "SAI Mobile".
- [ ] **Task 15 (onboarding)**: Fresh install → onboarding screen → tap Continue → routes to /scan.
- [ ] **Task 16 (pairing)**: Camera prompt → scan QR from desktop → pairs successfully OR manual paste fallback works.
- [ ] **Task 17 (machine list)**: Paired machines render as rows with online dot; long-press → Unpair removes the machine.
- [ ] **Task 18 (per-machine layout)**: Tap machine → tabs render with state pill (connected). Background app → foreground → reconnects.
- [ ] **Task 21 (chat composer)**: Send text message → arrives in transcript; attach image from library → resized and sent.
- [ ] **Task 22 (tool/approval cards)**: Trigger a tool from desktop → ToolCard renders. Trigger approval → ApprovalCard with Approve/Deny works.
- [ ] **Task 24 (terminal)**: Switch to Terminal tab → existing terminal renders xterm content → keyboard input reaches desktop.
- [ ] **Task 25 (files)**: Browse directory tree → tap file → highlight.js view renders. Tap git icon → changes list → tap entry → diff renders with red/green.
- [ ] **Task 28 (TestFlight smoke)**: Full path on TestFlight build: onboarding → scan → machine list → chat with image → terminal → file view → diff.
