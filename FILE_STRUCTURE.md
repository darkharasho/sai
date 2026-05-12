# File Structure

Generated with `tree` (excluding node_modules, .git, dist, build, out, coverage, caches).

```
.
├── .claude
│   ├── skills
│   │   └── release
│   │       └── SKILL.md
│   └── worktrees
│       └── autocorrect
├── docs
│   ├── superpowers
│   │   ├── plans
│   │   │   ├── 2026-03-28-chat-history.md
│   │   │   ├── 2026-03-28-diff-viewer.md
│   │   │   ├── 2026-03-28-file-explorer.md
│   │   │   ├── 2026-03-28-multi-project-workspaces.md
│   │   │   ├── 2026-03-28-vsai-desktop-app.md
│   │   │   ├── 2026-03-29-context-management-parity.md
│   │   │   ├── 2026-03-29-gemini-cli-integration.md
│   │   │   ├── 2026-03-29-git-fetch-file-watch.md
│   │   │   ├── 2026-03-29-optimize-token-usage.md
│   │   │   ├── 2026-03-29-workspace-suspend-button.md
│   │   │   ├── 2026-03-30-approval-panel.md
│   │   │   ├── 2026-03-30-commit-message-provider.md
│   │   │   ├── 2026-03-31-comprehensive-testing.md
│   │   │   ├── 2026-03-31-release-notes-modal.md
│   │   │   ├── 2026-04-01-autocorrect.md
│   │   │   ├── 2026-04-01-markdown-preview.md
│   │   │   ├── 2026-04-02-message-queue.md
│   │   │   ├── 2026-04-02-settings-sidebar.md
│   │   │   ├── 2026-04-02-terminal-last-command.md
│   │   │   ├── 2026-04-03-loud-approval-indicators.md
│   │   │   ├── 2026-04-03-terminal-tabs.md
│   │   │   ├── 2026-04-05-terminal-mode.md
│   │   │   ├── 2026-04-06-tab-sequential-numbering-and-rename.md
│   │   │   ├── 2026-04-06-terminal-native-mode.md
│   │   │   ├── 2026-04-07-command-palette.md
│   │   │   ├── 2026-04-08-chat-history-sidebar.md
│   │   │   ├── 2026-04-08-terminal-isolation.md
│   │   │   ├── 2026-04-12-gemini-acp-provider.md
│   │   │   ├── 2026-04-12-harden-rate-limit-tracking.md
│   │   │   ├── 2026-04-13-indexeddb-migration.md
│   │   │   ├── 2026-04-13-monaco-diff-git-gutter.md
│   │   │   ├── 2026-04-13-window-state-persistence.md
│   │   │   ├── 2026-04-14-image-viewer.md
│   │   │   ├── 2026-04-14-remove-terminal-mode.md
│   │   │   ├── 2026-04-15-plugins-mcp-sidebars.md
│   │   │   ├── 2026-04-17-git-sidebar-redesign.md
│   │   │   ├── 2026-04-22-default-project-dir.md
│   │   │   ├── 2026-04-22-new-project-scaffold.md
│   │   │   ├── 2026-04-27-find-replace.md
│   │   │   ├── 2026-04-27-keybindings.md
│   │   │   ├── 2026-04-27-unskip-e2e-tests.md
│   │   │   ├── 2026-05-01-user-message-flip-animation.md
│   │   │   ├── 2026-05-02-assistant-text-api-error-routing.md
│   │   │   ├── 2026-05-02-bypass-queue-on-enter.md
│   │   │   ├── 2026-05-02-chat-animation-redesign.md
│   │   │   ├── 2026-05-02-error-card-redesign.md
│   │   │   ├── 2026-05-02-fake-error-slash-command.md
│   │   │   ├── 2026-05-02-follow-button.md
│   │   │   ├── 2026-05-02-queue-badge.md
│   │   │   ├── 2026-05-02-todo-ring.md
│   │   │   ├── 2026-05-03-thinking-animation-telemetry.md
│   │   │   ├── 2026-05-10-marketing-site.md
│   │   │   ├── 2026-05-11-orchestrator-mcp.md
│   │   │   └── 2026-05-11-swarm-mode.md
│   │   └── specs
│   │       ├── 2026-03-28-chat-history-design.md
│   │       ├── 2026-03-28-diff-viewer-design.md
│   │       ├── 2026-03-28-file-explorer-design.md
│   │       ├── 2026-03-28-multi-project-workspaces-design.md
│   │       ├── 2026-03-28-release-workflow-design.md
│   │       ├── 2026-03-28-vsai-desktop-app-design.md
│   │       ├── 2026-03-29-context-management-parity-design.md
│   │       ├── 2026-03-29-gemini-cli-integration-design.md
│   │       ├── 2026-03-29-git-fetch-file-watch-design.md
│   │       ├── 2026-03-29-optimize-token-usage-design.md
│   │       ├── 2026-03-29-workspace-suspend-button-design.md
│   │       ├── 2026-03-30-approval-panel-design.md
│   │       ├── 2026-03-30-commit-message-provider-design.md
│   │       ├── 2026-03-31-comprehensive-testing-design.md
│   │       ├── 2026-03-31-release-notes-modal-design.md
│   │       ├── 2026-04-01-autocorrect-design.md
│   │       ├── 2026-04-01-markdown-preview-design.md
│   │       ├── 2026-04-02-message-queue-design.md
│   │       ├── 2026-04-02-settings-sidebar-design.md
│   │       ├── 2026-04-02-terminal-last-command-design.md
│   │       ├── 2026-04-03-loud-approval-indicators-design.md
│   │       ├── 2026-04-03-terminal-tabs-design.md
│   │       ├── 2026-04-05-terminal-mode-design.md
│   │       ├── 2026-04-06-tab-sequential-numbering-and-rename-design.md
│   │       ├── 2026-04-06-terminal-native-mode-design.md
│   │       ├── 2026-04-07-command-palette-design.md
│   │       ├── 2026-04-08-chat-history-sidebar-design.md
│   │       ├── 2026-04-08-terminal-isolation-design.md
│   │       ├── 2026-04-12-gemini-acp-provider-design.md
│   │       ├── 2026-04-12-harden-rate-limit-tracking-design.md
│   │       ├── 2026-04-13-indexeddb-migration-design.md
│   │       ├── 2026-04-13-monaco-diff-git-gutter-design.md
│   │       ├── 2026-04-13-window-state-persistence-design.md
│   │       ├── 2026-04-14-image-viewer-design.md
│   │       ├── 2026-04-14-remove-terminal-mode-design.md
│   │       ├── 2026-04-15-plugins-mcp-sidebars-design.md
│   │       ├── 2026-04-17-git-sidebar-redesign.md
│   │       ├── 2026-04-22-new-project-scaffold-design.md
│   │       ├── 2026-04-27-find-replace-design.md
│   │       ├── 2026-04-27-keybindings-design.md
│   │       ├── 2026-05-01-user-message-flip-animation-design.md
│   │       ├── 2026-05-02-assistant-text-api-error-routing-design.md
│   │       ├── 2026-05-02-bypass-queue-on-enter-design.md
│   │       ├── 2026-05-02-chat-animation-redesign-design.md
│   │       ├── 2026-05-02-error-card-redesign-design.md
│   │       ├── 2026-05-02-fake-error-slash-command-design.md
│   │       ├── 2026-05-02-follow-button-design.md
│   │       ├── 2026-05-02-queue-badge-design.md
│   │       ├── 2026-05-02-todo-ring-design.md
│   │       ├── 2026-05-03-thinking-animation-telemetry-design.md
│   │       ├── 2026-05-10-marketing-site-design.md
│   │       └── 2026-05-11-swarm-mode-design.md
│   └── text-classification-plan.md
├── electron
│   ├── services
│   │   ├── claude.ts
│   │   ├── codex.ts
│   │   ├── commit-message-parser.ts
│   │   ├── fs.ts
│   │   ├── gemini-acp.ts
│   │   ├── gemini.ts
│   │   ├── github-auth.ts
│   │   ├── github-sync.ts
│   │   ├── git.ts
│   │   ├── mcp.ts
│   │   ├── notify.ts
│   │   ├── plugins.ts
│   │   ├── pty.ts
│   │   ├── scaffold.ts
│   │   ├── search.ts
│   │   ├── swarmMcpConfig.ts
│   │   ├── swarmMcpHost.ts
│   │   ├── swarm.ts
│   │   ├── updater.ts
│   │   ├── usage.ts
│   │   └── workspace.ts
│   ├── main.ts
│   ├── preload.ts
│   └── swarm-mcp-server.ts
├── .github
│   └── workflows
│       ├── deploy-site.yml
│       ├── release.yml
│       └── test.yml
├── public
│   ├── fonts
│   │   ├── DepartureMono-Regular.woff2
│   │   ├── GeistMono-Variable.woff2
│   │   └── Geist-Variable.woff2
│   ├── img
│   │   └── sai.png
│   └── svg
│       ├── claude.svg
│       ├── dot.svg
│       ├── Google-gemini-icon.svg
│       ├── openai.svg
│       ├── sai-gold.svg
│       ├── sai-new-2.svg
│       ├── sai-new-mock.html
│       ├── sai-new.svg
│       ├── sai.svg
│       └── sai-thinking-variants.html
├── scripts
│   ├── check-no-skipped-e2e.sh
│   └── fake-update.js
├── site
│   ├── public
│   │   ├── img
│   │   │   ├── sai.png
│   │   │   ├── screenshot-2.png
│   │   │   └── screenshot.png
│   │   ├── favicon.svg
│   │   └── robots.txt
│   ├── src
│   │   ├── components
│   │   │   ├── Download.astro
│   │   │   ├── FeatureCard.astro
│   │   │   ├── FeatureGrid.astro
│   │   │   ├── Footer.astro
│   │   │   ├── Hero.astro
│   │   │   ├── Marquee.astro
│   │   │   ├── MissionClock.astro
│   │   │   ├── Providers.astro
│   │   │   ├── SaiMark.astro
│   │   │   └── Screenshot.astro
│   │   ├── data
│   │   │   └── features.ts
│   │   ├── layouts
│   │   │   └── Layout.astro
│   │   ├── pages
│   │   │   └── index.astro
│   │   ├── styles
│   │   │   ├── global.css
│   │   │   └── sai-logo.css
│   │   └── env.d.ts
│   ├── astro.config.mjs
│   ├── .gitignore
│   ├── package.json
│   ├── package-lock.json
│   └── tsconfig.json
├── src
│   ├── components
│   │   ├── Chat
│   │   │   ├── ApprovalPanel.tsx
│   │   │   ├── ChatHistoryContextMenu.tsx
│   │   │   ├── ChatHistorySidebar.tsx
│   │   │   ├── ChatInput.tsx
│   │   │   ├── ChatMessage.tsx
│   │   │   ├── ChatPanel.tsx
│   │   │   ├── flipRegistry.ts
│   │   │   ├── helpText.ts
│   │   │   ├── MessageQueue.tsx
│   │   │   ├── MotionPresence.tsx
│   │   │   ├── motion.ts
│   │   │   ├── parseAiError.ts
│   │   │   ├── Stagger.tsx
│   │   │   ├── TodoProgress.tsx
│   │   │   └── ToolCallCard.tsx
│   │   ├── CodePanel
│   │   │   ├── CodePanel.tsx
│   │   │   ├── DiffViewer.tsx
│   │   │   ├── ImageViewer.tsx
│   │   │   └── MarkdownPreview.tsx
│   │   ├── FileExplorer
│   │   │   ├── ContextMenu.tsx
│   │   │   ├── FileExplorerSidebar.tsx
│   │   │   └── MonacoEditor.tsx
│   │   ├── Git
│   │   │   ├── ChangedFiles.tsx
│   │   │   ├── CommitBox.tsx
│   │   │   ├── ConflictHunkViewer.tsx
│   │   │   ├── ConflictSection.tsx
│   │   │   ├── DiscardChangesModal.tsx
│   │   │   ├── FileSearch.tsx
│   │   │   ├── GitActivity.tsx
│   │   │   ├── GitHistory.tsx
│   │   │   ├── GitSidebar.tsx
│   │   │   ├── InlineDiff.tsx
│   │   │   ├── RebaseControls.tsx
│   │   │   └── StashMenu.tsx
│   │   ├── MCP
│   │   │   ├── McpAddServer.tsx
│   │   │   ├── McpDetail.tsx
│   │   │   ├── McpIcon.tsx
│   │   │   ├── McpRegistryDetail.tsx
│   │   │   └── McpSidebar.tsx
│   │   ├── Plugins
│   │   │   ├── PluginDetail.tsx
│   │   │   ├── PluginIcon.tsx
│   │   │   ├── PluginRegistryDetail.tsx
│   │   │   └── PluginsSidebar.tsx
│   │   ├── SearchPanel
│   │   │   ├── SearchPanel.css
│   │   │   ├── SearchPanel.tsx
│   │   │   └── SearchResult.tsx
│   │   ├── Settings
│   │   │   ├── KeybindingsPage.css
│   │   │   ├── KeybindingsPage.tsx
│   │   │   └── SwarmSettings.tsx
│   │   ├── Swarm
│   │   │   ├── cards
│   │   │   │   ├── ApprovalActionCard.tsx
│   │   │   │   ├── AutoApprovedCard.tsx
│   │   │   │   ├── BatchCompleteCard.tsx
│   │   │   │   ├── cardStyles.ts
│   │   │   │   ├── DiscardCard.tsx
│   │   │   │   ├── InlineApprovalCard.tsx
│   │   │   │   ├── LandCard.tsx
│   │   │   │   ├── PauseResumeCard.tsx
│   │   │   │   ├── QueryStatusCard.tsx
│   │   │   │   ├── SpawnTaskCard.tsx
│   │   │   │   ├── SwarmToolCardSelector.tsx
│   │   │   │   ├── TaskCompletedCard.tsx
│   │   │   │   └── TaskFailedCard.tsx
│   │   │   ├── ActivityRibbon.tsx
│   │   │   ├── ApprovalTray.tsx
│   │   │   ├── NewTaskPopover.tsx
│   │   │   ├── OrchestratorComposer.tsx
│   │   │   ├── OrchestratorModelPicker.tsx
│   │   │   ├── OrchestratorView.tsx
│   │   │   ├── QuitSwarmConfirmModal.tsx
│   │   │   ├── ReadyToLandTray.tsx
│   │   │   ├── RecentActivity.tsx
│   │   │   ├── Sparkline.tsx
│   │   │   ├── StatStrip.tsx
│   │   │   ├── SwarmDiffModal.tsx
│   │   │   ├── SwarmLogoCluster.tsx
│   │   │   ├── SwarmSidebar.tsx
│   │   │   ├── SwarmTaskHeader.tsx
│   │   │   └── SwarmTaskRow.tsx
│   │   ├── Terminal
│   │   │   └── TerminalPanel.tsx
│   │   ├── ApprovalBanner.tsx
│   │   ├── CloseWorkspaceModal.tsx
│   │   ├── CommandPalette.tsx
│   │   ├── GitHubAuthModal.tsx
│   │   ├── GitHubCloneModal.tsx
│   │   ├── NavBar.tsx
│   │   ├── NewProjectModal.tsx
│   │   ├── SaiLogo.css
│   │   ├── SaiLogo.tsx
│   │   ├── SettingsModal.tsx
│   │   ├── ThinkingAnimation.tsx
│   │   ├── TitleBar.tsx
│   │   ├── UnsavedChangesModal.tsx
│   │   ├── UpdateNotification.tsx
│   │   ├── WhatsNewModal.tsx
│   │   └── WorkspaceToast.tsx
│   ├── hooks
│   │   ├── useKeybinding.ts
│   │   ├── useSearch.ts
│   │   └── useWhatsNew.ts
│   ├── lib
│   │   ├── assets.ts
│   │   ├── orchestratorSlashCommands.ts
│   │   ├── orchestratorSystemPrompt.ts
│   │   ├── orchestratorToolDrift.ts
│   │   ├── swarmActivityHistory.ts
│   │   ├── swarmApprovalPolicy.ts
│   │   ├── swarmLanding.ts
│   │   ├── swarmOrchestratorDispatcher.ts
│   │   ├── swarmOrchestratorRouter.ts
│   │   ├── swarmOrchestratorSession.ts
│   │   ├── swarmOrchestratorTools.ts
│   │   ├── swarmReconcile.ts
│   │   ├── swarmRef.ts
│   │   ├── swarmScheduler.ts
│   │   ├── swarmSlug.ts
│   │   ├── swarmStatusMirror.ts
│   │   ├── swarmTaskMessageBuffer.ts
│   │   └── swarmTaskRunner.ts
│   ├── styles
│   │   ├── fonts.ts
│   │   └── globals.css
│   ├── utils
│   │   ├── fuzzyMatch.ts
│   │   ├── imageFiles.ts
│   │   ├── keybindings.ts
│   │   ├── monacoEditorRegistry.ts
│   │   └── pathUtils.ts
│   ├── App.tsx
│   ├── chatDb.ts
│   ├── main.tsx
│   ├── sessions.ts
│   ├── swarmDb.ts
│   ├── terminalBuffer.ts
│   ├── themes.ts
│   ├── types.ts
│   ├── vite-env.d.ts
│   └── workspaceFlush.ts
├── tests
│   ├── e2e
│   │   ├── fixtures
│   │   │   ├── test-project
│   │   │   │   ├── src
│   │   │   │   │   └── index.ts
│   │   │   │   ├── package.json
│   │   │   │   └── README.md
│   │   │   └── setup-git-fixture.sh
│   │   ├── helpers
│   │   │   └── mock-events.ts
│   │   ├── chat.spec.ts
│   │   ├── electron.setup.ts
│   │   ├── file-explorer.spec.ts
│   │   ├── git.spec.ts
│   │   ├── keybindings.spec.ts
│   │   ├── search.spec.ts
│   │   ├── settings.spec.ts
│   │   ├── swarm.spec.ts
│   │   ├── terminal.spec.ts
│   │   └── workspace.spec.ts
│   ├── helpers
│   │   ├── electron-mock.ts
│   │   ├── ipc-mock.ts
│   │   ├── process-mock.ts
│   │   └── test-utils.tsx
│   ├── integration
│   │   ├── ipc-approval.test.ts
│   │   ├── ipc-slash-commands.test.ts
│   │   ├── ipc-streaming.test.ts
│   │   ├── search.test.ts
│   │   └── workspace-lifecycle.test.ts
│   ├── setup
│   │   └── vitest.setup.ts
│   ├── swarm
│   │   ├── ActivityRibbon.test.tsx
│   │   ├── ApprovalTray.test.tsx
│   │   ├── AppSwarmWiring.test.tsx
│   │   ├── BatchCompleteCard.test.tsx
│   │   ├── claudeOrchestratorStart.test.ts
│   │   ├── InlineLifecycleCards.test.tsx
│   │   ├── lazyWorktree.test.ts
│   │   ├── NavBar.swarm.test.tsx
│   │   ├── NewTaskPopover.test.tsx
│   │   ├── OrchestratorModelPicker.test.tsx
│   │   ├── orchestratorSession.test.ts
│   │   ├── orchestratorSlashCommands.test.ts
│   │   ├── orchestratorSystemPrompt.test.ts
│   │   ├── orchestratorToolDrift.test.ts
│   │   ├── OrchestratorView.test.tsx
│   │   ├── QuitSwarmConfirmModal.test.tsx
│   │   ├── ReadyToLandTray.test.tsx
│   │   ├── RecentActivity.test.tsx
│   │   ├── Sparkline.test.tsx
│   │   ├── StatStrip.test.tsx
│   │   ├── swarmActivityHistory.test.ts
│   │   ├── swarmApprovalPolicy.test.ts
│   │   ├── SwarmCards.test.tsx
│   │   ├── swarmDb.test.ts
│   │   ├── swarm.electron.test.ts
│   │   ├── swarmLanding.test.ts
│   │   ├── swarmMcpProtocol.test.ts
│   │   ├── swarmOrchestratorDispatcher.test.ts
│   │   ├── swarmOrchestratorRouter.test.ts
│   │   ├── swarmOrchestratorTools.test.ts
│   │   ├── swarmReconcile.test.ts
│   │   ├── swarmRef.test.ts
│   │   ├── swarmScheduler.test.ts
│   │   ├── SwarmSettings.test.tsx
│   │   ├── SwarmSidebar.test.tsx
│   │   ├── swarmSlug.test.ts
│   │   ├── swarmStatusMirror.test.ts
│   │   ├── SwarmTaskHeader.test.tsx
│   │   ├── swarmTaskMessageBuffer.test.ts
│   │   ├── swarmTaskRunner.test.ts
│   │   └── types.test.ts
│   └── unit
│       ├── components
│       │   ├── Chat
│       │   │   ├── ApprovalPanel.test.tsx
│       │   │   ├── ChatHistoryContextMenu.test.tsx
│       │   │   ├── ChatHistorySidebar.test.tsx
│       │   │   ├── ChatInput.test.tsx
│       │   │   ├── ChatMessage.test.tsx
│       │   │   ├── ChatPanel.test.tsx
│       │   │   ├── flipRegistry.test.ts
│       │   │   ├── helpText.test.ts
│       │   │   ├── MessageQueue.integration.test.tsx
│       │   │   ├── MessageQueue.test.tsx
│       │   │   ├── MotionPresence.test.tsx
│       │   │   ├── motion.test.ts
│       │   │   ├── parseAiError.test.ts
│       │   │   ├── rateLimitReconciliation.test.ts
│       │   │   ├── Stagger.test.tsx
│       │   │   ├── TodoProgress.test.tsx
│       │   │   └── ToolCallCard.test.tsx
│       │   ├── CodePanel
│       │   │   ├── CodePanel.test.tsx
│       │   │   ├── ImageViewer.test.tsx
│       │   │   └── MarkdownPreview.test.tsx
│       │   ├── FileExplorer
│       │   │   └── FileExplorer.test.tsx
│       │   ├── Git
│       │   │   ├── ConflictHunkViewer.test.tsx
│       │   │   ├── ConflictSection.test.tsx
│       │   │   ├── DiffViewer.test.tsx
│       │   │   ├── FileSearch.test.tsx
│       │   │   ├── GitSidebar.test.tsx
│       │   │   ├── InlineDiff.test.tsx
│       │   │   ├── RebaseControls.test.tsx
│       │   │   └── StashMenu.test.tsx
│       │   ├── MCP
│       │   │   └── McpSidebar.test.tsx
│       │   ├── Plugins
│       │   │   └── PluginsSidebar.test.tsx
│       │   ├── Terminal
│       │   │   └── Terminal.test.tsx
│       │   ├── KeybindingsPage.test.tsx
│       │   ├── NavBar.test.tsx
│       │   ├── SearchPanel.test.tsx
│       │   ├── SearchResult.test.tsx
│       │   ├── SettingsModal.test.tsx
│       │   ├── ThinkingAnimation.test.tsx
│       │   ├── TitleBar.test.tsx
│       │   └── WhatsNewModal.test.tsx
│       ├── hooks
│       │   ├── useKeybinding.test.ts
│       │   ├── useSearch.test.ts
│       │   └── useWhatsNew.test.ts
│       ├── services
│       │   ├── claude.test.ts
│       │   ├── codex.test.ts
│       │   ├── commit-message-parser.test.ts
│       │   ├── fs.test.ts
│       │   ├── gemini-acp.test.ts
│       │   ├── gemini.test.ts
│       │   ├── git.test.ts
│       │   ├── mcp.test.ts
│       │   ├── notify.test.ts
│       │   ├── plugins.test.ts
│       │   ├── pty.test.ts
│       │   ├── search.test.ts
│       │   ├── usage.test.ts
│       │   └── workspace.test.ts
│       ├── utils
│       │   ├── imageFiles.test.ts
│       │   └── keybindings.test.ts
│       ├── chatDb.test.ts
│       ├── preload.test.ts
│       ├── sessions.test.ts
│       ├── terminalBuffer.test.ts
│       └── workspaceFlush.test.ts
├── FILE_STRUCTURE.md
├── .gitignore
├── hello.txt
├── index.html
├── LICENSE
├── package.json
├── package-lock.json
├── playwright.config.ts
├── README.md
├── TODO.md
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
└── vitest.config.ts
```
