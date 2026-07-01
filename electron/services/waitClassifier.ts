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
}

const SCHEDULING_TOOLS = new Set(['ScheduleWakeup', 'CronCreate']);

export function isSchedulingTool(toolName: string): boolean {
  return SCHEDULING_TOOLS.has(toolName);
}

/**
 * Classify why a turn ended. Waiting is opt-in on a positive signal only:
 * an unknown/absent terminal_reason is always a real end ('none'), so a turn
 * can never hang in a fake-waiting state.
 */
export function classifyTurnEnd(input: ClassifyInput): WaitMeta {
  if (input.terminalReason === 'background_requested') {
    return { kind: 'background', resumeInSeconds: null, taskCount: input.taskCount ?? null };
  }
  if (input.terminalReason === 'completed' && input.sawSchedulingTool) {
    return { kind: 'scheduled', resumeInSeconds: input.wakeupResumeInSeconds ?? null, taskCount: null };
  }
  return { kind: 'none', resumeInSeconds: null, taskCount: null };
}
