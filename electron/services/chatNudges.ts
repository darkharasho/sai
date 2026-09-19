/**
 * System-prompt nudges appended for CHAT sessions. Extracted from claude.ts so
 * both the CLI path (buildArgs --append-system-prompt) and the SDK path
 * (sdkBackend) can import them without a const-eval circular dependency. The CLI
 * tool descriptions carry these triggers too, but deferred tools don't expose
 * descriptions, so we nudge here.
 */
export const CHAT_RENDER_NUDGE =
  'This app (SAI) can render UI live inside its own window. When the user asks you to ' +
  'design, mock up, build, show, preview, or iterate on a UI element, component, page, ' +
  'or visual style, FIRST render it in-app with the render_html tool (write a ' +
  'self-contained HTML/CSS/JS snippet) — or render_component to mount a registered ' +
  'project component — so the user can see it and give feedback. This also applies when ' +
  'asked to screenshot, capture, verify, or otherwise show a working or finished UI ' +
  'result: prefer the in-app renderer, which returns the screenshot to you directly, over ' +
  'spinning up an external browser (Playwright/Chrome) or a separate server. Prefer ' +
  'rendering over writing files for these requests; only write or scaffold files when the ' +
  'user explicitly asks to save, add, or wire the component into the codebase. You can ' +
  're-render to iterate on feedback.';

/**
 * Newer Opus models under-reach for the task tools without an explicit trigger
 * (the interactive CLI injects "consider using TaskCreate" reminders; headless
 * SDK/stream-json sessions do not), which left SAI's task-progress ring —
 * driven by TaskCreate/TaskUpdate/TodoWrite calls — permanently empty.
 *
 * Deliberately tool-AGNOSTIC: which tracker is registered varies by backend and
 * CLI version (Claude CLI 2.1.266 ships neither TaskCreate nor TodoWrite; Codex
 * has its own plan tool, which SAI maps to synthetic TodoWrite calls). Naming
 * one made the model hunt for a missing tool and narrate its absence to the
 * user ("Task tools aren't available this session..."), so the wording asks for
 * whatever tracker exists and says to stay quiet when none does.
 */
export const CHAT_TASKS_NUDGE =
  'For any multi-step piece of work (3+ distinct steps, refactors, features, ' +
  'debugging sessions), track your progress with whichever task/todo tracking tool ' +
  'this session registers (TaskCreate + TaskUpdate, TodoWrite, or your plan tool): ' +
  'lay out the steps before you start and mark each in_progress/completed as you go. ' +
  'SAI renders a live progress ring from those calls. Skip tracking for single-step ' +
  'or purely conversational requests — and if no such tool is registered in this ' +
  'session, just do the work without one and do not mention the tool or its absence ' +
  'to the user.';

export const CHAT_GITHUB_WATCH_NUDGE =
  'After you run `git push` (including pushing tags) or otherwise trigger a GitHub Actions ' +
  'workflow (gh workflow run, gh pr create, creating a release), show the user a live CI ' +
  'watcher card with the sai_watch_github_run tool instead of pasting a gh run URL. If the ' +
  'tool is deferred, load it via ToolSearch first. Resolve the run by owner+repo+branch ' +
  '(optionally a workflow file) or by run URL; the card keeps updating on its own. Only fall ' +
  'back to a plain Actions link if the tool is unavailable.';
