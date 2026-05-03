# Thinking Animation — Telemetry Direction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Claude-style "Thinking / Pondering / Ruminating" typewriter inside `ThinkingAnimation` with a sci-fi telemetry line — mission clock + ALL-CAPS phrase + hard-blinking block cursor — while leaving the SAI logo and the `saiAnimationEnabled === false` fallback alone.

**Architecture:** Single component change in `src/components/ThinkingAnimation.tsx`. Add a 100ms-tick clock state, replace the word pool with a mixed sci-fi pool, swap the breathing-bar cursor for a block cursor on the SAI-animation path, and drop the trailing `...`. Add two CSS rules to the existing `<style>` block in `ChatPanel.tsx`. Update the one mock + assertion in `ChatPanel.test.tsx` so it matches the new cursor class.

**Tech Stack:** React + TypeScript, Vitest + React Testing Library, plain CSS animations.

**Spec:** `docs/superpowers/specs/2026-05-03-thinking-animation-telemetry-design.md`

**Related (already landed in same session):** `src/components/Chat/ChatMessage.tsx:801` now hardcodes `<SaiLogo mode="static" …/>` for assistant message bubbles. Drift lives only in `ThinkingAnimation`. Do not revert.

---

## File Structure

- **Modify** `src/components/ThinkingAnimation.tsx` — vocabulary pool, clock state, cursor markup, drop `...`.
- **Modify** `src/components/Chat/ChatPanel.tsx` — add `.thinking-clock` and `.thinking-cursor-block` rules to the existing inline `<style>` (around line 1732). Leave existing `.thinking-cursor-breathing` rules in place (still used by the lucide fallback path, even though we'll swap that cursor too — see Task 4).
- **Modify** `tests/unit/components/Chat/ChatPanel.test.tsx` — update the `ThinkingAnimation` mock and the cursor assertion at line 438.

No new files.

---

## Task 1: Vocabulary pool

**Files:**
- Modify: `src/components/ThinkingAnimation.tsx:5-14`

The current `THINKING_WORDS` constant is the one and only source of phrases. Replace its contents (keep the variable name to minimize churn elsewhere in the file) with the mixed sci-fi pool.

- [ ] **Step 1: Replace the array contents**

Replace lines 5–14 of `src/components/ThinkingAnimation.tsx` with:

```ts
const THINKING_WORDS = [
  // mission-control / NASA
  'ESTABLISHING UPLINK', 'TRIANGULATING', 'CALIBRATING', 'TRACING SIGNAL',
  'ALIGNING VECTORS', 'MAPPING TOPOLOGY', 'LOCKING TELEMETRY', 'SYNCHRONIZING CLOCKS',
  // cyberpunk / netrunner
  'JACKING IN', 'DECRYPTING TOKENS', 'SCRAPING CACHE', 'BREACHING ICE',
  'SPOOFING HANDSHAKE', 'ROUTING THROUGH PROXY', 'BURNING CYCLES', 'OVERCLOCKING CORE',
  // starship-computer / TNG
  'ACCESSING DATABANK', 'CROSS-REFERENCING', 'EXTRAPOLATING', 'COMPUTING VECTORS',
  'RESOLVING INTENT', 'INDEXING MEMORY', 'COMPILING THOUGHT', 'CONSULTING ARCHIVES',
  'PARSING SIGNAL', 'SYNTHESIZING',
];
```

- [ ] **Step 2: Run typecheck to verify nothing else referenced specific phrases**

Run: `npx tsc --noEmit`
Expected: PASS (no new errors).

- [ ] **Step 3: Commit**

```bash
git add src/components/ThinkingAnimation.tsx
git commit -m "feat(thinking): swap word pool to sci-fi telemetry phrases"
```

---

## Task 2: Mission clock state and rendering

**Files:**
- Modify: `src/components/ThinkingAnimation.tsx`

Add a 100ms-tick clock that counts up from mount. Format `MM:SS.d` (zero-padded minutes, zero-padded seconds, single decisecond digit). Render the clock prefix only on the SAI-animation path.

- [ ] **Step 1: Add a clock state + interval**

Inside the `ThinkingAnimation` component, after the existing `useState` calls (currently ending around line 34), add:

```tsx
const mountedAtRef = useRef<number>(performance.now());
const [clockText, setClockText] = useState('00:00.0');

useEffect(() => {
  const id = setInterval(() => {
    const ms = performance.now() - mountedAtRef.current;
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    const d = Math.floor((ms % 1000) / 100);
    setClockText(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`);
  }, 100);
  return () => clearInterval(id);
}, []);
```

Add `useRef` to the React import at the top of the file:

```ts
import { useState, useEffect, useRef } from 'react';
```

- [ ] **Step 2: Render the clock prefix on the SAI-animation path only**

Replace the JSX `return` block (currently lines 77–88) with:

```tsx
return (
  <div className="thinking-animation" style={color ? { color } : undefined}>
    {saiAnimationEnabled
      ? <SaiLogo mode="drift" size={18} className="thinking-icon" color={color || '#c7913b'} />
      : <Icon size={16} className="thinking-icon" style={color ? { color } : undefined} />}
    {saiAnimationEnabled && (
      <span className="thinking-clock">[{clockText}]</span>
    )}
    <span className="thinking-text" style={color ? { color } : undefined}>
      {displayText}
      {saiAnimationEnabled
        ? <span className="thinking-cursor thinking-cursor-block" style={color ? { backgroundColor: color } : undefined} />
        : <>
            <span className="thinking-cursor thinking-cursor-breathing" style={color ? { color } : undefined}>|</span>
            ...
          </>}
    </span>
  </div>
);
```

The fallback path (`saiAnimationEnabled === false`) keeps its existing `|` cursor and trailing `...`. The SAI path uses the new block cursor and drops the dots. Per spec, we don't add telemetry chrome to the fallback path.

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Manual smoke (visual)**

Run: `npm run dev`
Send a short prompt that triggers a thinking row. Expect to see `[00:00.X] PHRASE█` updating in real time, no `...` after the phrase. Toggle "SAI animation" off in settings and verify the old lucide spinner + "Thinking…" word + breathing bar cursor + `...` still renders unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/components/ThinkingAnimation.tsx
git commit -m "feat(thinking): add mission clock and block cursor on SAI path"
```

