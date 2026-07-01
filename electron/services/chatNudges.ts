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
 */
export const CHAT_TASKS_NUDGE =
  'For any multi-step piece of work (3+ distinct steps, refactors, features, ' +
  'debugging sessions), track your progress with the task tools: create tasks with ' +
  'TaskCreate before you start, mark each in_progress/completed with TaskUpdate as ' +
  'you go (or use TodoWrite where the task tools are unavailable). SAI renders a ' +
  'live progress ring from these — without them the user cannot see plan progress. ' +
  'Skip them only for single-step or purely conversational requests.';

export const CHAT_GITHUB_WATCH_NUDGE =
  'After you run `git push` (including pushing tags) or otherwise trigger a GitHub Actions ' +
  'workflow (gh workflow run, gh pr create, creating a release), show the user a live CI ' +
  'watcher card with the sai_watch_github_run tool instead of pasting a gh run URL. If the ' +
  'tool is deferred, load it via ToolSearch first. Resolve the run by owner+repo+branch ' +
  '(optionally a workflow file) or by run URL; the card keeps updating on its own. Only fall ' +
  'back to a plain Actions link if the tool is unavailable.';
