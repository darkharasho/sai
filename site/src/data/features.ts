export interface Feature {
  coord: string;
  title: string;
  blurb: string;
  meta: string;
  icon: string; // lucide icon name (without prefix)
  flagship?: boolean;
}

export const features: Feature[] = [
  {
    coord: 'D-01',
    title: 'Swarm mode',
    blurb: 'Spawn parallel Claude tasks from one orchestrator chat. Each writing task gets its own git worktree; review diffs and land individually, or "land all green" in one go. Slash-command escape hatch included.',
    meta: 'mod · swarm · parallel',
    icon: 'zap',
    flagship: true,
  },
  {
    coord: 'D-02',
    title: 'Meta workspaces',
    blurb: 'Group many projects into one workspace. One chat, one terminal, one editor, one Git panel — spanning every included repo. Per-project chips on tool calls; per-repo stage / commit / push controls.',
    meta: 'mod · meta · multi-repo',
    icon: 'layers',
    flagship: true,
  },
  {
    coord: 'A-01',
    title: 'Project-context chat',
    blurb: 'Talk to your agent inside the editor with your repository already attached. Streaming, image attachments, persistent sessions, full history.',
    meta: 'mod · chat · streaming',
    icon: 'message-square-text',
  },
  {
    coord: 'A-02',
    title: 'Composer queue',
    blurb: 'Queue follow-up prompts behind a streaming turn, promote any item to "next," or bypass with Enter. Todo-ring and queue badge live in the toolbar.',
    meta: 'mod · composer · queue',
    icon: 'list-checks',
  },
  {
    coord: 'A-03',
    title: 'Approvals & telemetry',
    blurb: 'Provider-specific approval modes, inline tool-call approvals, context/token meters, response timers, and a cumulative turn timer.',
    meta: 'mod · approvals · telemetry',
    icon: 'shield-check',
  },
  {
    coord: 'B-01',
    title: 'Monaco editor & diffs',
    blurb: 'Tabs, syntax highlighting, unsaved-change protection, side-by-side and unified diffs. Open file links from chat, expand snippets to fullscreen.',
    meta: 'mod · editor · diff',
    icon: 'git-compare-arrows',
  },
  {
    coord: 'B-02',
    title: 'Integrated PTY terminal',
    blurb: 'A real PTY terminal — XTerm.js, interactive shell, clickable links, true-color rendering. Runs in your project root, always ready.',
    meta: 'mod · terminal · pty',
    icon: 'terminal',
  },
  {
    coord: 'B-03',
    title: 'First-class Git',
    blurb: 'Stage, commit, branch, push, pull, discard, and review diffs from the sidebar. Background status refresh. Provider-generated commit messages on demand.',
    meta: 'mod · git · sidebar',
    icon: 'git-branch',
  },
  {
    coord: 'C-01',
    title: 'Project-wide search/replace',
    blurb: 'Regex, case, whole-word toggles. Results grouped by file. Inline replace across unsaved buffers in the editor.',
    meta: 'mod · search · replace',
    icon: 'search',
  },
  {
    coord: 'C-02',
    title: 'Plugins & MCP servers',
    blurb: 'Install Claude Code plugins and MCP servers from inside SAI. Dedicated sidebars for installed servers and registry browsing.',
    meta: 'mod · plugins · mcp',
    icon: 'blocks',
  },
];
