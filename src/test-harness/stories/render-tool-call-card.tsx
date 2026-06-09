import { RenderToolCallCard } from '../../components/Chat/RenderToolCallCard';
import type { ToolCall } from '../../types';

function makeTc(width: number): ToolCall {
  const wide = width > 460;
  const html = wide
    ? `<div style="min-height:200px;display:flex;gap:16px;align-items:center;justify-content:center;background:#0a0b0f;padding:24px">
         <button style="padding:14px 30px;border:0;border-radius:12px;color:#fff;background:linear-gradient(135deg,#6d28d9,#2563eb)">Primary</button>
         <button style="padding:14px 30px;border:1px solid #2e3d4e;border-radius:12px;color:#bec6d0;background:transparent">Secondary</button>
       </div>`
    : `<div style="min-height:300px;display:grid;place-items:center;background:#0a0b0f"><button id="btn" style="padding:12px 24px;border:0;border-radius:10px;color:#fff;background:linear-gradient(135deg,#6d28d9,#2563eb)">click me</button></div>`;
  return {
    id: `tc-${width}`,
    type: 'mcp',
    name: 'mcp__swarm__sai_render_html',
    input: JSON.stringify({ title: 'Aurora Button', width, html }),
  };
}

export const renderToolCallCardStory = {
  // Wrap in a block container ~chat width so the harness shows the true
  // right-aligned layout. ?w=<px> sets the mock width (>460 → code drops below).
  component: ({ w }: { w: number }) => (
    <div style={{ width: 760, maxWidth: '100%' }}>
      <RenderToolCallCard tc={makeTc(w)} />
    </div>
  ),
  parseProps: (params: URLSearchParams) => ({ w: Number(params.get('w')) || 320 }),
};
