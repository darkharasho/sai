# One-Time Sudo Password for Agent Commands

**Date:** 2026-07-20
**Status:** Approved

## Problem

Agent-run Bash commands execute inside the Claude Code SDK subprocess with no
tty, so any `sudo` invocation either hangs waiting for a password or fails
with "a terminal is required". Otto solved this with a one-time, in-app
password prompt (`otto/src/main/shell/sudo-session.ts`,
`otto/src/main/autonomy/sudo-broker.ts`). This spec ports that design to SAI.

## Requirements (agreed)

- Scope: agent chat/task Bash commands via the SDK backend only. Orchestrator
  sessions, the CLI backend (legacy opt-out), and in-app terminals (which have
  a real pty) are excluded.
- Credential lifetime: app-wide until quit. First sudo prompt anywhere unlocks
  all chats; keep-alive drops the credential if the OS password changes.
- Must work in bypass-mode chats (the user's primary mode).
- Visible lock indicator with a manual re-lock action.
- The password never passes through the model or the SDK stream.

## Key finding

`canUseTool` is not a viable detection point: pre-approved tools skip it, and
the user's global settings allow `Bash(*)` (see the dogfood note in
`electron/services/claudeBackend/sdkOptions.ts`). An SDK **PreToolUse hook**
fires in every permission mode, before permission evaluation, and is the
single gate for both bypass and gated sessions.

## Design

### 1. Core service — `electron/services/sudo/`

Ported from otto nearly verbatim:

- `commandRequiresSudo(command)`: regex matching `sudo` as a command word
  (start of string or after `;`, `|`, `&`, `&&`, `||`, newline, `(`),
  excluding `sudo -n` / `sudo --non-interactive` (those never prompt and must
  fail fast on their own).
- `parseSudoError(stderr)`: maps sudo stderr to short user-facing reasons
  ("Incorrect password", "This user is not permitted to run sudo").
- `SudoSession`: password held in main-process memory only. `unlock(password)`
  validates via `sudo -S -p '' -v` (password on stdin, timestamp-only). On
  success it installs the askpass credential (§2) and starts a 60s keep-alive
  that re-validates and calls `clear()` if the password stops working
  (changed/revoked). `clear()` wipes memory, removes the credential file, and
  stops the timer. App-wide scope: no session keying (divergence from otto,
  which keyed the credential to one session).

All timing/spawn dependencies injected for unit tests, as in otto.

### 2. Askpass for long-lived subprocesses (divergence from otto)

Otto sets `process.env.SUDO_ASKPASS` at unlock time and each command's fresh
child inherits it. SAI's SDK subprocesses are long-lived, so a post-spawn env
change never reaches them. Instead:

- `spawnEnv()` (`electron/services/shellEnv.ts`) always injects
  `SUDO_ASKPASS=<userData>/sudo/askpass.sh` into every SDK subprocess env.
- The helper script is written once at app start (mode `0700`):
  `#!/bin/sh` + `exec cat -- '<userData>/sudo/pw'`.
- Unlock = write `<userData>/sudo/pw` (mode `0600`, first line is the
  password). Lock = delete it.
- While locked the helper fails immediately, so a sudo command errors fast
  instead of hanging (sudo runs the askpass automatically when it has no tty
  and `SUDO_ASKPASS` is set — otto-verified behavior).
- If `spawnEnv()` output also reaches pty spawns (in-app terminals), that is
  harmless: with a real tty, sudo prompts on the tty and ignores askpass.
- The pw file is deleted on: manual lock, keep-alive failure, app quit
  (`will-quit`), and app startup (stale file from a crash).

### 3. Detection + gating — PreToolUse hook

In `buildSdkOptions` (`electron/services/claudeBackend/sdkOptions.ts`), add a
`PreToolUse` hook with a `Bash` matcher next to the existing Stop hook, for
`chat` and `task` kinds only. Hook behavior:

