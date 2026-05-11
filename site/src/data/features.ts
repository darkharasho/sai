export interface Feature {
  title: string;
  blurb: string;
  glyph: string;
}

export const features: Feature[] = [
  {
    title: 'Chat with real project context',
    blurb: 'Talk to your assistant inside the editor with your repository already attached. Streaming, image attachments, persistent sessions, full history.',
    glyph: '◉',
  },
  {
    title: 'A composer that keeps up',
    blurb: 'Queue follow-up prompts behind a streaming turn, promote any item to “next,” or bypass the queue with Enter. Todo ring and queue badge live in the toolbar.',
    glyph: '»»',
  },
  {
    title: 'Approvals & telemetry',
    blurb: 'Provider-specific approval modes, inline tool-call approvals, context/token meters, response timers, and a cumulative turn timer for long runs.',
    glyph: '[ok]',
  },
  {
    title: 'Monaco editor & diff review',
    blurb: 'Tabs, syntax highlighting, unsaved-change protection, side-by-side and unified diffs. Open file links from chat, expand snippets to fullscreen.',
    glyph: '{ }',
  },
  {
    title: 'Integrated terminal',
    blurb: 'A real PTY-backed terminal — XTerm.js, interactive shell, clickable links, proper color rendering. Runs in your project directory.',
    glyph: '▶_',
  },
  {
    title: 'First-class Git',
    blurb: 'Stage, commit, branch, push, pull, discard, and review diffs from the sidebar. Background status refresh. AI-generated commit messages on demand.',
    glyph: 'git',
  },
  {
    title: 'Search & replace, project-wide',
    blurb: 'Regex, case, whole-word toggles. Results grouped by file. Inline replace across unsaved buffers in the editor.',
    glyph: '⌕',
  },
  {
    title: 'Plugins & MCP servers',
    blurb: 'Browse and install Claude Code plugins and MCP servers from inside SAI. Dedicated sidebars for installed servers and registry browsing.',
    glyph: '∷',
  },
];
