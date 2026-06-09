import { RenderToolCallCard } from '../../components/Chat/RenderToolCallCard';
import type { ToolCall } from '../../types';

const tc: ToolCall = {
  id: 'tc-1',
  type: 'mcp',
  name: 'mcp__swarm__sai_render_html',
  input: JSON.stringify({
    title: 'Aurora Button',
    width: 320,
    html: '<div style="min-height:300px;display:grid;place-items:center;background:#0a0b0f"><button id="btn" style="padding:12px 24px;border:0;border-radius:10px;color:#fff;background:linear-gradient(135deg,#6d28d9,#2563eb)">click me</button></div>',
  }),
};

export const renderToolCallCardStory = {
  component: () => <RenderToolCallCard tc={tc} />,
  parseProps: () => ({}),
};
