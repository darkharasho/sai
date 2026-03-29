<p align="center">
  <img src="public/img/sai.png" alt="SAI Logo" width="180" />
</p>

<h1 align="center">SAI — Simple AI</h1>

<p align="center">
  <strong>The AI-first code editor that puts Claude right where you work.</strong>
</p>

<p align="center">
  <a href="https://github.com/darkharasho/sai/releases/latest"><img src="https://img.shields.io/github/v/release/darkharasho/sai?style=flat-square&color=c8943e" alt="Latest Release" /></a>
  <a href="https://github.com/darkharasho/sai/blob/main/LICENSE"><img src="https://img.shields.io/github/license/darkharasho/sai?style=flat-square" alt="License" /></a>
  <a href="https://github.com/darkharasho/sai/releases"><img src="https://img.shields.io/github/downloads/darkharasho/sai/total?style=flat-square&color=c8943e" alt="Downloads" /></a>
</p>

---

## Stop context-switching. Start shipping.

SAI is a desktop code editor built from the ground up around AI. No plugins. No bolt-on copilots. Just a seamless environment where you chat with Claude, edit code, run commands, and manage Git — all without ever leaving the window.

Open a project, ask Claude to build a feature, and watch it happen in real time. Review diffs, stage changes, commit — done. That's SAI.

---

## Features

### Chat with Claude, in context
Converse with Claude directly inside your editor. SAI sends your full project context so Claude understands your codebase — not just the snippet you pasted. Stream responses in real time, attach images, and pick up where you left off with persistent sessions.

### Built-in code editor
A full Monaco-powered editor with syntax highlighting, tabs, and split diff views. See exactly what Claude changed with inline diffs — unified or side-by-side. Expand any code block to a fullscreen view when you need to focus.

### Integrated terminal
A real terminal, not a toy. Full PTY support, interactive shell, clickable links, and proper color rendering — powered by XTerm.js. Runs in your project directory, ready when you need it.

### First-class Git integration
Stage files, switch branches, commit, push, and pull — all from the sidebar. See your change status at a glance, review diffs before committing, and let Claude generate commit messages for you. Real-time polling keeps everything in sync.

### File explorer with drag-and-drop
Browse, create, rename, and delete files without touching the terminal. Drag and drop to reorganize. Right-click for quick actions. Everything stays anchored to your project root.

### Auto-updates
SAI checks for updates automatically and installs them seamlessly. Always on the latest version, zero effort.

---

## Quick start

### Download

Grab the latest release for your platform:

- **Linux** — [AppImage](https://github.com/darkharasho/sai/releases/latest)
- **Windows** — [Installer](https://github.com/darkharasho/sai/releases/latest)

### Prerequisites

SAI uses the [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) under the hood. Make sure you have it installed and authenticated before launching.

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
