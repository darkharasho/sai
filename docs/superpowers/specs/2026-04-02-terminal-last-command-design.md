# @terminal:last Design

Attach the output from the last terminal command to the AI prompt. Available via `@terminal:last` autocomplete and the Add (+) menu.

## Prompt Detection

New function `getTerminalLastCommand(maxLines?: number)` in `src/terminalBuffer.ts`.

**Algorithm:**
1. Read terminal buffer lines (same terminal selection logic as `getTerminalContent`)
2. Scan backwards from the bottom, skipping trailing empty lines
3. If the last non-empty line matches a prompt pattern (the user's current idle input line), skip it and continue scanning upward
4. Find the next line matching a prompt pattern — this is the start of the last command
5. Return everything from that prompt line to the bottom (trimming trailing empty lines)

**Prompt pattern regex:**
```
/^(\S+[@:]\S+[\$#%>❯]|[\$#%>❯])\s/
```

Matches common shell prompts: `user@host:~$`, `$`, `%`, `❯`, `#`, lines ending with prompt suffixes followed by a space. Covers bash, zsh, fish defaults.

**Fallback:** If no prompt pattern is found in the buffer, return the full buffer content (same as `getTerminalContent`).

## Autocomplete & Context

- `@terminal:last` appears in the `@` autocomplete dropdown when typing `@t...`, alongside existing `@terminal`
- Also appears in the Add (+) menu as "Add Last Command" with description "Attach output from last terminal command"
- When selected, calls `getTerminalLastCommand()` from `terminalBuffer.ts`
- Replaces any existing terminal context item (same behavior as `@terminal`)
- Context chip displays "Terminal: last cmd (N lines)"
- Flows through `buildMessage()` identically — wrapped in `[Terminal output]` markdown code block

## Files Changed

- `src/terminalBuffer.ts` — add `getTerminalLastCommand()` function and prompt regex
- `src/components/Chat/ChatInput.tsx` — add `@terminal:last` to @ autocomplete and Add menu, add handler

## Testing

- Unit test `getTerminalLastCommand()`:
  - Buffer with prompt + command + output + prompt at bottom (idle) — returns from command prompt to bottom, skipping idle prompt
  - Buffer with prompt + command + output (no idle prompt at bottom) — returns from command prompt to bottom
  - Buffer with multiple commands — returns only the last one
  - Empty buffer — returns null
  - No prompt found — falls back to full buffer content
- Unit test autocomplete: typing `@t` shows both `@terminal` and `@terminal:last`
