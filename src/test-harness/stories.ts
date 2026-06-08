import React from 'react';
import { workspaceSquircleStory } from './stories/workspace-squircle';
import { toolResultImageStory } from './stories/tool-result-image';

export type Story = {
  component: React.ComponentType<any>;
  parseProps: (params: URLSearchParams) => Record<string, unknown>;
};

export const stories: Record<string, Story> = {
  'workspace-squircle': workspaceSquircleStory,
  'tool-result-image': toolResultImageStory,
};
