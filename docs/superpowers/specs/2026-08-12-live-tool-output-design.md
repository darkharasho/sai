# Live Tool Output Design

## Goal

Show incremental stdout and stderr for running shell-command tool calls in the
existing chat tool card, then retain the completed output in that same card.

## Scope

- Applies to provider events that identify a shell command (`Bash` and the
  equivalent ACP/Codex command-execution events).
- Streams text while a command is active; it does not create a second message
  or a terminal session.
- Keeps the current final-result, error, cancellation, and approval behavior.

## Design

The provider-event mapping layer will expose output chunks as updates keyed by
the existing tool-use ID. The chat state reducer will append a chunk only while
the corresponding card remains active. A completion result becomes the
authoritative final content and settles the card; duplicate or late chunks are
ignored after settlement.

`ToolCard` will render a running-output region for command tools when output is
available. The region uses the existing code/output presentation, preserves
stdout/stderr arrival order, and scrolls to the newest text only when the user
was already reading at the bottom. Once the command finishes, the same region
remains in place with the existing success, failure, or interrupted status.

No command text, paths, or output is persisted outside the normal transcript,
and no new IPC surface is introduced.

## Failure Handling

- Interleaved stdout and stderr are rendered in transport arrival order.
- A provider that only reports a final result continues to use the current
  behavior unchanged.
- A failed or cancelled command retains all received output and adds the
  existing terminal status.
- Chunks for an unknown, completed, or replaced tool-use ID are discarded.

## Testing

- Mapper/reducer tests cover ordered chunks, stdout/stderr interleaving,
  completion, cancellation/error, and stale chunks.
- Component tests cover the running card state and retained final output.
- The unit suite and production build must pass before handoff.
