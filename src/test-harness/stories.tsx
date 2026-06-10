import React from 'react';
import { workspaceSquircleStory } from './stories/workspace-squircle';
import { toolResultImageStory } from './stories/tool-result-image';
import { saiRenderStory } from './stories/sai-render';
import { renderToolCallCardStory } from './stories/render-tool-call-card';
import { componentRegistry } from '../render/componentRegistry';

export type Story = {
  component: React.ComponentType<any>;
  parseProps: (params: URLSearchParams) => Record<string, unknown>;
};

// Generic registry-backed story so harness stories and agent-renderable
// components stay one allow-list.
// Parse the `props` query param as a JSON object, tolerating malformed input
// (a bad URL should not crash the harness page).
function safeJsonObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

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
    props: safeJsonObject(params.get('props')),
  }),
};

export const stories: Record<string, Story> = {
  'workspace-squircle': workspaceSquircleStory,
  'tool-result-image': toolResultImageStory,
  'sai-render': saiRenderStory,
  'render-tool-call-card': renderToolCallCardStory,
  registry: registryStory,
};
