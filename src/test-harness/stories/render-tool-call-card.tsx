import { RenderToolCallCard } from '../../components/Chat/RenderToolCallCard';
import type { ToolCall } from '../../types';

type Kind = 'html' | 'chart' | 'diff' | 'mermaid' | 'theme';

function makeTc(width: number, kind: Kind): ToolCall {
  if (kind === 'chart') {
    return {
      id: `tc-chart-${width}`,
      type: 'mcp',
      name: 'mcp__swarm__sai_render_chart',
      input: JSON.stringify({
        title: 'Weekly task counts',
        width,
        chart: 'bar',
        labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        values: [3, 7, 5, 9, 4],
        color: '#6aa9ff',
      }),
    };
  }
  if (kind === 'diff') {
    return {
      id: `tc-diff-${width}`,
      type: 'mcp',
      name: 'mcp__swarm__sai_render_diff',
      input: JSON.stringify({
        title: 'Button restyle',
        width,
        beforeLabel: 'Current',
        afterLabel: 'Proposed',
        before:
          '<button style="padding:8px 16px;border:1px solid #3a3f4b;border-radius:6px;background:#1b1f27;color:#cdd3df;font:600 13px system-ui">Save</button>',
        after:
          '<button style="padding:8px 16px;border:0;border-radius:8px;background:linear-gradient(180deg,#6aa9ff,#4f7fe0);color:#fff;font:600 13px system-ui;box-shadow:0 2px 8px rgba(79,127,224,.5)">Save</button>',
      }),
    };
  }
  if (kind === 'mermaid') {
    return {
      id: `tc-mermaid-${width}`,
      type: 'mcp',
      name: 'mcp__swarm__sai_render_mermaid',
      input: JSON.stringify({ title: 'Flow', width, diagram: 'graph TD; A[Start]-->B[Next]; B-->C[Done]' }),
    };
  }
  if (kind === 'theme') {
    return {
      id: `tc-theme-${width}`,
      type: 'mcp',
      name: 'mcp__swarm__sai_render_theme',
      input: JSON.stringify({ title: 'Theme', width, vars: { '--accent': '#6aa9ff' }, components: ['WorkspaceSquircle'], props: { state: 'busy-done' } }),
    };
  }
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
  // ?kind=html|chart|diff selects which renderer tool the card displays.
  component: ({ w, kind }: { w: number; kind: Kind }) => (
    <div style={{ width: 760, maxWidth: '100%' }}>
      <RenderToolCallCard tc={makeTc(w, kind)} />
    </div>
  ),
  parseProps: (params: URLSearchParams) => {
    const k = params.get('kind');
    const allowed = k === 'chart' || k === 'diff' || k === 'mermaid' || k === 'theme';
    return {
      w: Number(params.get('w')) || 320,
      kind: (allowed ? k : 'html') as Kind,
    };
  },
};
