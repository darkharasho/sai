# Thinking Animation → Reply Morph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the SAI thinking animation morph in place into the assistant reply (logo settles, clock freezes into the duration stamp, status text hands off to the word reveal), cascading per segment across a turn, with tool cards running live beneath it.

**Architecture:** Extract the thinking visuals into a shared driver hook. Move the SAI thinking row from a detached bottom banner into the head of the forming assistant segment via a new `StreamingAssistantHead` component that owns the morph state machine (thinking → morphing → revealed) and reuses the existing `revealWords` engine. `ChatPanel` keeps a *pending* thinking row at the tail (and the detached banner only for non-SAI providers).

**Tech Stack:** React 18 (hooks, `motion/react`), TypeScript, Vitest + Testing Library, imperative DOM reveal (`wordReveal.ts`).

**Spec:** `docs/superpowers/specs/2026-06-05-thinking-morph-design.md`

---

## File Structure

- **Create** `src/components/Chat/useThinkingDriver.ts` — shared hook producing the live thinking values (SAI pref, chain mode, typewriter text, clock text, elapsed ms). Lifted verbatim from `ThinkingAnimation`. One responsibility: drive the thinking visuals.
- **Modify** `src/components/ThinkingAnimation.tsx` — consume `useThinkingDriver` instead of inlining the state/effects. Behavior unchanged (existing tests stay green). Still used by the *pending* tail row and as the non-SAI/banner fallback.
- **Create** `src/components/Chat/StreamingAssistantHead.tsx` — renders the assistant segment head (logo + clock + status) using the same layout as the final message head, and runs the morph state machine on completion. Owns the markdown `mdRef` and calls `revealWords`.
- **Modify** `src/components/Chat/ChatMessage.tsx` — for SAI assistant segments, delegate the content head to `StreamingAssistantHead` (covering both streaming and the completion morph); skip the legacy reveal effect for that path to avoid a double reveal.
- **Modify** `src/components/Chat/ChatPanel.tsx` — render the detached banner only for non-SAI providers; render a *pending* SAI thinking row at the tail when streaming with no streaming assistant segment.
- **Create** `tests/unit/components/Chat/StreamingAssistantHead.test.tsx` — morph state-machine tests.
- **Modify** `tests/unit/components/ThinkingAnimation.test.tsx` — unchanged assertions; verify the refactor keeps them green.

---

## Task 1: Extract `useThinkingDriver` hook

**Files:**
- Create: `src/components/Chat/useThinkingDriver.ts`
- Modify: `src/components/ThinkingAnimation.tsx`
- Test: `tests/unit/components/ThinkingAnimation.test.tsx` (existing — must stay green)

- [ ] **Step 1: Create the hook file** (lift the existing state/effects out of `ThinkingAnimation` verbatim; add `active` to gate timers and expose `elapsedMs`).

Create `src/components/Chat/useThinkingDriver.ts`:

