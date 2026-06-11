# `watch_github_run` MCP Tool — Design

**Date:** 2026-06-11
**Status:** Approved

## Goal

Replace the URL-detection heuristics that spawn the GitHub Actions watcher card with an
explicit SAI MCP tool. SAI calls `watch_github_run` after pushing or triggering a workflow;
the existing `GitHubWatcherCard` renders and polls exactly as today. The regex/mutation-filter
detection path is deleted entirely — the tool is the only way a watcher card appears.

## Tool schema (`src/lib/saiTools.ts`)

```
name: watch_github_run
toolset: 'chat'
description: Show a live GitHub Actions watcher card for a workflow run. Call after
  pushing or triggering a workflow. Returns immediately with the resolved run; the
  card keeps updating for the user. Call again with the same target to get current status.
input_schema (one of url | run_id | branch required):
  url       string  — full run URL (https://github.com/{owner}/{repo}/actions/runs/{id})
  owner     string  — repo owner (with run_id or branch)
  repo      string  — repo name (with run_id or branch)
  run_id    string  — explicit run id (requires owner+repo)
  branch    string  — resolve the newest run for this branch (requires owner+repo)
  workflow  string  — optional workflow file/name filter for branch resolution
```

## Run resolver (new `src/components/Chat/githubRunResolver.ts`)

- `url` mode: parse `{owner, repo, runId}` from the URL. Also accepts dev-only
  `sai://fake-run/{id}[?outcome=...&speed=...]` URLs so the existing fake-run test
  path keeps working.
- `run_id` mode: use coordinates directly.
- `branch` mode: `GET /repos/{owner}/{repo}/actions/runs?branch={branch}&per_page=5`
  via the existing `window.sai.githubApiGet` IPC, optionally filtered by `workflow`
  (matches workflow `path` basename or `name`), pick the newest run. If no run exists
  yet (run not created right after a push), retry every 3 s for up to 30 s, then error
  with "no run found".
- Returns `{owner, repo, runId, url, status, conclusion, displayTitle}`.

## Live dispatch path (`saiToolDispatcher`)

On `watch_github_run`: run the resolver and return the resolved-run JSON as the tool
result immediately. The card renders through the normal tool-call card flow (below);
the dispatcher does not mount anything itself. Resolution failure → the tool result is
the error string, so SAI can react.

## Chat card path (`ChatMessage` watcher row)

- `ChatMessage` keeps its existing watcher row, but derives targets from
  `watch_github_run` tool calls on the message (`watchTargetsFromMessage`) instead of
  scanning text — the target comes from the tool result JSON, falling back to parsing
  a `url` from the tool input when no result exists yet. `ChatPanel`'s
  first-mention dedupe allowlist uses the same function. (This replaces the earlier
  idea of routing through `entryFromToolCall`, which serves the RenderRegion system,
  not bespoke cards.)
- Snapshot persistence is unchanged: the card still dispatches
  `GITHUB_WATCHER_SNAPSHOT_EVENT`, `ChatPanel` still persists it onto the message, and
  `seedSnapshot` rehydrates on reload, so completed runs render their final state from
  history without API calls. The PWA snapshot relay is untouched.
- Idempotency: card mounting keys on `owner/repo/runId`. A repeat call for the same run
  returns current status in the tool result without visually duplicating a live card in
  the same message; a later message's card seeds from the shared snapshot.

## Deletions

- `src/components/Chat/githubWatcher.ts` (RUN_URL_RE, FAKE_RUN_RE, MUTATION_RE,
  QUERY_RE, `detectWatchTargets`).
- `src/renderer-remote/chat/githubWatcher.ts` (PWA text-only port).
- `detectWatchTargets` call sites in `src/components/Chat/ChatMessage.tsx` and the PWA
  `Transcript.tsx`.

Kept as-is: `GitHubWatcherCard.tsx` (both variants), polling, workflow-YAML DAG
rendering, snapshot machinery, `github-auth.ts`.

## Error handling

- No token + private repo → resolver falls back to the public API (current card behavior).
- 404 / resolution timeout → tool returns an error result string.
- In-card fetch errors keep rendering inside the card as today.

## Testing

- Unit tests for the resolver: URL parsing, branch resolution with mocked
  `githubApiGet`, retry-until-created behavior, fake-URL passthrough.
- Unit tests for the `watchTargetFromToolCall` / `watchTargetsFromMessage` mapping.
- Manual verification via the `sai://fake-run` flow.
- Note: new SAI tools are not live in a running session — restart SAI to dogfood.
