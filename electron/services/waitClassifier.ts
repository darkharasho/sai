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

/**
 * Classify why a turn ended. Waiting is opt-in on a positive signal only:
 * an unknown/absent terminal_reason is always a real end ('none'), so a turn
 * can never hang in a fake-waiting state.
 *
 * Known limitation: sawBackgroundLaunch is per-turn state. If a turn launches
 * two background tasks and a later resume turn ends without launching anything
 * new, that turn classifies 'none' and the pill drops even though a task is
 * still running — under-waiting, in keeping with the conservative bias above.
 */
export function classifyTurnEnd(input: ClassifyInput): WaitMeta {
  if (input.terminalReason === 'background_requested') {
    return { kind: 'background', resumeInSeconds: null, taskCount: input.taskCount ?? null };
  }
  if (input.terminalReason === 'completed' && input.sawSchedulingTool) {
    return { kind: 'scheduled', resumeInSeconds: input.wakeupResumeInSeconds ?? null, taskCount: null };
  }
  // A turn that launched background work and then ended 'completed' is a wait:
  // the runtime will re-invoke the model when the task finishes (the CLI does
  // NOT tag this case background_requested — see sawBackgroundLaunch above).
  if (input.terminalReason === 'completed' && input.sawBackgroundLaunch) {
    return { kind: 'background', resumeInSeconds: null, taskCount: input.taskCount ?? null };
  }
  return { kind: 'none', resumeInSeconds: null, taskCount: null };
}