```ts
import { useState, useEffect, useRef } from 'react';
import { Dot, Minus, Plus, Asterisk, SunDim, SunMedium, Sun } from 'lucide-react';
import type { SaiLogoMode } from '../SaiLogo';

// Pool of self-contained SAI animations that start AND end at neutral. Each thinking
// session samples 2–4, plays one cycle of each back-to-back, then re-shuffles.
const CHAIN_POOL: Array<{ mode: SaiLogoMode; dur: number }> = [
  { mode: 'pulse', dur: 2400 }, { mode: 'scatter', dur: 4800 }, { mode: 'wave', dur: 2600 },
  { mode: 'glitch', dur: 2400 }, { mode: 'inhale', dur: 5400 }, { mode: 'vortex', dur: 5000 },
  { mode: 'pendulum', dur: 3600 }, { mode: 'comet', dur: 4800 }, { mode: 'ripple', dur: 2600 },
  { mode: 'clockwork', dur: 8000 }, { mode: 'stutter', dur: 6200 }, { mode: 'flip', dur: 4000 },
  { mode: 'typewriter', dur: 3000 }, { mode: 'morse', dur: 3500 }, { mode: 'squish', dur: 2200 },
  { mode: 'bloom', dur: 3600 }, { mode: 'searchlight', dur: 3400 },
];

function sampleChain(n: number): typeof CHAIN_POOL {
  const shuffled = CHAIN_POOL.slice().sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

const THINKING_WORDS = [
  'ESTABLISHING UPLINK', 'TRIANGULATING', 'CALIBRATING', 'TRACING SIGNAL',
  'ALIGNING VECTORS', 'MAPPING TOPOLOGY', 'LOCKING TELEMETRY', 'SYNCHRONIZING CLOCKS',
  'RUNNING DIAGNOSTICS', 'NEGOTIATING ORBIT', 'AWAITING GO/NO-GO', 'POLLING GROUND STATIONS',
  'DECRYPTING TOKENS', 'SCRAPING CACHE', 'ROUTING THROUGH PROXY', 'COMPILING THOUGHT',
  'ACCESSING DATABANK', 'CROSS-REFERENCING', 'EXTRAPOLATING', 'RESOLVING INTENT',
  'INDEXING MEMORY', 'CONSULTING ARCHIVES', 'PARSING SIGNAL', 'SYNTHESIZING',
  'CASTING RUNES', 'DIVINING INTENT', 'CHANNELING SPIRITS', 'INVOKING THE MUSE',
  'CONSULTING THE RUBBER DUCK', 'INTERROGATING THE STACK', 'BARGAINING WITH FATE',
];

const FALLBACK_WORDS = [
  'Thinking', 'Pondering', 'Ruminating', 'Cogitating', 'Deliberating', 'Musing',
  'Contemplating', 'Considering', 'Reflecting', 'Computing', 'Evaluating', 'Reasoning',
  'Percolating', 'Mulling', 'Formulating', 'Devising', 'Imagining', 'Calculating', 'Solving',
];

const SPINNER_ICONS = [Dot, Minus, Plus, Asterisk, SunDim, SunMedium, Sun];

// Live preference cached at module scope; SettingsModal broadcasts updates via the
// `sai-pref-sai-animation` window event.
let saiAnimationPref = true;
if (typeof window !== 'undefined' && (window as any).sai?.settingsGet) {
  (window as any).sai.settingsGet('saiAnimationEnabled', true)
    .then((v: boolean) => { saiAnimationPref = v !== false; });
}

export interface ThinkingDriver {
  saiAnimationEnabled: boolean;
  chainMode: SaiLogoMode;
  displayText: string;
  clockText: string;
  elapsedMs: number;
  Icon: typeof SPINNER_ICONS[number];
}

// Drives the thinking visuals. Pass `active=false` to freeze all timers (used by the
// morph once a segment completes).
export function useThinkingDriver(active = true): ThinkingDriver {
  const [wordIndex, setWordIndex] = useState(() => Math.floor(Math.random() * THINKING_WORDS.length));
  const [charIndex, setCharIndex] = useState(0);
  const [phase, setPhase] = useState<'typing' | 'pause' | 'erasing'>('typing');
  const [iconIndex, setIconIndex] = useState(0);
  const [saiAnimationEnabled, setSaiAnimationEnabled] = useState(saiAnimationPref);
  const [chainMode, setChainMode] = useState<SaiLogoMode>(
    () => CHAIN_POOL[Math.floor(Math.random() * CHAIN_POOL.length)].mode);

  const mountedAtRef = useRef<number>(performance.now());
  const elapsedRef = useRef(0);
  const [clockText, setClockText] = useState('00:00.0');

  useEffect(() => {
    if (!saiAnimationEnabled || !active) return;
    const id = setInterval(() => {
      const ms = performance.now() - mountedAtRef.current;
      elapsedRef.current = ms;
      const totalSec = Math.floor(ms / 1000);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      const d = Math.floor((ms % 1000) / 100);
      setClockText(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`);
    }, 100);
    return () => clearInterval(id);
  }, [saiAnimationEnabled, active]);

  const wordPool = saiAnimationEnabled ? THINKING_WORDS : FALLBACK_WORDS;
  const word = wordPool[wordIndex % wordPool.length];
  const Icon = SPINNER_ICONS[iconIndex % SPINNER_ICONS.length];

  useEffect(() => {
    if (saiAnimationEnabled || !active) return;
    const interval = setInterval(() => setIconIndex(i => i + 1), 150);
    return () => clearInterval(interval);
  }, [saiAnimationEnabled, active]);

  useEffect(() => {
    const onPref = (e: Event) => setSaiAnimationEnabled(!!(e as CustomEvent).detail);
    window.addEventListener('sai-pref-sai-animation', onPref);
    return () => window.removeEventListener('sai-pref-sai-animation', onPref);
  }, []);

  useEffect(() => {
    if (!saiAnimationEnabled || !active) return;
    let cancelled = false;
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    const wait = (ms: number) => new Promise<void>(resolve => { timeouts.push(setTimeout(resolve, ms)); });
    (async () => {
      while (!cancelled) {
        const n = 2 + Math.floor(Math.random() * 3);
        const chain = sampleChain(n);
        for (const step of chain) {
          if (cancelled) return;
          setChainMode(step.mode);
          await wait(step.dur);
          if (cancelled) return;
          setChainMode('static');
          await wait(80);
        }
      }
    })();
    return () => { cancelled = true; timeouts.forEach(clearTimeout); };
  }, [saiAnimationEnabled, active]);

  useEffect(() => {
    if (!active) return;
    let timeout: ReturnType<typeof setTimeout>;
    if (phase === 'typing') {
      if (charIndex < word.length) {
        timeout = setTimeout(() => setCharIndex(c => c + 1), 40 + Math.random() * 30);
      } else {
        timeout = setTimeout(() => setPhase('pause'), 1200 + Math.random() * 600);
      }
    } else if (phase === 'pause') {
      timeout = setTimeout(() => setPhase('erasing'), 100);
    } else if (phase === 'erasing') {
      if (charIndex > 0) {
        timeout = setTimeout(() => setCharIndex(c => c - 1), 20);
      } else {
        setWordIndex(i => (i + 1 + Math.floor(Math.random() * 3)) % wordPool.length);
        setPhase('typing');
      }
    }
    return () => clearTimeout(timeout);
  }, [charIndex, phase, word.length, wordPool.length, active]);

  return {
    saiAnimationEnabled,
    chainMode,
    displayText: word.slice(0, charIndex),
    clockText,
    elapsedMs: elapsedRef.current,
    Icon,
  };
}
```

- [ ] **Step 2: Refactor `ThinkingAnimation` to use the hook.**

Replace the body of `src/components/ThinkingAnimation.tsx` (lines 1–236) with:

```tsx
import SaiLogo from './SaiLogo';
import { useThinkingDriver } from './Chat/useThinkingDriver';

