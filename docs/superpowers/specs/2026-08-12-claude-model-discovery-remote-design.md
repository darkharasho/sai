# Claude Model Discovery for Remote and Desktop Labels

## Goal

Keep SAI's Claude model choices and labels aligned with the signed-in Claude
Code installation across desktop, SAI Remote, and the mobile shell. No surface
should pin an Opus version that becomes stale after Claude Code updates.

## Current state

Desktop obtains the allowed model set from `~/.claude.json` through
`getAvailableClaudeModels()` in `electron/services/claude.ts`. Its built-in
fallback still embeds version-specific descriptions. Remote and mobile each
maintain a separate static picker; Remote sends a pinned full model ID, and the
embedded mobile PWA bundle can lag behind its source.

## Design

### Model catalogue

`getAvailableClaudeModels()` remains the single source of truth for Claude
model availability. Its model option shape will expose display labels and
descriptions that are either supplied by the CLI cache or derived safely from
the model ID. The built-in entries use rolling aliases (`opus`, `sonnet`, and
`haiku`) and non-versioned fallback copy such as "Latest Opus". They must not
claim a particular release number.

When the CLI cache supplies an additional model such as Fable, SAI preserves
its exact label and description. The desktop picker therefore presents actual
account-enabled model names and versions where known, without guessing from
the current SAI release.

### Remote protocol

The authenticated Remote bridge gains a request/reply pair for the Claude
catalogue. The desktop main process provides the existing discovery result to
the bridge. The bridge returns only the model option fields needed by a client
(`id`, `label`, `description`, plus presentation flags), never raw Claude
configuration or credentials.

Remote clients request the catalogue after authentication. The wire client
correlates the response with a request ID and makes it available to the Remote
chat/composer. Model overrides keep their existing session persistence and are
sent as-is in `prompt` messages.

### Remote and mobile presentation

The Remote composer renders the discovered options, including account-specific
models. It retains a clear/default row that omits the model override and lets
the desktop default apply. If discovery fails, it falls back to a small local
list using rolling aliases rather than full, version-pinned identifiers.

The React Native mobile composer receives the same fallback change immediately.
The shipped Remote PWA and embedded mobile web assets are rebuilt from source
as part of the change, preventing stale compiled model IDs from being released.

### Error handling and compatibility

Model discovery is advisory. A disconnected or older desktop bridge leaves the
composer usable with the alias fallback. Existing persisted explicit IDs are
kept selectable even if they are not in the refreshed list, so opening an old
session does not silently rewrite its setting. Clearing the selection restores
the desktop default. Desktop's existing guard remains responsible for rejecting
or replacing selections no longer allowed by the account.

## Tests

- Unit-test version-safe fallback labels and preservation of CLI-supplied
  labels/descriptions.
- Unit-test the bridge catalogue reply and its request-ID correlation.
- Unit-test the Remote wire request/reply behavior and composer display using
  discovered options and the alias fallback.
- Build the desktop and Remote bundles, and confirm generated assets contain no
  `claude-opus-4-7` or other retired pinned fallback ID.

## Non-goals

- Querying Anthropic's API directly for model metadata.
- Changing the Claude CLI's model routing or access policy.
- Replacing a user's saved explicit model selection automatically.
