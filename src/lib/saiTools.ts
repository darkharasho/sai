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
];

export const SAI_TOOL_NAMES = new Set(SAI_TOOL_SCHEMA.map((t) => t.name));

export function toolsForToolset(toolset: SaiToolset): SaiToolDef[] {
  return SAI_TOOL_SCHEMA.filter((t) => t.toolset === toolset || t.toolset === 'both');
}
