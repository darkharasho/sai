# System load guard: design

Date: 2026-10-23
Status: awaiting user approval

## Why

On 2026-10-23 at 21:46 the user's PC hard-froze and had to be reset. The
journal shows RAM ran out around 21:40, the system started swapping, KWin and
the browser stalled for longer and longer, and the machine never recovered.
Two SAI chats were active at the time, but their last commands were light
(writing files, a `/compact`). A Steam game was probably running. **Nothing on
the machine recorded which process was using the memory**, so the cause can't
be proven.

The user games while the AI works. That's their normal setup, not an edge
case. They want SAI to be a good neighbour on a shared machine:

- When the PC is **busier than normal or close to heavy**, the AI is told what's
  going on, so it can choose lighter actions.
- When the PC is under **heavy stress**, the AI is paused.
- When the AI's own command is what's pushing the PC over the edge, SAI
  **kills it**. In the user's words, "saving the pc matters more."
- SAI only manages SAI. It never touches the user's game, browser, Discord or
  anything else it didn't start.

## Goals

1. Watch system load continuously: memory, swap, memory pressure, CPU, and
   GPU.
2. Have three states: **normal**, **elevated** and **heavy**.
3. **Elevated:** tell every active AI session about the current load in plain
   facts, for example "RAM 84%, swap filling, a Steam game is using 11 GB".
   The AI decides how to adapt, for example fewer test workers, skipping a full
   build, or waiting.
4. **Heavy:** pause every AI chat in SAI:
   - It doesn't start new tool calls or new turns.
   - Commands it has already launched are frozen, not killed.
   - It resumes on its own once the load has stayed calm for a while (my call:
     30s).
5. **Heavy, with an SAI-launched process as a major contributor:** kill that
   process tree instead of freezing it. Then tell the AI it was killed for
   using too much memory and shouldn't be retried as it was.
6. Keep a **short rolling record** of the top memory users, both SAI's and
   everything else's. That way, after a stall SAI can say what was using the
   memory, and the "What's using memory?" view has data to show.
7. Make every state visible in the UI. A pause must never look like SAI is
   stuck or broken.

## Non-goals

- Managing, throttling, or killing anything SAI didn't start.
- Fixing the user's system configuration (swap, oomd, kernel settings).
- A full system monitor or task manager app.
- Long-term metrics storage or graphs over days.

## Anti-goals (failure even if it "works")

- **Killing the user's game or browser.** This is never acceptable.
- **False pauses during normal gaming.** A game using 100% GPU or a lot of CPU
  is normal, and that alone must not pause the AI. Memory pressure is what
  froze the machine, and it should drive the heavy state.
- **The monitor itself costing noticeable CPU or memory.** It needs to be
  cheap enough to run all day next to a game.
- **Silent behaviour.** A paused chat with no explanation, or a killed command
  the AI quietly retries, would both be failures.
- **Flapping.** Rapid pause/resume/pause cycles. The thresholds need
  hysteresis.

## What the user sees (approved mockups)

The user approved three mockups during brainstorming:

1. **Elevated.** A yellow pill in the chat header shows the load, for example
   "RAM 84% · game running". In the chat, a small "System load" note shows what
   the AI was told, followed by the AI adapting.
2. **Heavy, not SAI's fault.** A red "Paused · heavy load" pill, plus a banner
   across every chat. The banner says "AI paused: your PC is under heavy load",
   says whether SAI caused it, shows RAM and swap meters, and says it resumes
   automatically. It has two buttons:
   - **Resume anyway**: a manual override.
   - **What's using memory?**: opens the top-users list from the rolling
     record.

   While paused, the composer still accepts typing, but messages are queued
   until the chat resumes.
3. **Heavy, SAI's fault.** The killed command shows as a "Stopped" tool card
   with the command struck through. It explains "SAI stopped this to keep your
   PC from freezing", shows how much memory it was using, and lists the top
   memory users with SAI's own processes highlighted. A "Told the AI" note
   shows the message that was passed to the model. Afterwards the header pill
   shows "Recovered".

The exact wording, colours and placement are the builder's call within that
shape. Use SAI's existing theme tokens (`--accent`, `--red`, `--orange`,
`--green`, the surface scale).

## Constraints

- **Machine:** Bazzite (Fedora), KDE Plasma on Wayland, NVIDIA dGPU plus an AMD
  iGPU, 30 GiB RAM, 22 GiB swap, systemd-oomd present. Linux is the primary
  target.
- **Other platforms:** SAI also ships for macOS and Windows. My call: the
  feature is Linux-only for v1. On other platforms the monitor is a no-op and
  never pauses anything, and that must not break those builds.
- **Providers:** SAI runs Claude (Agent SDK), Codex, Gemini and Kimi (via ACP).
  Pausing and killing must work for every provider. The process-tree
  freeze/kill works regardless of provider. How new tool calls are blocked
  differs per provider:
  - For Claude SDK sessions, a `PreToolUse` hook is the proven pattern, see
    `electron/services/sudo/sudoHook.ts`. Hooks fire even in bypass mode,
    unlike `canUseTool`.
  - For other providers, the builder finds the equivalent. If a provider has
    no way to block tool calls, freezing its process tree is acceptable.