- Not a sudo command, or already unlocked → return `{}` (no decision; normal
  permission flow continues).
- Requires sudo and locked → `await sudoBroker.ensureUnlocked(...)`.
  - Unlocked → return `{}`.
  - Cancelled / timed out / all attempts failed → return a block decision with
    reason: "Sudo elevation was not granted (cancelled, timed out, or wrong
    password). The command was not run."

Concurrent callers coalesce: while one unlock prompt is in flight, other
sessions' `ensureUnlocked` calls await the same promise; only one prompt card
ever shows (divergence from otto's per-session prompts).

### 4. Prompt UI + IPC

`SudoBroker` port in main: emits a `sudo-prompt` event (promptId, scope
identifiers, the command, optional error from the previous attempt) through
the existing backend→renderer event stream; parks a promise keyed by
promptId. 5-minute timeout, 3 attempts. Emits `sudo-resolved`
(unlocked/cancelled/failed) so the card settles.

Renderer: **SudoPromptCard** inline in the blocked chat — masked password
input, the command being elevated, Cancel button, inline error on a failed
attempt. Modeled on otto's `SudoPromptCard`, styled like SAI's ApprovalPanel.
The reply goes renderer→main on a dedicated IPC channel
(`claude:sudoPassword` with `promptId` + password-or-null), straight to the
broker. The password never enters chat history, the SDK stream, or the model.

### 5. Lock indicator

TitleBar chip, visible only while unlocked: lock/shield icon, tooltip "sudo
unlocked — click to lock". Click calls `clear()` immediately. Renderer state
via a broadcast `sudo-state` event (on every unlock/clear) plus a getter IPC
for initial mount.

### 6. Error handling summary

| Case | Behavior |
| --- | --- |
| Wrong password | Inline error on card, up to 3 attempts, then block decision |
| Prompt cancelled or 5-min timeout | Block decision; model told command was not run |
| Password changed/revoked while unlocked | Keep-alive clears credential; next sudo re-prompts |
| App crash while unlocked | Stale pw file deleted on next startup |
| `sudo -n` commands | Not gated; fail fast on their own |
| Locked + sudo runs anyway (e.g. race) | Askpass helper fails → sudo errors fast, no hang |

### 7. Testing

- Port otto's `sudo-session.test.ts` and `sudo-broker.test.ts` (drop
  session-keying cases; add coalescing case) with injected fake
  runner/askpass/timers.
- Unit tests for the PreToolUse gate: requires-sudo → prompts; `sudo -n` and
  non-sudo → pass through; locked + cancel → block decision.
- Vitest with `--maxWorkers=2`.
- Live smoke: ask a chat to run `sudo true`; verify one prompt, silent
  elevation afterward, indicator appears, manual lock re-prompts.

## Accepted quirks / risks

In a gated chat where a Bash command is not pre-approved, the password prompt
(PreToolUse) fires before the approval prompt. Rare in practice (user's
settings pre-approve Bash); reorder later if it stings.

- **Credential disclosure by the agent itself:** while unlocked, agent-run
  Bash executes as the user and can read `$SUDO_ASKPASS` / the 0600 pw file,
  so a misbehaving or prompt-injected agent could echo the password into the
  tool-result stream (and thus provider logs). This is inherent to any
  file-based askpass: an unlocked agent already has passwordless root, but
  disclosure (password reuse elsewhere) is a distinct harm. Accepted for now;
  cheap hardening if it stings: have the PreToolUse hook deny Bash commands
  that reference the sudo credential directory.

## Rejected alternatives

- **pkexec/polkit**: prompts per-command (not one-time), env-stripping changes
  command semantics, agent may not surface for tty-less children.
- **Timestamp priming (`sudo -v` keep-alive only, no askpass)**: with no tty,
  sudo keys its timestamp to the parent process start time, so a credential
  primed by SAI's main process never matches the transient `sh` children the
  Bash tool spawns (documented in otto's code comments; otto abandoned this).
