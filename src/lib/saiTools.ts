export type SaiToolset = 'chat' | 'orchestrator' | 'both';

export interface SaiToolDef {
  name: string;
  description: string;
  toolset: SaiToolset;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

export const SAI_TOOL_SCHEMA: SaiToolDef[] = [
  {
    name: 'render_html',
    description:
      'Render a self-contained HTML/CSS/JS snippet live inside the SAI app and return a screenshot. ' +
      'USE THIS whenever the user asks you to design, mock up, build, show, preview, or iterate on a ' +
      'UI element, component, page, or visual style (e.g. "make me a stylish button") — render it here ' +
      'so they can see it in-app, rather than writing a file. Re-call to iterate on feedback. ' +
      'The snippet runs sandboxed (no network, no app access).',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        html: { type: 'string', description: 'Full snippet; may include <style> and <script>.' },
        title: { type: 'string', description: 'Label shown on the card/panel.' },
        width: { type: 'number', description: 'Viewport width in px (default 360).' },
        background: { type: 'string', description: 'Canvas background behind the mock.' },
      },
      required: ['html'],
    },
  },
  {
    name: 'render_component',
    description:
      'Mount a registered SAI project component (by name, with props) live inside the app and return a ' +
      'screenshot. USE THIS to show or iterate on an existing project component visually, instead of ' +
      'describing it or editing files blindly. Only allow-listed components can be mounted.',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        component: { type: 'string', description: "Registry key, e.g. 'WorkspaceSquircle'." },
        props: { type: 'object', description: 'JSON props passed to the component.' },
        width: { type: 'number', description: 'Viewport width in px (default 360).' },
        background: { type: 'string', description: 'Canvas background behind the component.' },
      },
      required: ['component'],
    },
  },
  {
    name: 'render_chart',
    description:
      'Render a bar or line chart from JSON data live inside the SAI app and return a screenshot. ' +
      'USE THIS to SHOW the user numbers — metrics, benchmarks, timings, counts — instead of describing ' +
      'them in prose. Renders as inline SVG (no network).',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        chart: { type: 'string', enum: ['bar', 'line'], description: "'bar' or 'line'." },
        labels: { type: 'array', items: { type: 'string' }, description: 'X-axis labels, one per value.' },
        values: { type: 'array', items: { type: 'number' }, description: 'Numeric values; same length as labels.' },
        color: { type: 'string', description: 'Bar/line color (CSS color).' },
        title: { type: 'string', description: 'Label shown on the card/panel.' },
        width: { type: 'number', description: 'Viewport width in px (default 360).' },
        background: { type: 'string', description: 'Canvas background behind the chart.' },
      },
      required: ['chart', 'labels', 'values'],
    },
  },
  {
    name: 'render_diff',
    description:
      'Render two HTML snippets side-by-side (or stacked) live inside the SAI app and return a screenshot. ' +
      'USE THIS to compare two UI variants — old vs new, option A vs B — so the user sees them together. ' +
      'Each snippet runs sandboxed (no network, no app access).',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        before: { type: 'string', description: 'First variant HTML.' },
        after: { type: 'string', description: 'Second variant HTML.' },
        layout: { type: 'string', description: "'side-by-side' (default) or 'stacked'." },
        beforeLabel: { type: 'string', description: "Label over the first variant (default 'Before')." },
        afterLabel: { type: 'string', description: "Label over the second variant (default 'After')." },
        title: { type: 'string', description: 'Label shown on the card/panel.' },
        width: { type: 'number', description: 'Viewport width in px (default 360).' },
        background: { type: 'string', description: 'Canvas background behind the diff.' },
      },
      required: ['before', 'after'],
    },
  },
  {
    name: 'render_mermaid',
    description:
      'Render a Mermaid diagram (flowchart, sequence, class, state, ER, gantt) live inside the SAI app ' +
      'and return a screenshot. USE THIS to SHOW structure or flow — an architecture, a sequence of calls, ' +
      'a state machine — instead of describing it in prose. Pass Mermaid source.',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        diagram: { type: 'string', description: 'Mermaid source, e.g. "graph TD; A-->B".' },
        title: { type: 'string', description: 'Label shown on the card/panel.' },
        width: { type: 'number', description: 'Viewport width in px (default 360).' },
        background: { type: 'string', description: 'Canvas background behind the diagram.' },
      },
      required: ['diagram'],
    },
  },
  {
    name: 'inspect_element',
    description:
      "Return the computed box and CSS of a live element in the running SAI app, by CSS selector. " +
      "USE THIS to ground UI reasoning in what is ACTUALLY rendered — actual size, position, and " +
      "computed styles — instead of guessing from source or blaming stale builds/HMR. Read-only.",
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to inspect in the live app.' },
        props: {
          type: 'array',
          items: { type: 'string' },
          description: 'Computed style property names to return; omit for a useful default set.',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'capture_app',
    description:
      'Screenshot the live SAI app window (or a single element by selector) and return the image. ' +
      'USE THIS to SEE the real current state of the running app — not a mock — when diagnosing or ' +
      'confirming UI. Read-only.',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Optional CSS selector; omit to capture the whole window.' },
      },
    },
  },
];

export const SAI_TOOL_NAMES = new Set(SAI_TOOL_SCHEMA.map((t) => t.name));

export function toolsForToolset(toolset: SaiToolset): SaiToolDef[] {
  return SAI_TOOL_SCHEMA.filter((t) => t.toolset === toolset || t.toolset === 'both');
}
