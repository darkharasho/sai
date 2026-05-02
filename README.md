<p align="center">
  <img src="public/img/sai.png" alt="SAI Logo" width="180" />
</p>

<h1 align="center">SAI — Simply AI</h1>

<p align="center">
  <strong>The AI-first code editor that puts your preferred AI provider right where you work.</strong>
</p>

<p align="center">
  <a href="https://github.com/darkharasho/sai/releases/latest"><img src="https://img.shields.io/github/v/release/darkharasho/sai?style=flat-square&color=c8943e" alt="Latest Release" /></a>
  <a href="https://github.com/darkharasho/sai/blob/main/LICENSE"><img src="https://img.shields.io/github/license/darkharasho/sai?style=flat-square" alt="License" /></a>
  <a href="https://github.com/darkharasho/sai/releases"><img src="https://img.shields.io/github/downloads/darkharasho/sai/total?style=flat-square&color=c8943e" alt="Downloads" /></a>
</p>

---

## Stop context-switching. Start shipping.

SAI is a desktop code editor built from the ground up around AI. No plugins. No bolt-on copilots. Just a seamless environment where you chat with Claude, Codex, or Gemini, edit code, run commands, and manage Git — all without ever leaving the window.

Open a project, pick your provider, ask it to build a feature, and watch it happen in real time. Review diffs, stage changes, commit — done. That's SAI.

<img width="1400" height="900" alt="image" src="https://github.com/user-attachments/assets/d92d5d2e-a51e-4145-8237-560e18dbadb7" />

---

## Features

### Bring your preferred AI CLI
Use Claude, Codex CLI, or Gemini CLI in the chat panel and switch providers from Settings at any time. SAI keeps provider-specific models, approval controls, and conversation preferences separate, so swapping backends does not mean rebuilding your setup.

### Multi-project workspaces
Keep multiple projects open in one app window and jump between them from the workspace switcher. Active workspaces show live status, background completions surface as notifications, and idle projects can be suspended automatically or manually to free resources.

### Chat with real project context
Talk to your assistant inside the editor with your repository context already attached. SAI supports streaming responses, image attachments, file-aware prompting, persistent sessions, and a built-in chat history menu so you can resume past conversations without losing your place.

### Review approvals, usage, and context in real time
Stay in control while the model works. SAI exposes provider-specific approval modes, an inline approval panel for tool calls, context and token usage indicators, effort controls, and model pickers so you can trade off speed, cost, and autonomy without leaving the composer.

### Built-in editor and diff review
A full Monaco-powered editor with tabs, syntax highlighting, unsaved-change protection, and side-by-side or unified diff views. Open file links directly from chat, inspect generated patches, and expand embedded code blocks into a focused fullscreen editor when you need room.

### Integrated terminal
A real terminal, not a toy. Full PTY support, interactive shell, clickable links, localhost URLs, and proper color rendering — powered by XTerm.js. It runs in your project directory and is ready whenever the task needs a command instead of a prompt.

### First-class Git integration
Stage files, commit all, switch or create branches, push, pull, discard changes, and review diffs from the sidebar. SAI keeps Git status fresh with background refreshes and can generate commit messages for you using the active provider once your changes are staged.

### File explorer with drag-and-drop
Browse, create, rename, delete, and reorganize files without touching the terminal. Drag and drop entries to move them, use context menus for quick actions, and keep everything anchored to the current project root.

### Synced settings, notifications, and updates
Sign in with GitHub to sync settings through a private `sai-config` repo across devices. SAI can send desktop notifications when background responses finish, badges active workspaces in the UI, and checks for app updates automatically.

---

## Quick start

### Download

Grab the latest release for your platform:

- **Linux** — [AppImage](https://github.com/darkharasho/sai/releases/latest)
- **Windows** — [Installer](https://github.com/darkharasho/sai/releases/latest)

### Prerequisites

SAI supports multiple chat backends. Install and authenticate the CLI for whichever provider you want to use:

- **Claude** — [Claude CLI](https://docs.anthropic.com/en/docs/claude-code)
- **Codex** — [Codex CLI](https://developers.openai.com/codex/cli)
- **Gemini** — [Gemini CLI](https://geminicli.com/)

You can switch providers any time from `Settings → AI Provider → Chat provider`.

Optional: sign in with GitHub inside SAI to enable cross-device settings sync.

### Build from source

```bash
git clone https://github.com/darkharasho/sai.git
cd sai
npm install
npm run electron:dev     # development
npm run dist             # build distributable
```

---

## Tech stack

| Layer     | Technology                              |
|-----------|-----------------------------------------|
| Framework | Electron 33                             |
| Frontend  | React 19, TypeScript 5.7, Vite 6       |
| Editor    | Monaco Editor                           |
| Terminal  | XTerm.js + node-pty                     |
| Git       | simple-git                              |
| Syntax    | Shiki, rehype-highlight                 |
| Diffs     | diff2html                               |
| Updates   | electron-updater                        |

---

## Contributing

Contributions are welcome. Fork the repo, create a branch, and open a PR.

```bash
git checkout -b my-feature
# make your changes
npm run build            # make sure it compiles
```

---

## License

See [LICENSE](LICENSE) for details.

---

<p align="center">
  <sub>Built for developers who'd rather ship than configure.</sub>
</p>
