export const TRIANGLE_MASK_URL =
  "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='3 3.5 18.5 16'%3E%3Cpath d='M8.97 9.25 Q12 4 15.03 9.25 L17.63 13.75 Q20.66 19 14.6 19 L9.4 19 Q3.34 19 6.37 13.75 Z' fill='%23000'/%3E%3C/svg%3E";

export type IndicatorState = 'inactive' | 'alive' | 'busy' | 'done' | 'approval';

export interface WorkspaceStatusFlags {
  approval?: boolean;
  busy?: boolean;
  streaming?: boolean;
  awaitingQuestion?: boolean;
  completed?: boolean;
}

export function workspaceDisplayState(
  flags: WorkspaceStatusFlags | undefined,
  opts?: { isOpen?: boolean },
): IndicatorState {
  if (flags?.approval) return 'approval';
  if (flags?.busy || flags?.streaming || flags?.awaitingQuestion) return 'busy';
  if (flags?.completed) return 'done';
  if (opts?.isOpen) return 'alive';
  return 'inactive';
}
