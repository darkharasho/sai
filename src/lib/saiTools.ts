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
      'Render HTML live inside the SAI app and return a screenshot. Pass `html` for a ' +
      'self-contained snippet, or `path` to render a real multi-file site from the workspace ' +
      '(its CSS/JS/images resolve). Use `baseDir` to let an inline `html` snippet load workspace ' +
      'assets. USE THIS whenever the user asks to design, mock up, build, show, preview, or iterate ' +
      'on a UI. Re-call to iterate. NOTE: file-backed renders can read workspace files AND reach the ' +
      'network — only render trusted content.',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        html: { type: 'string', description: 'Self-contained snippet; may include <style> and <script>.' },
        path: { type: 'string', description: 'Workspace file or folder to render as a live site (folder → index.html).' },
        baseDir: { type: 'string', description: 'For inline `html`: workspace dir that relative assets resolve against.' },
        title: { type: 'string', description: 'Label shown on the card/panel.' },
        width: { type: 'number', description: 'Viewport width in px (default 360).' },
        height: { type: 'number', description: 'Viewport height in px for file-backed renders (default 480).' },
        background: { type: 'string', description: 'Canvas background behind the mock.' },
      },
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
    name: 'render_theme',
    description:
      'Apply candidate CSS custom properties to real registered SAI components and return a screenshot. ' +
      'USE THIS to preview a theme/color change on ACTUAL components (not a mock) so the user sees the ' +
      'real effect. Pass `vars` (CSS custom properties); optionally limit to specific `components`.',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        vars: { type: 'object', description: 'CSS custom properties, e.g. {"--accent":"#6aa9ff"}.' },
        components: { type: 'array', items: { type: 'string' }, description: 'Registry keys to preview; omit for all registered.' },
        props: { type: 'object', description: 'Representative props passed to each previewed component (e.g. {"state":"busy-done"}).' },
        title: { type: 'string', description: 'Label shown on the card/panel.' },
        width: { type: 'number', description: 'Viewport width in px (default 360).' },
        background: { type: 'string', description: 'Canvas background behind the preview.' },
      },
      required: ['vars'],
    },
  },
  {
    name: 'render_form',
    description:
      'Render an INTERACTIVE form/prompt in the SAI chat and BLOCK until the user submits, then return ' +
      'their input. USE THIS to ask the user a rich, visual question (pick one of these options, set a ' +
      'value, fill these fields) instead of plain text. Write self-contained HTML whose submit control ' +
      'calls window.saiSubmit(value) with a JSON-serializable value; that value comes back as ' +
      'result.value. The call blocks until the user submits or the form times out.',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        html: { type: 'string', description: 'Form HTML; a control must call saiSubmit(value).' },
        timeoutMs: { type: 'number', description: 'How long to wait for a submit (10000-600000, default 180000).' },
        title: { type: 'string', description: 'Label shown on the card.' },
        width: { type: 'number', description: 'Viewport width in px (default 360).' },
      },
      required: ['html'],
    },
  },
  {
    name: 'confirm',
    description:
      'Ask the user a yes/no question and BLOCK until they answer; returns { value: true | false }. A ' +
      'lightweight preset over render_form — use for a quick "proceed?" instead of authoring form HTML.',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The question to show.' },
        confirmLabel: { type: 'string', description: "Confirm button label (default 'Confirm')." },
        cancelLabel: { type: 'string', description: "Cancel button label (default 'Cancel')." },
        timeoutMs: { type: 'number', description: 'How long to wait (10000-600000, default 180000).' },
      },
      required: ['message'],
    },
  },
  {
    name: 'choose',
    description:
      'Ask the user to pick ONE of several options and BLOCK until they choose; returns { value: <chosen ' +
      'option string> }. A lightweight preset over render_form for a quick single choice.',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The prompt to show above the options.' },
        options: { type: 'array', items: { type: 'string' }, description: 'The options to choose from (one button each).' },
        timeoutMs: { type: 'number', description: 'How long to wait (10000-600000, default 180000).' },
      },
      required: ['message', 'options'],
    },
  },
  {
    name: 'pick_file',
    description:
      'Open a native file/folder picker and return the path(s) the user chooses. USE THIS when you need a ' +
      'file or directory from the user — they pick it in a real OS dialog; you only receive the chosen path.',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['open', 'save', 'directory'], description: "'open' (default), 'save', or 'directory'." },
        filters: { type: 'array', items: { type: 'object' }, description: 'Open-dialog file filters: [{name, extensions:[...]}].' },
        multi: { type: 'boolean', description: 'Allow selecting multiple files (open mode).' },
      },
    },
  },
  {
    name: 'notify',
    description:
      'Show an OS notification to the user (e.g. a long task finished). Fire-and-forget; returns ok. Use ' +
      'sparingly for things worth interrupting the user about.',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Notification title.' },
        body: { type: 'string', description: 'Notification body text.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'clipboard',
    description:
      'Write text to the system clipboard for the user to paste. WRITE-ONLY — reading the clipboard is not ' +
      'supported. Use to hand the user a result (a command, a snippet) they can paste elsewhere.',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: "Only 'write' is supported." },
        text: { type: 'string', description: 'Text to copy to the clipboard.' },
      },
      required: ['text'],
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
  {
    name: 'watch_github_run',
    description:
      'Show a live GitHub Actions watcher card for a workflow run. USE THIS right after you push, tag, or ' +
      'trigger a workflow (git push, gh workflow run, gh pr create, npm publish) so the user can watch CI ' +
      'progress. Returns immediately with the resolved run; the card keeps updating on its own. Identify ' +
      'the run by `url`, by `owner`+`repo`+`run_id`, or by `owner`+`repo`+`branch` (resolves the newest ' +
      'run, waiting briefly if it has not been created yet). Call again with the same target to get ' +
      'current status.',
    toolset: 'chat',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full run URL: https://github.com/{owner}/{repo}/actions/runs/{id}.' },
        owner: { type: 'string', description: 'Repo owner (with run_id or branch).' },
        repo: { type: 'string', description: 'Repo name (with run_id or branch).' },
        run_id: { type: 'string', description: 'Explicit run id (requires owner and repo).' },
        branch: { type: 'string', description: 'Resolve the newest run on this branch (requires owner and repo).' },
        workflow: { type: 'string', description: "Optional workflow filter for branch mode: file name ('release.yml') or workflow name." },
      },
    },
  },
];

export const SAI_TOOL_NAMES = new Set(SAI_TOOL_SCHEMA.map((t) => t.name));

export function toolsForToolset(toolset: SaiToolset): SaiToolDef[] {
  return SAI_TOOL_SCHEMA.filter((t) => t.toolset === toolset || t.toolset === 'both');
}
