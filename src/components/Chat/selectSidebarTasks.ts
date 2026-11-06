import type { BackgroundTaskDetail } from '../../../electron/services/claudeBackend/backgroundTasks';

const EMPTY: BackgroundTaskDetail[] = [];

/** The background-work sidebar shows only the active chat's tasks. */
export function selectSidebarTasks(
  byScope: ReadonlyMap<string, BackgroundTaskDetail[]>,
  activeScopeKey: string | null,
): BackgroundTaskDetail[] {
  if (!activeScopeKey) return EMPTY;
  return byScope.get(activeScopeKey) ?? EMPTY;
}