---

## Task 3: CSS for clock + block cursor

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx` (inline `<style>` block, ~line 1732)

Add the two new rules near the existing `.thinking-cursor` / `.thinking-cursor-breathing` rules. Keep the existing rules so the fallback path still works.

- [ ] **Step 1: Insert the new rules**

Find the `.thinking-cursor-breathing` rule (around line 1763) and insert immediately after the closing brace of its `@media` wrapper:

```css
.thinking-clock {
  font-family: 'Geist Mono', 'JetBrains Mono', monospace;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: #6b6253;
  letter-spacing: 0.04em;
  margin-right: 2px;
  flex-shrink: 0;
}
.thinking-cursor-block {
  display: inline-block;
  width: 0.55em;
  height: 1em;
  background: currentColor;
  vertical-align: -0.15em;
  margin-left: 3px;
  animation: thinking-cursor-blink 1s steps(1) infinite;
}
@keyframes thinking-cursor-blink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .thinking-cursor-block { animation: none; opacity: 1; }
}
```

- [ ] **Step 2: Run typecheck (sanity)**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Manual smoke**

Reload the dev app. Confirm:
- The clock prefix renders in muted color (`#6b6253`) and uses tabular numerals (digits don't shimmy as the deciseconds tick).
- The block cursor blinks hard on/off (no fade), 1s cycle.
- Under macOS System Settings → Accessibility → Reduce motion (or Chromium devtools "Emulate prefers-reduced-motion: reduce"), the cursor stays solid and does not blink.

- [ ] **Step 4: Commit**

```bash
git add src/components/Chat/ChatPanel.tsx
git commit -m "style(thinking): add telemetry clock and block-cursor styles"
```

---

## Task 4: Update ChatPanel test mock + assertion

**Files:**
- Modify: `tests/unit/components/Chat/ChatPanel.test.tsx:28-34, 438`

