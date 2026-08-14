# Claude Configuration Propagation Design

## Goal

Ensure Claude model and effort selection remain stable across ordinary chats and Swarm task lifecycle messages.

## Scope

- Preserve workspace overrides as an explicit opt-in layer over global Claude settings.
- Remove the stale override for the local SAI workspace from the user's persisted SAI settings.
- Pass an explicit effort level to each Swarm task.
- Pass the active Swarm orchestrator model and effort to automatic task-status and batch-status turns.

## Design

The existing `resolveClaudeConfig` helper remains the source of truth for ordinary chat configuration: a workspace override wins only when present, otherwise the app-wide model and effort are used. Clearing the SAI workspace entry restores its inherited Opus/medium configuration without affecting other workspaces.

Swarm task dispatch will accept an explicit effort argument alongside its existing model argument and forward it to the provider send bridge. `App` will resolve that effort from the app-wide selection when it creates a task. Automatic orchestrator status sends will use the configured orchestrator model and the current Claude effort instead of `undefined`; this prevents the SDK backend from treating a status message as a configuration change and recreating the session with SDK defaults.

## Tests

- Verify a Swarm Claude task forwards its supplied effort.
- Verify automatic Swarm status sends retain the configured orchestrator model and effort.
- Retain unit coverage for workspace override precedence; configuration clearing is a user-settings migration/action rather than repo state.