- **Process ownership:** "SAI's processes" means the provider CLI/agent
  processes SAI spawned and all their descendants (Bash commands, test runners,
  builds, dev servers), plus SAI's own terminals (`electron/services/pty.ts`).
  The kill and freeze logic must only ever act on that tree.
  - My call: **the user's own terminal tabs are excluded** from freezing and
    killing. Commands the user typed by hand are the user's stuff. Note that
    they run in separate `systemd-run --user --scope` cgroups (`pty.ts`), not
    under SAI's process tree. They are still listed in the rolling record,
    labelled "SAI terminal".
  - My call: **SAI's own Electron processes** (main, renderer, GPU) are never
    frozen or killed, and don't count toward "SAI's fault" for kill decisions.
    They are listed in the rolling record as "SAI app". If they're a top memory
    user at the moment the state turns heavy, the banner says so instead of "not
    caused by SAI", so a renderer leak doesn't go unnoticed.
- **Monitor cost:** sample at roughly 1–2s intervals using cheap sources such
  as `/proc/meminfo`, `/proc/pressure/memory`, `/proc/pressure/cpu`, and
  per-process RSS/swap from `/proc/<pid>/status` or `smaps_rollup`. GPU via
  `nvidia-smi` or NVML is fine if it's sampled less often, since it's
  informational only.
- **Logging:** state changes, pauses, resumes and kills go to the devlog
  (`electron/services/devlog.ts`). That gives the next investigation a
  timeline.

## Decided by the user

- Two tiers: elevated means the AI is informed and adapts; heavy means it's
  paused.
- "Heavy" is about memory pressure, not raw CPU or GPU usage.
- A pause freezes running AI commands, doesn't kill them, and resumes
  automatically. Every chat is covered. A visible notice explains it.
- If SAI's own process is the culprit under heavy load, kill it, because saving
  the PC matters more.
- SAI never acts on non-SAI processes. "SAI just worries about SAI."
- A rolling record of top memory users is kept.
- The UI follows the three approved mockups.

- **Anything in SAI's AI process trees can be killed** if that's what saves the
  machine. That includes one-off commands, background dev servers and watchers,
  swarm/orchestrator workers, and the provider agent process itself. "Whatever
  can save the computer."

## My calls (the user can override)

- **Kill preference order:** kill the single largest SAI offender first, then
  re-evaluate before killing anything else. At equal size, prefer one-off tool
  commands over long-lived processes, and long-lived processes over the agent
  itself, so the least disruptive kill that frees enough memory wins.
- **If the agent process is killed:**
  - The chat shows a clear "Stopped to save your PC" state with the memory
    numbers, never a generic crash.
  - The chat stays resumable from its saved session/transcript once the load
    is back to normal.
  - On resume, the AI is told what was killed and why.
- **If a background dev server or watcher is killed:** its card or pill says
  so, and the AI is told it isn't running anymore.

- **Thresholds**, starting points to tune by dogfooding, with hysteresis:
  - **Elevated:** any of
    - MemAvailable below 20%
    - swap usage growing over the last ~30s
    - memory PSI `some avg10` above 5
  - **Heavy:** any of
    - memory PSI `full avg10` above 10
    - MemAvailable below 6%
  - **Back to normal:** below the elevated thresholds for 30s.
- **What counts as "SAI's fault":** SAI's process trees together account for a
  large share of used memory when the state goes heavy, for example 25% or
  more of RAM+swap in use, or a single SAI process holding over 4 GB. A clearly
  growing SAI process during the slide toward heavy also counts. The builder
  may refine this.
- **Order of operations when heavy and SAI's fault:**
  1. Kill the largest SAI offender.
  2. Freeze the rest.
  3. Re-evaluate.
- **Game detection** (for the info note only, not for decisions): treat
  processes under Steam's reaper, gamescope, or using a lot of GPU memory as
  "a game".
- **Rolling record length:** about 10 minutes at 1–2s resolution, top ~10
  processes per sample, in memory only. A snapshot is written to the devlog
  when the state turns heavy. That snapshot survives a hard reset, so the next
  freeze can be explained.
- **Settings:** an on/off switch for the feature (default on) and an on/off
  switch for automatic kills (default on). Threshold sliders aren't needed for
  v1.
- **"Resume anyway":** overrides the pause for the current heavy episode only.
  It doesn't turn the feature off.

## Left to the builder

- How the load information reaches each provider's model: an injected system
  note on the next turn, hook `additionalContext`, or similar. It must be
  short, factual, and only sent on state changes, not every turn.
- Freeze mechanism: `SIGSTOP`/`SIGCONT` on the process tree, or the cgroup
  freezer if SAI's children run in a cgroup.
- How queued messages are held during a pause, and how pending tool calls
  wait. They could block in the hook until resume, or be denied with a
  "paused" reason.
- Where the monitor lives (main process vs a worker), the IPC shape, and the
  renderer state plumbing.
- Exact copy and visual details within the approved mockups.
- Test strategy. The threshold and state-machine logic must be unit-testable
  with fake samples. Vitest runs use `--maxWorkers=2` or fewer, per the user's
  global instructions.
