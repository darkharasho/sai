import React from 'react';
import { workspaceSquircleStory } from './stories/workspace-squircle';
import { toolResultImageStory } from './stories/tool-result-image';
import { componentRegistry } from '../render/componentRegistry';

export type Story = {
  component: React.ComponentType<any>;
  parseProps: (params: URLSearchParams) => Record<string, unknown>;
};

// Generic registry-backed story so harness stories and agent-renderable
// components stay one allow-list.
// /test-harness?story=registry&component=WorkspaceSquircle&props={...}
const registryStory: Story = {
  component: ({ component, props }: { component: string; props: Record<string, unknown> }) => {
    const reg = componentRegistry[component];
    if (!reg) return null;
    const Cmp = reg.component;
    return <Cmp {...props} />;
  },
  parseProps: (params) => ({
    component: params.get('component') ?? '',
    props: JSON.parse(params.get('props') ?? '{}'),
  }),
};

export const stories: Record<string, Story> = {
  'workspace-squircle': workspaceSquircleStory,
  'tool-result-image': toolResultImageStory,
  registry: registryStory,
};