interface ThinkingAnimationProps {
  color?: string;
}

export default function ThinkingAnimation({ color }: ThinkingAnimationProps = {}) {
  const { saiAnimationEnabled, chainMode, displayText, clockText, Icon } = useThinkingDriver();

  return (
    <div className="thinking-animation" style={color ? { color } : undefined}>
      {saiAnimationEnabled
        ? <SaiLogo mode={chainMode} size={18} className="thinking-icon" color={color || '#c7913b'} />
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
}
```

- [ ] **Step 3: Run the existing ThinkingAnimation tests — verify still green.**

Run: `npx vitest run tests/unit/components/ThinkingAnimation.test.tsx --maxWorkers=2`
Expected: PASS (4 tests). The refactor is behavior-preserving.

- [ ] **Step 4: Commit.**

```bash
git add src/components/Chat/useThinkingDriver.ts src/components/ThinkingAnimation.tsx
git commit -m "refactor(ui): extract useThinkingDriver hook from ThinkingAnimation"
```

---

## Task 2: `StreamingAssistantHead` morph component

**Files:**
- Create: `src/components/Chat/StreamingAssistantHead.tsx`
- Test: `tests/unit/components/Chat/StreamingAssistantHead.test.tsx`

The component renders the assistant segment head in the **same layout as the final
message head** (a `SaiLogo` dot + a body holding the clock/duration, the status text, and
the markdown), so the morph is in-place — the same nodes before and after.

- [ ] **Step 1: Write the failing test.**

Create `tests/unit/components/Chat/StreamingAssistantHead.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { installMockSai } from '../../../helpers/ipc-mock';

vi.mock('../../../../src/components/SaiLogo', () => ({
  default: ({ mode, className }: { mode?: string; className?: string }) => (
    <span data-testid="sai-logo" data-mode={mode} className={className} />
  ),
}));
vi.mock('../../../../src/components/SaiLogo.css', () => ({}));

const revealSpy = vi.fn(() => ({ cancel: () => {} }));
vi.mock('../../../../src/components/Chat/wordReveal', () => ({
  revealWords: (...args: any[]) => revealSpy(...args),
}));

// jsdom has no matchMedia by default; force "motion allowed".
beforeEach(() => {
  installMockSai();
  revealSpy.mockClear();
  window.matchMedia = window.matchMedia || ((q: string) => ({
    matches: false, media: q, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  } as any));
  window.dispatchEvent(new CustomEvent('sai-pref-sai-animation', { detail: true }));
});
afterEach(() => { vi.useRealTimers(); });

import StreamingAssistantHead from '../../../../src/components/Chat/StreamingAssistantHead';

describe('StreamingAssistantHead', () => {
  it('while streaming: shows live clock + status, animated logo, no reveal', () => {
    const { container, getByTestId } = render(
      <StreamingAssistantHead streaming content="">
        <p>unused</p>
      </StreamingAssistantHead>
    );
    expect(container.querySelector('.sah-clock')).toBeTruthy();
    expect(container.querySelector('.sah-status')).toBeTruthy();
    // animated logo is NOT forced static while thinking
    expect(getByTestId('sai-logo').getAttribute('data-mode')).not.toBe('static');
    expect(revealSpy).not.toHaveBeenCalled();
  });

  it('on completion: freezes clock to duration, settles logo, reveals md', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container, rerender, getByTestId } = render(
      <StreamingAssistantHead streaming content="">
        <p>hello world</p>
      </StreamingAssistantHead>
    );
    // segment completes: streaming false, content present, durationMs stamped
    await act(async () => {
      rerender(
        <StreamingAssistantHead streaming={false} content="hello world" durationMs={12400}>
          <p>hello world</p>
        </StreamingAssistantHead>
      );
    });
    // advance past the status-blur handoff
    await act(async () => { vi.advanceTimersByTime(300); });

    expect(container.querySelector('.sah-clock')?.textContent).toBe('[00:12.4]');
    expect(getByTestId('sai-logo').getAttribute('data-mode')).toBe('static');
    expect(revealSpy).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.sah-status')).toBeNull();
  });

  it('reduced motion: no morph, content shown instantly, no reveal animation', async () => {
    window.matchMedia = ((q: string) => ({
      matches: true, media: q, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    } as any));
    const { container, rerender } = render(
      <StreamingAssistantHead streaming content=""><p>hi</p></StreamingAssistantHead>
    );
    await act(async () => {
      rerender(
        <StreamingAssistantHead streaming={false} content="hi" durationMs={500}>
          <p>hi</p>
        </StreamingAssistantHead>
      );
    });
    expect(revealSpy).not.toHaveBeenCalled();
    expect(container.querySelector('.chat-msg-md')?.textContent).toContain('hi');
  });
});
```

- [ ] **Step 2: Run the test — verify it fails.**

Run: `npx vitest run tests/unit/components/Chat/StreamingAssistantHead.test.tsx --maxWorkers=2`
Expected: FAIL — `Cannot find module '.../StreamingAssistantHead'`.

- [ ] **Step 3: Implement the component.**

Create `src/components/Chat/StreamingAssistantHead.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import SaiLogo from '../SaiLogo';
import { useThinkingDriver } from './useThinkingDriver';
import { revealWords } from './wordReveal';
import { prefersReducedMotion } from './motion';

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const d = Math.floor((ms % 1000) / 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`;
}

const STATUS_BLUR_MS = 250;

type Phase = 'thinking' | 'morphing' | 'revealed';

interface Props {
  /** True while this segment is the actively-streaming assistant message. */
  streaming: boolean;
  /** message.content — present once the segment completes. */
  content: string;
  /** Per-segment duration stamp; the frozen clock lands on this. */
  durationMs?: number;
  /** The rendered markdown for the segment (revealed on completion). */
  children: React.ReactNode;
}

export default function StreamingAssistantHead({ streaming, content, durationMs, children }: Props) {
  const [phase, setPhase] = useState<Phase>(streaming ? 'thinking' : 'revealed');
  const driver = useThinkingDriver(phase === 'thinking');
  const mdRef = useRef<HTMLDivElement | null>(null);
  const frozenMsRef = useRef<number>(0);
  const revealedRef = useRef(false);

  // Drive the morph when the segment stops streaming with content present.
  useEffect(() => {
    if (streaming) { setPhase('thinking'); return; }
    if (phase === 'revealed') return;
    if (!content) return;
    if (revealedRef.current) return;
    revealedRef.current = true;
    frozenMsRef.current = durationMs ?? driver.elapsedMs;

    if (prefersReducedMotion()) { setPhase('revealed'); return; }

    setPhase('morphing'); // freeze clock + static logo + blur status (CSS)
    const t = setTimeout(() => setPhase('revealed'), STATUS_BLUR_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, content]);

  // Reveal the markdown once the status has handed off.
  useEffect(() => {
    if (phase !== 'revealed') return;
    if (prefersReducedMotion()) return;
    const el = mdRef.current;
    if (!el) return;
    const ctrl = revealWords(el);
    return () => ctrl.cancel();
  }, [phase]);

  const isStatic = phase !== 'thinking';
  const clock = isStatic ? formatMs(frozenMsRef.current) : driver.clockText;

  return (
    <div className="chat-msg-content sah-root" data-phase={phase}>
      <SaiLogo
        mode={isStatic ? 'static' : driver.chainMode}
        size={16}
        className="chat-msg-dot chat-msg-sai"
        color="#c7913b"
      />
      <div className="chat-msg-body">
        <div className={`chat-msg-duration sah-clock${isStatic ? ' sah-clock--done' : ''}`}>
          [{clock}]
        </div>
        {phase !== 'revealed' && (
          <span className={`sah-status${phase === 'morphing' ? ' sah-status--gone' : ''}`}>
            {driver.displayText}
            <span className="thinking-cursor thinking-cursor-block" />
          </span>
        )}
        <div
          ref={mdRef}
          className="chat-msg-md sah-md"
          style={phase === 'revealed' ? undefined : { display: 'none' }}
        >
          {children}
        </div>
      </div>
      <style>{`
        .sah-clock { transition: color .45s ease; }
        .sah-clock--done { color: var(--text-muted); }
        .sah-status {
          font-family: 'Departure Mono', 'Geist Mono', 'JetBrains Mono', monospace;
          font-size: 13px; letter-spacing: 0.4px; color: var(--accent);
          transition: opacity .25s ease, filter .25s ease;
        }
        .sah-status--gone { opacity: 0; filter: blur(2px); }
        .sah-root { animation: sah-drop .42s cubic-bezier(.2,.8,.2,1); }
        @keyframes sah-drop { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) {
          .sah-root { animation: none; }
          .sah-status { transition: none; }
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 4: Run the test — verify it passes.**

Run: `npx vitest run tests/unit/components/Chat/StreamingAssistantHead.test.tsx --maxWorkers=2`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit.**

```bash
git add src/components/Chat/StreamingAssistantHead.tsx tests/unit/components/Chat/StreamingAssistantHead.test.tsx
git commit -m "feat(ui): StreamingAssistantHead — morph thinking row into the reply"
```

---

## Task 3: Wire `StreamingAssistantHead` into `ChatMessage`

For SAI assistant segments (provider not gemini/codex, `saiAnimationEnabled` true), render
the head via `StreamingAssistantHead` for both the streaming and completed states, and skip
the legacy reveal effect so the markdown isn't revealed twice.

**Files:**
- Modify: `src/components/Chat/ChatMessage.tsx`
- Test: `tests/unit/components/Chat/ChatMessage.test.tsx`

- [ ] **Step 1: Write the failing test** (append to the existing file's top-level `describe`).

Add to `tests/unit/components/Chat/ChatMessage.test.tsx`:

```tsx
it('SAI assistant segment renders the morph head while streaming', () => {
  const { container } = render(
    <ChatMessage
      message={{ id: 'a1', role: 'assistant', content: '', timestamp: Date.now() }}
      projectPath="/tmp" aiProvider="claude" isStreaming
    />
  );
  expect(container.querySelector('.sah-root')).toBeTruthy();
});

it('non-SAI provider does NOT use the morph head', () => {
  const { container } = render(
    <ChatMessage
      message={{ id: 'a2', role: 'assistant', content: '', timestamp: Date.now() }}
      projectPath="/tmp" aiProvider="gemini" isStreaming
    />
  );
  expect(container.querySelector('.sah-root')).toBeNull();
});
```

> If the existing test file mocks `SaiLogo`/`wordReveal`, reuse those mocks. If it doesn't
> render with `aiProvider`, copy the prop shape from neighboring tests in the same file.

- [ ] **Step 2: Run — verify it fails.**

Run: `npx vitest run tests/unit/components/Chat/ChatMessage.test.tsx -t "morph head" --maxWorkers=2`
Expected: FAIL — `.sah-root` not found.

- [ ] **Step 3: Add the import** at the top of `src/components/Chat/ChatMessage.tsx` (after line 20):

```tsx
import StreamingAssistantHead from './StreamingAssistantHead';
```

- [ ] **Step 4: Add a SAI gate and render the head.** In the component body, after
`const isAssistantStreaming = isStreaming && message.role === 'assistant';` (line 717),
add:

```tsx
  const useMorphHead =
    message.role === 'assistant' &&
    saiAnimationEnabled &&
    aiProvider !== 'gemini' &&
    aiProvider !== 'codex';
```

Then guard the legacy reveal effect (line 718) so it skips the SAI path:

```tsx
  useLayoutEffect(() => {
    if (message.role !== 'assistant') return;
    if (useMorphHead) { if (isAssistantStreaming) STREAMED_MESSAGES.add(message.id); return; }
    if (isAssistantStreaming) { STREAMED_MESSAGES.add(message.id); return; }
    // ...unchanged remainder...
  }, [isAssistantStreaming, message.id, message.role, message.content, message.timestamp, useMorphHead]);
```

- [ ] **Step 5: Render the morph head in the content slot.** Replace the content branch
(lines 755–818, the `{message.content && !isAssistantStreaming && (...)}` block) so the SAI
path uses `StreamingAssistantHead` for both streaming and completed states. The existing
markdown (`<div ref={mdRef} className="chat-msg-md">...</ReactMarkdown></div>`) becomes the
`children` of `StreamingAssistantHead`; the `mdRef` is no longer used on the SAI path (the
head owns its own ref), so render the markdown without `ref={mdRef}` inside the head.

```tsx
      {useMorphHead && (isAssistantStreaming || message.content) && (
        <StreamingAssistantHead
          streaming={!!isAssistantStreaming}
          content={typeof message.content === 'string' ? message.content : String(message.content ?? '')}
          durationMs={message.durationMs}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight, rehypeFilePaths]}
            urlTransform={(url) => url.startsWith('sai-file://') ? url : defaultUrlTransform(url)}
            components={MARKDOWN_COMPONENTS}
          >
            {typeof message.content === 'string' ? message.content : String(message.content ?? '')}
          </ReactMarkdown>
        </StreamingAssistantHead>
      )}
      {!useMorphHead && message.content && !isAssistantStreaming && (
        <div className="chat-msg-content">
          {/* ...existing non-SAI content branch unchanged (user/assistant/system dot + body + mdRef + ReactMarkdown)... */}
        </div>
      )}
```

> **Refactor note (DRY):** the `components={{ pre, a }}` object passed to `ReactMarkdown`
> is duplicated across both branches. Extract it once above the `return` as a stable
> `MARKDOWN_COMPONENTS` const (it closes over `onFileOpen`, `projectPath`, `matchLinkPreview`,
> `LinkPreviewChip`) and reference it from both branches. Keep behavior identical to the
> current inline object (lines 776–806).

- [ ] **Step 6: Run the ChatMessage tests — verify the new ones pass and none regress.**

Run: `npx vitest run tests/unit/components/Chat/ChatMessage.test.tsx --maxWorkers=2`
Expected: PASS (existing + 2 new). Fix any selector drift in pre-existing tests that
assumed the assistant dot/markdown render path (the SAI path now nests under `.sah-root`).

- [ ] **Step 7: Commit.**

```bash
git add src/components/Chat/ChatMessage.tsx tests/unit/components/Chat/ChatMessage.test.tsx
git commit -m "feat(ui): route SAI assistant segments through the morph head"
```

---

## Task 4: Relocate the thinking row in `ChatPanel` (banner → tail/pending)

The detached banner now renders only for non-SAI providers. For SAI, the per-segment head
(Task 3) covers active segments; `ChatPanel` adds a **pending** tail row for the window
where the turn is streaming but no assistant segment exists yet.

**Files:**
- Modify: `src/components/Chat/ChatPanel.tsx`
- Test: `tests/unit/components/Chat/ChatPanel.test.tsx`

- [ ] **Step 1: Write the failing test** (append to the existing `ChatPanel` describe).

Add to `tests/unit/components/Chat/ChatPanel.test.tsx`:

```tsx
it('SAI: shows a pending thinking row when streaming with no assistant segment yet', () => {
  const { container } = renderPanel({
    aiProvider: 'claude',
    isStreaming: true,
    messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: Date.now() }],
  });
  expect(container.querySelector('.thinking-animation')).toBeTruthy();
});

it('SAI: no detached banner once an assistant segment is streaming', () => {
  const { container } = renderPanel({
    aiProvider: 'claude',
    isStreaming: true,
    messages: [
      { id: 'u1', role: 'user', content: 'hi', timestamp: Date.now() },
      { id: 'a1', role: 'assistant', content: '', timestamp: Date.now() },
    ],
  });
  // the morph head carries the thinking visuals; no standalone bottom banner
  expect(container.querySelector('.thinking-animation')).toBeNull();
  expect(container.querySelector('.sah-root')).toBeTruthy();
});

it('non-SAI provider keeps the detached banner', () => {
  const { container } = renderPanel({
    aiProvider: 'gemini',
    isStreaming: true,
    messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: Date.now() }],
  });
  expect(container.querySelector('.gemini-thinking, .codex-thinking, .thinking-animation')).toBeTruthy();
});
```

> Use the file's existing render helper (named `renderPanel`/`setup` in the current test).
> If none exists, mirror the render call used by neighboring tests in the same file,
> passing `aiProvider`, `isStreaming`, and `messages` as props/initial state.

- [ ] **Step 2: Run — verify it fails.**

Run: `npx vitest run tests/unit/components/Chat/ChatPanel.test.tsx -t "pending thinking" --maxWorkers=2`
Expected: FAIL.

- [ ] **Step 3: Compute the pending/banner flags.** After `const showThinking = isStreaming && !awaitingQuestion;` (line 1463) add:

```tsx
  const isSaiProvider = aiProvider !== 'gemini' && aiProvider !== 'codex';
  const lastMsg = messages[messages.length - 1];
  const hasStreamingAssistantSegment = !streamSettled && lastMsg?.role === 'assistant';
  // SAI: the per-segment head owns the thinking visuals; only show a standalone tail row
  // when no assistant segment is streaming yet. Non-SAI keeps the detached banner.
  const showPendingSaiThinking = showThinking && isSaiProvider && !hasStreamingAssistantSegment;
  const showProviderBanner = showThinking && !isSaiProvider;
```

- [ ] **Step 4: Replace the banner render block** (lines 1836–1850). Swap the single
`showThinking` gate for the two new flags:

```tsx
        <MotionPresence>
          {showProviderBanner && (
            <motion.div
              key="thinking"
              initial={{ opacity: 0, y: DISTANCE.lift }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={thinkingTransition}
            >
              {aiProvider === 'gemini' ? <GeminiThinkingAnimation loadingPhrases={geminiLoadingPhrases} />
                : <CodexThinkingAnimation />}
            </motion.div>
          )}
          {showPendingSaiThinking && (
            <motion.div
              key="thinking-pending"
              initial={{ opacity: 0, y: DISTANCE.lift }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={thinkingTransition}
            >
              <ThinkingAnimation />
            </motion.div>
          )}
        </MotionPresence>
```

- [ ] **Step 5: Run the ChatPanel tests — verify pass, no regressions.**

Run: `npx vitest run tests/unit/components/Chat/ChatPanel.test.tsx --maxWorkers=2`
Expected: PASS. If any existing test asserted `.thinking-animation` for a claude+streaming
case where an assistant segment exists, update it — that path now renders `.sah-root`.

- [ ] **Step 6: Commit.**

```bash
git add src/components/Chat/ChatPanel.tsx tests/unit/components/Chat/ChatPanel.test.tsx
git commit -m "feat(ui): SAI thinking row is per-segment + pending tail (banner = non-SAI only)"
```

---

## Task 5: Full suite, manual verification, and fallbacks

**Files:** none new — verification + any fixups.

- [ ] **Step 1: Run the full unit suite.**

Run: `npx vitest run --maxWorkers=2`
Expected: PASS. Address any selector drift from the relocated thinking row.

- [ ] **Step 2: Typecheck and lint.**

Run: `npm run typecheck && npm run lint`
Expected: clean. (If scripts differ, use the repo's configured equivalents.)

- [ ] **Step 3: Manual verification in the app** (motion timing isn't covered by jsdom).

Run the app (`/run` or the project's dev command) and confirm with the SAI provider:
  - A single-segment reply: thinking row morphs in place — logo settles, clock freezes to
    the duration stamp, status blurs out, text reveals word-by-word.
  - A multi-segment turn: each segment morphs; a new thinking row drops in below while the
    turn continues; none after the final segment.
  - A tool-using segment: the tool card runs live beneath the thinking row, which stays
    pinned above its tools and morphs in place on completion.
  - Toggle **SAI animation off** in Settings: falls back to today's static behavior, no morph.
  - OS **reduced motion**: text appears without morph/slide.
  - Switch provider to **Gemini/Codex**: the detached banner is unchanged.

- [ ] **Step 4: Final commit (only if fixups were needed).**

```bash
git add -A
git commit -m "test(ui): stabilize thinking-morph across suite + fallbacks"
```

---

## Self-Review

- **Spec coverage:** morph (Task 2), clock→duration freeze (Task 2 `formatMs(frozenMsRef)`),
  logo settle (Task 2 `mode='static'`), status→word handoff (Task 2 `revealWords`), cascade
  + pending row (Tasks 3–4), tool cards live beneath (Task 3 leaves tool rendering below the
  head untouched), provider scope (Tasks 3–4 SAI gate), reduced-motion / pref-off fallbacks
  (Tasks 2 + 5). All spec sections map to a task.
- **Type consistency:** `useThinkingDriver(active?)` → `ThinkingDriver`; `StreamingAssistantHead`
  props `{ streaming, content, durationMs?, children }`; `formatMs` matches the existing
  `ChatMessage` implementation (identical formula). `MARKDOWN_COMPONENTS` is the extracted
  shared components object.
- **No placeholders:** every code step has complete code. The two "unchanged remainder" /
  "existing branch" notes refer to verbatim-preserved existing code, not new code to invent.
