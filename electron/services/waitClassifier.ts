export type WaitKind = 'none' | 'background' | 'scheduled';

export interface WaitMeta {
  kind: WaitKind;
  /** Seconds until a scheduled wakeup fires, when known (ScheduleWakeup delaySeconds). */
  resumeInSeconds: number | null;
  /** In-flight background task count when the CLI reports it, else null. */
  taskCount: number | null;
}

export interface ClassifyInput {
  /** terminal_reason from the result frame; may be undefined on older CLIs. */
  terminalReason?: string | null;
  /** True if a scheduling tool_use (ScheduleWakeup/CronCreate) fired this turn. */
  sawSchedulingTool: boolean;
  /** delaySeconds captured from the latest ScheduleWakeup input this turn, else null. */
  wakeupResumeInSeconds?: number | null;
  /** Background task count if the CLI surfaced it, else null. */
  taskCount?: number | null;
  /** True if a background launch tool_use (Bash/Agent/Task with run_in_background,
   *  Workflow) fired this turn. The CLI reports terminal_reason 'completed' when a
   *  turn ends with background tasks still running (verified on 2.1.195 — no
   *  background_requested, no background_tasks field), so the launch itself is the
   *  only positive signal that a resume is coming. */
  sawBackgroundLaunch?: boolean;
  /** True if a tool_result reporting an async launch arrived this turn. The
   *  runtime can background a launch the INPUT never asked for (live transcript
   *  2026-07-05: an Agent tool_use with no run_in_background flag came back
   *  "Async agent launched successfully."), so the result text is the only
   *  launch signal in that case. */
  sawAsyncLaunchResult?: boolean;
}

/** Extra slack after a scheduled wakeup's fire time before we treat it as
 *  abandoned (drop the pill, stop deferring the idle sweep). */
export const WAKEUP_GRACE_MS = 60_000;

const SCHEDULING_TOOLS = new Set(['ScheduleWakeup', 'CronCreate']);

export function isSchedulingTool(toolName: string): boolean {
  return SCHEDULING_TOOLS.has(toolName);
}

/** Tools that run work in the background when asked to. */
const BACKGROUND_CAPABLE_TOOLS = new Set(['Bash', 'Agent', 'Task']);

/** True if this tool_use launches work that outlives the turn (the runtime
 *  re-invokes the model when it finishes). */
export function isBackgroundLaunch(toolName: string, input: unknown): boolean {
  if (toolName === 'Workflow') return true; // workflows always run in the background
  if (!BACKGROUND_CAPABLE_TOOLS.has(toolName)) return false;
  return (input as { run_in_background?: unknown } | null | undefined)?.run_in_background === true;
}

/** Leading text of the tool_results the runtime returns for async launches
 *  (exact wording pulled from the 2.1.195 binary — an agent async-launch and a
 *  backgrounded Bash command respectively). */
const ASYNC_LAUNCH_MARKERS = [
  'Async agent launched successfully',
  'Command running in background with ID:',
];

/** True if a tool_result's content reports that the runtime launched (or
 *  backgrounded) work that outlives the turn. This catches launches the input
 *  sniff cannot see — the backgrounding decision is the runtime's, not the
 *  input's. Accepts string content or a content-block array. */
export function isAsyncLaunchResult(content: unknown): boolean {
  const texts: string[] = [];
  if (typeof content === 'string') {
    texts.push(content);
  } else if (Array.isArray(content)) {
    for (const block of content) {
      const b = block as { type?: unknown; text?: unknown } | null;
      if (b?.type === 'text' && typeof b.text === 'string') texts.push(b.text);
    }
  }
  return texts.some((t) => ASYNC_LAUNCH_MARKERS.some((m) => t.includes(m)));
}

/**
 * Classify why a turn ended. Waiting is opt-in on a positive signal only:
 * an unknown/absent terminal_reason is always a real end ('none'), so a turn
 * can never hang in a fake-waiting state. One exception: taskCount > 0 is the
 * runtime's OWN in-flight ledger (SDK Stop-hook background_tasks), so it
 * classifies as a wait even when terminal_reason is absent — but never on
 * aborted/error reasons, where the user or a limit ended the turn for real.
 *
 * Known limitation (CLI backend only, where no taskCount source exists):
 * sawBackgroundLaunch / sawAsyncLaunchResult are per-turn state. If a turn
 * launches two background tasks and a later resume turn ends without launching
 * anything new, that turn classifies 'none' and the pill drops even though a
 * task is still running — under-waiting, in keeping with the conservative bias
 * above. The SDK backend closes this via the Stop-hook task count.
 */
export function classifyTurnEnd(input: ClassifyInput): WaitMeta {
  if (input.terminalReason === 'background_requested') {
    return { kind: 'background', resumeInSeconds: null, taskCount: input.taskCount ?? null };
  }
  if (input.terminalReason === 'completed' && input.sawSchedulingTool) {
    return { kind: 'scheduled', resumeInSeconds: input.wakeupResumeInSeconds ?? null, taskCount: null };
  }
  // The runtime reported its in-flight ledger at stop time (SDK Stop hook):
  // authoritative in BOTH directions. >0 is a wait regardless of what (if
  // anything) launched this turn — covers launches the input sniff can't see
  // and resume turns that launch nothing new. An explicit 0 means any launch
  // sniffed this turn already finished, so the sniff rules below must not fire.
  const endedNaturally = input.terminalReason === 'completed' || input.terminalReason == null;
  if (typeof input.taskCount === 'number') {
    if (endedNaturally && input.taskCount > 0) {
      return { kind: 'background', resumeInSeconds: null, taskCount: input.taskCount };
    }
    return { kind: 'none', resumeInSeconds: null, taskCount: null };
  }
  // No ledger (CLI backend / older runtime): a turn that launched background
  // work and then ended 'completed' is a wait — the runtime will re-invoke the
  // model when the task finishes (the CLI does NOT tag this case
  // background_requested — see sawBackgroundLaunch above).
  if (input.terminalReason === 'completed' && (input.sawBackgroundLaunch || input.sawAsyncLaunchResult)) {
    return { kind: 'background', resumeInSeconds: null, taskCount: null };
  }
  return { kind: 'none', resumeInSeconds: null, taskCount: null };
}