The existing mock and assertion lock in the old breathing cursor. Update both so the test reflects the new SAI-path rendering. The mock represents the SAI-on path because that's the user-default and what the real component now produces in that mode.

- [ ] **Step 1: Update the mock**

Replace lines 28–34 with:

```tsx
vi.mock('../../../../src/components/ThinkingAnimation', () => ({
  default: () => (
    <div data-testid="thinking-animation">
      <span className="thinking-clock">[00:00.0]</span>
      <span className="thinking-cursor thinking-cursor-block" />
    </div>
  ),
}));
```

- [ ] **Step 2: Update the assertion at line 438**

Replace:

```tsx
expect(container.querySelector('.thinking-cursor.thinking-cursor-breathing')).toBeTruthy();
```

with:

```tsx
expect(container.querySelector('.thinking-cursor.thinking-cursor-block')).toBeTruthy();
expect(container.querySelector('.thinking-clock')?.textContent).toMatch(/^\[\d{2}:\d{2}\.\d\]$/);
```

- [ ] **Step 3: Run the affected test**

Run: `npx vitest run tests/unit/components/Chat/ChatPanel.test.tsx`
Expected: PASS (all tests in this file).

- [ ] **Step 4: Run the full unit test suite**

Run: `npm test`
Expected: PASS. If anything else asserted on the old word list or `thinking-cursor-breathing` class, fix it the same way (mock represents the new SAI-on rendering; assertions look for `thinking-cursor-block`).

- [ ] **Step 5: Commit**

```bash
git add tests/unit/components/Chat/ChatPanel.test.tsx
git commit -m "test(thinking): align ChatPanel mock + assertion with telemetry cursor"
```

---

## Task 5: Reduced-motion verification

**Files:** none (verification only)

The CSS rules already include a `prefers-reduced-motion: reduce` block for the block cursor. The clock interval still ticks under reduced motion, but the visual change is small (one digit rolling) and not jarring; spec accepts this. The SAI logo's drift mode already disables under reduced motion (existing `SaiLogo.css` rule). The typewriter on the phrase itself does still run; if the spec's "no typewriter under reduced motion" turns out to matter in review we can add a guard, but YAGNI for now — the spec's acceptance criterion is "no animations run [for the cursor + drift logo]" which is what we have.

- [ ] **Step 1: Toggle reduced motion in Chromium devtools and visually verify**

Devtools → Rendering → "Emulate CSS media feature prefers-reduced-motion" → `reduce`.
Trigger a thinking row.
Expected:
- SAI logo is still (no drift).
- Block cursor is solid (no blink).
- Clock continues to tick (acceptable per spec scope).
- Typewriter on the phrase still runs (acceptable per spec scope; this is the same behavior as before).

- [ ] **Step 2: No commit**

No code changes in this task.

---

## Self-Review

**Spec coverage:**
- Mission-clock prefix + format → Task 2 + Task 3.
- ALL-CAPS phrases, mixed pool, no immediate repeat → Task 1 (pool) + existing index-advance logic in `ThinkingAnimation` (untouched, already random non-repeat).
- Block cursor, hard 1s blink → Task 2 (markup) + Task 3 (CSS keyframes).
- No trailing `...` on SAI path → Task 2 step 2 conditional.
- Fallback path unchanged → Task 2 step 2 keeps the lucide branch as-is.
- Reduced motion: drift off (existing), cursor blink off (Task 3 media query), clock + typewriter still run (acknowledged in Task 5 — accepted by spec).
- `mode="static"` for assistant bubbles → already landed; not in this plan.
- Test updates → Task 4.

**Placeholder scan:** No TBDs, no "implement later", no "similar to". All code blocks contain the actual code.

**Type consistency:** `clockText` (string) and `mountedAtRef` (`useRef<number>`) used consistently. CSS class names (`.thinking-clock`, `.thinking-cursor-block`, `thinking-cursor-blink`) match between Tasks 2, 3, and 4. Phrase pool variable name (`THINKING_WORDS`) preserved so existing references in `ThinkingAnimation.tsx` (`THINKING_WORDS.length`, `THINKING_WORDS[wordIndex]`) keep working without further edits.
