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
      'Render a self-contained HTML/CSS/JS mock inside SAI and return a screenshot. Use for sketching UI. The mock runs sandboxed and cannot access the app.',
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
      'Mount a registered SAI project component with props and return a screenshot. Use to iterate on real components. Only allow-listed components can be mounted.',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        component: { type: 'string', description: "Registry key, e.g. 'WorkspaceSquircle'." },
        props: { type: 'object', description: 'JSON props passed to the component.' },
        width: { type: 'number' },
        background: { type: 'string' },
      },
      required: ['component'],
    },
  },
];

export const SAI_TOOL_NAMES = new Set(SAI_TOOL_SCHEMA.map((t) => t.name));

export function toolsForToolset(toolset: SaiToolset): SaiToolDef[] {
  return SAI_TOOL_SCHEMA.filter((t) => t.toolset === toolset || t.toolset === 'both');
}
