# Codex Tool and Notification Hardening Design

**Date:** 2026-08-12  
**Status:** Approved

## Goal

Prevent malformed Codex/MCP tool payloads from crashing the chat renderer and restore desktop completion notifications for Codex chat turns.

## Design

1. The chat event consumer treats `message.content` as untrusted transport data. It processes only arrays for assistant and tool-result envelopes, ignoring malformed content rather than iterating it.
2. The Codex SDK MCP adapter treats `result.content` as untrusted. A valid array is mapped to renderer blocks; missing or malformed content becomes an empty result, while valid `structured_content` is still shown.
3. `SdkCodexBackend` accepts an injected completion hook. Its production wiring uses the shared notification service and fires only for completed `chat` scopes, never for interrupted or failed turns.

## Error Handling

Malformed provider data must not escape the Electron-to-renderer boundary as a UI crash. Existing error cards remain responsible for genuine Codex turn failures.

## Tests

- ChatPanel ignores malformed assistant and user `message.content` values.
- The Codex SDK mapper accepts malformed MCP result content without throwing.
- A completed Codex chat turn invokes completion notification exactly once; task, failed, and interrupted turns do not.
