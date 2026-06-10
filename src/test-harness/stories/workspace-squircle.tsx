import { WorkspaceSquircle } from '../../components/shared/WorkspaceSquircle';
import type { IndicatorState } from '../../lib/workspaceStatus';

export const workspaceSquircleStory = {
  component: WorkspaceSquircle,
  parseProps: (params: URLSearchParams) => ({
    state: (params.get('state') ?? 'inactive') as IndicatorState,
  }),
};
