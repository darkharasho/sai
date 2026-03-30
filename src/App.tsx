import { useState, useCallback, useEffect, useRef } from 'react';
import NavBar from './components/NavBar';
import ChatPanel from './components/Chat/ChatPanel';
import TerminalPanel from './components/Terminal/TerminalPanel';
import GitSidebar from './components/Git/GitSidebar';
import FileExplorerSidebar from './components/FileExplorer/FileExplorerSidebar';
import TitleBar from './components/TitleBar';
import CodePanel from './components/CodePanel/CodePanel';
import UnsavedChangesModal from './components/UnsavedChangesModal';
import WorkspaceToast from './components/WorkspaceToast';
import { loadSessions, saveSessions, createSession, upsertSession, migrateLegacySessions, loadSessionMessages } from './sessions';
import type { ChatSession, ChatMessage, GitFile, OpenFile, WorkspaceContext } from './types';
import { MessageSquare, TerminalSquare, Code2, ChevronRight, MessageCirclePlus, Clock } from 'lucide-react';
import { formatSessionDate, formatSessionTime } from './sessions';

type PermissionMode = 'default' | 'bypass';
type EffortLevel = 'low' | 'medium' | 'high' | 'max';
type ModelChoice = 'sonnet' | 'opus' | 'haiku';
type AIProvider = 'claude' | 'codex' | 'gemini';
type GeminiApprovalMode = 'default' | 'auto_edit' | 'yolo' | 'plan';
type GeminiConversationMode = 'planning' | 'fast';
type CodexPermission = 'auto' | 'read-only' | 'full-access';
type PanelId = 'chat' | 'editor' | 'terminal';

function WelcomeTypewriter() {
  const full = 'Welcome to Simply AI';
  const final = 'Welcome to SAI';
  const [text, setText] = useState('');
  const shared = 'Welcome to S';
  const [phase, setPhase] = useState<'typing' | 'deleting' | 'retyping' | 'done' | 'hidden'>('typing');

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    if (phase === 'typing') {
      if (text.length < full.length) {
        timeout = setTimeout(() => setText(full.slice(0, text.length + 1)), 60);
      } else {
        timeout = setTimeout(() => setPhase('deleting'), 1500);
      }
    } else if (phase === 'deleting') {
      if (text.length > shared.length) {
        timeout = setTimeout(() => setText(text.slice(0, -1)), 40);
      } else {
        setPhase('retyping');
      }
    } else if (phase === 'retyping') {
      if (text.length < final.length) {
        timeout = setTimeout(() => setText(final.slice(0, text.length + 1)), 60);
      } else {
        timeout = setTimeout(() => setPhase('done'), 0);
      }
    } else if (phase === 'done') {
      timeout = setTimeout(() => setPhase('hidden'), 2000);
    }
    return () => clearTimeout(timeout);
  }, [text, phase]);

  return (
    <span style={{ fontSize: 24, fontWeight: 600, color: 'var(--accent)' }}>
      {text}
      {phase !== 'hidden' && <span style={{
        display: 'inline-block',
        width: 2,
        height: '1em',
        background: 'var(--accent)',
        marginLeft: 2,
        verticalAlign: 'text-bottom',
        animation: 'cursor-blink 1s step-start infinite',
      }} />}
      <style>{`
        @keyframes cursor-blink {
          0% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </span>
  );
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState<string | null>(null);
  const [activeProjectPath, setActiveProjectPath] = useState<string>('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
  const [effortLevel, setEffortLevel] = useState<EffortLevel>('high');
  const [modelChoice, setModelChoice] = useState<ModelChoice>('sonnet');
  const [editorFontSize, setEditorFontSize] = useState(13);
  const [editorMinimap, setEditorMinimap] = useState(true);
  const [aiProvider, setAiProvider] = useState<AIProvider>('claude');
  const [codexModel, setCodexModel] = useState('');
  const [codexModels, setCodexModels] = useState<{ id: string; name: string }[]>([]);
  const [codexPermission, setCodexPermission] = useState<CodexPermission>('auto');
  const [geminiModel, setGeminiModel] = useState('auto-gemini-3');
  const [geminiModels, setGeminiModels] = useState<{ id: string; name: string }[]>([]);
  const [geminiApprovalMode, setGeminiApprovalMode] = useState<GeminiApprovalMode>('default');
  const [geminiConversationMode, setGeminiConversationMode] = useState<GeminiConversationMode>('planning');
  const [geminiLoadingPhrases, setGeminiLoadingPhrases] = useState<'witty' | 'tips' | 'all' | 'off'>('all');
  const [workspaces, setWorkspaces] = useState<Map<string, WorkspaceContext>>(new Map());
  const [pendingClose, setPendingClose] = useState<string | null>(null);
  // Ref to hold latest messages per workspace without triggering re-renders during streaming
  const wsMessagesRef = useRef<Map<string, ChatMessage[]>>(new Map());
  const [externallyModified, setExternallyModified] = useState<Set<string>>(new Set());
  const [completedWorkspaces, setCompletedWorkspaces] = useState<Set<string>>(new Set());
  const [busyWorkspaces, setBusyWorkspaces] = useState<Set<string>>(new Set());
  const [focusedChat, setFocusedChat] = useState(false);
  const [toast, setToast] = useState<{ message: string; key: number } | null>(null);
  const workspacesRef = useRef(workspaces);
  const activeProjectPathRef = useRef(activeProjectPath);

  useEffect(() => { workspacesRef.current = workspaces; }, [workspaces]);
  useEffect(() => { activeProjectPathRef.current = activeProjectPath; }, [activeProjectPath]);

  useEffect(() => {
    setExternallyModified(new Set());
  }, [activeProjectPath]);

  const getWorkspace = useCallback((path: string): WorkspaceContext => {
    const existing = workspaces.get(path);
    if (existing) return existing;
    return {
      projectPath: path,
      sessions: [],
      activeSession: createSession(),
      openFiles: [],
      activeFilePath: null,
      terminalIds: [],
      status: 'recent',
      lastActivity: Date.now(),
    };
  }, [workspaces]);

  const activeWorkspace = activeProjectPath ? getWorkspace(activeProjectPath) : null;

  const updateWorkspace = useCallback((path: string, updater: (ws: WorkspaceContext) => WorkspaceContext) => {
    setWorkspaces(prev => {
      const next = new Map(prev);
      const current = next.get(path) || {
        projectPath: path,
        sessions: [],
        activeSession: createSession(),
        openFiles: [],
        activeFilePath: null,
        terminalIds: [],
        status: 'active' as const,
        lastActivity: Date.now(),
      };
      next.set(path, updater(current));
      return next;
    });
  }, []);

  // Derived state for the active workspace
  const projectPath = activeProjectPath;
  const sessions = activeWorkspace?.sessions ?? [];
  const activeSession = activeWorkspace?.activeSession ?? createSession();
  const openFiles = activeWorkspace?.openFiles ?? [];
  const activeFilePath = activeWorkspace?.activeFilePath ?? null;

  // Load persisted settings from main process (file-based, works in dev+prod)
  useEffect(() => {
    window.sai.settingsGet('focusedChat', false).then((v: boolean) => setFocusedChat(v));
    window.sai.settingsGet('editorFontSize', 13).then((v: number) => setEditorFontSize(v));
    window.sai.settingsGet('editorMinimap', true).then((v: boolean) => setEditorMinimap(v));
    window.sai.settingsGet('aiProvider', 'claude').then((v: string) => {
      if (v === 'claude' || v === 'codex' || v === 'gemini') setAiProvider(v as AIProvider);
    });
    // Load nested provider settings
    window.sai.settingsGet('claude', {}).then((c: any) => {
      if (c.model === 'sonnet' || c.model === 'opus' || c.model === 'haiku') setModelChoice(c.model);
      if (c.effort === 'low' || c.effort === 'medium' || c.effort === 'high' || c.effort === 'max') setEffortLevel(c.effort);
      if (c.permission === 'default' || c.permission === 'bypass') setPermissionMode(c.permission);
    });
    window.sai.settingsGet('codex', {}).then((c: any) => {
      if (c.model) setCodexModel(c.model);
      if (c.permission === 'auto' || c.permission === 'read-only' || c.permission === 'full-access') setCodexPermission(c.permission);
    });
    window.sai.settingsGet('gemini', {}).then((g: any) => {
      if (g.model) setGeminiModel(g.model);
      if (g.approvalMode === 'default' || g.approvalMode === 'auto_edit' || g.approvalMode === 'yolo' || g.approvalMode === 'plan') setGeminiApprovalMode(g.approvalMode);
      if (g.conversationMode === 'planning' || g.conversationMode === 'fast') setGeminiConversationMode(g.conversationMode);
      if (g.loadingPhrases === 'witty' || g.loadingPhrases === 'tips' || g.loadingPhrases === 'all' || g.loadingPhrases === 'off') setGeminiLoadingPhrases(g.loadingPhrases);
    });
    // Migrate flat keys to nested (one-time)
    Promise.all([
      window.sai.settingsGet('modelChoice', null),
      window.sai.settingsGet('effortLevel', null),
      window.sai.settingsGet('permissionMode', null),
      window.sai.settingsGet('codexModel', null),
      window.sai.settingsGet('codexPermission', null),
    ]).then(([mc, el, pm, cm, cp]) => {
      if (mc || el || pm) {
        window.sai.settingsGet('claude', {}).then((existing: any) => {
          const claude = { ...existing };
          if (mc && !claude.model) claude.model = mc;
          if (el && !claude.effort) claude.effort = el;
          if (pm && !claude.permission) claude.permission = pm;
          window.sai.settingsSet('claude', claude);
        });
      }
      if (cm || cp) {
        window.sai.settingsGet('codex', {}).then((existing: any) => {
          const codex = { ...existing };
          if (cm && !codex.model) codex.model = cm;
          if (cp && !codex.permission) codex.permission = cp;
          window.sai.settingsSet('codex', codex);
        });
      }
    });

    // Apply settings synced down from GitHub (fires on startup and after manual sync)
    const unsubApplied = window.sai.githubOnSettingsApplied((remote: Record<string, any>) => {
      if ('editorFontSize' in remote) setEditorFontSize(remote.editorFontSize);
      if ('editorMinimap' in remote) setEditorMinimap(remote.editorMinimap);
      if ('aiProvider' in remote && (remote.aiProvider === 'claude' || remote.aiProvider === 'codex' || remote.aiProvider === 'gemini')) setAiProvider(remote.aiProvider);
      if ('claude' in remote && typeof remote.claude === 'object') {
        const c = remote.claude;
        if (c.model === 'sonnet' || c.model === 'opus' || c.model === 'haiku') setModelChoice(c.model);
        if (c.effort === 'low' || c.effort === 'medium' || c.effort === 'high' || c.effort === 'max') setEffortLevel(c.effort);
        if (c.permission === 'default' || c.permission === 'bypass') setPermissionMode(c.permission);
      }
      if ('codex' in remote && typeof remote.codex === 'object') {
        const c = remote.codex;
        if (c.model) setCodexModel(c.model);
        if (c.permission === 'auto' || c.permission === 'read-only' || c.permission === 'full-access') setCodexPermission(c.permission);
      }
      if ('gemini' in remote && typeof remote.gemini === 'object') {
        const g = remote.gemini;
        if (g.model) setGeminiModel(g.model);
        if (g.approvalMode === 'default' || g.approvalMode === 'auto_edit' || g.approvalMode === 'yolo' || g.approvalMode === 'plan') setGeminiApprovalMode(g.approvalMode);
        if (g.conversationMode === 'planning' || g.conversationMode === 'fast') setGeminiConversationMode(g.conversationMode);
      }
    });
    return unsubApplied;
  }, []);

  // Prefetch Codex models once at startup so they're ready when user switches
  useEffect(() => {
    (window.sai as any).codexModels?.().then((result: { models: { id: string; name: string }[]; defaultModel: string }) => {
      if (result?.models?.length) setCodexModels(result.models);
      if (result?.defaultModel) setCodexModel(prev => prev || result.defaultModel);
    });
  }, []);

  // Prefetch Gemini models (hardcoded) at startup
  useEffect(() => {
    (window.sai as any).geminiModels?.().then((result: { models: { id: string; name: string }[]; defaultModel: string }) => {
      if (result?.models?.length) setGeminiModels(result.models);
      if (result?.defaultModel) setGeminiModel(prev => prev || result.defaultModel);
    });
  }, []);

  useEffect(() => {
    window.sai.getCwd().then((cwd: string) => {
      if (cwd) {
        migrateLegacySessions(cwd);
        const sessions = loadSessions(cwd);
        setActiveProjectPath(cwd);
        setWorkspaces(new Map([[cwd, {
          projectPath: cwd,
          sessions,
          activeSession: createSession(),
          openFiles: [],
          activeFilePath: null,
          terminalIds: [],
          status: 'active',
          lastActivity: Date.now(),
        }]]));
      }
    });
  }, []);

  const [gitChangeCount, setGitChangeCount] = useState(0);

  useEffect(() => {
    if (!projectPath) return;
    const poll = () => {
      (window.sai.gitStatus(projectPath) as Promise<any>).then((status: any) => {
        const paths = new Set<string>();
        for (const item of [...(status.staged ?? []), ...(status.modified ?? []), ...(status.created ?? []), ...(status.deleted ?? []), ...(status.not_added ?? [])]) {
          paths.add(typeof item === 'string' ? item : item.path);
        }
        setGitChangeCount(paths.size);
      }).catch(() => {});
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [projectPath]);

  useEffect(() => {
    if (!projectPath) return;
    const id = setInterval(() => {
      (window.sai.gitFetch(projectPath) as Promise<void>).catch(() => {});
    }, 60000);
    return () => clearInterval(id);
  }, [projectPath]);

  useEffect(() => {
    if (!projectPath) return;
    const id = setInterval(async () => {
      const ws = workspacesRef.current.get(projectPath);
      if (!ws) return;
      const editorFiles = ws.openFiles.filter(
        f => f.viewMode === 'editor' && f.diskMtime !== undefined
      );
      for (const file of editorFiles) {
        try {
          const { mtime } = await (window.sai.fsMtime(file.path) as Promise<{ mtime: number }>);
          if (mtime <= file.diskMtime!) continue;
          if (!file.isDirty) {
            const content = await (window.sai.fsReadFile(file.path) as Promise<string>);
            updateWorkspace(projectPath, w => ({
              ...w,
              openFiles: w.openFiles.map(f =>
                f.path === file.path
                  ? { ...f, content, savedContent: content, isDirty: false, diskMtime: mtime }
                  : f
              ),
            }));
          } else {
            setExternallyModified(prev => {
              if (prev.has(file.path)) return prev;
              return new Set([...prev, file.path]);
            });
          }
        } catch {
          // File may have been deleted or moved; ignore
        }
      }
    }, 5000);
    return () => clearInterval(id);
  }, [projectPath, updateWorkspace]);

  const [historyOpen, setHistoryOpen] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
      }
    };
    if (historyOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [historyOpen]);

  useEffect(() => {
    const cleanup = window.sai.onWorkspaceSuspended?.((suspendedPath: string) => {
      updateWorkspace(suspendedPath, ws => ({ ...ws, status: 'suspended' }));
    });
    return cleanup;
  }, [updateWorkspace]);

  // Listen for background workspace completions
  useEffect(() => {
    const cleanup = window.sai.claudeOnMessage((msg: any) => {
      if (!msg.projectPath) return;
      if (msg.type === 'streaming_start') {
        setBusyWorkspaces(prev => new Set(prev).add(msg.projectPath));
      }
      if (msg.type === 'done') {
        setBusyWorkspaces(prev => {
          if (!prev.has(msg.projectPath)) return prev;
          const next = new Set(prev);
          next.delete(msg.projectPath);
          // Notify if this was a background workspace
          if (msg.projectPath !== activeProjectPathRef.current) {
            const wsName = msg.projectPath.split('/').pop() || msg.projectPath;
            setCompletedWorkspaces(p => new Set(p).add(msg.projectPath));
            setToast({ message: `${wsName} has finished`, key: Date.now() });
          }
          return next;
        });
      }
    });
    return cleanup;
  }, []);

  const groupedSessions = sessions.reduce<{ label: string; sessions: ChatSession[] }[]>((groups, session) => {
    const label = formatSessionDate(session.updatedAt);
    const existing = groups.find(g => g.label === label);
    if (existing) existing.sessions.push(session);
    else groups.push({ label, sessions: [session] });
    return groups;
  }, []);

  // Accordion state
  const [expanded, setExpanded] = useState<PanelId[]>(['chat', 'terminal']);
  // Split ratio: fraction of available space given to the first expanded panel (0.0–1.0)
  const [splitRatio, setSplitRatio] = useState(0.66);
  const [isDragging, setIsDragging] = useState(false);
  const mainContentRef = useRef<HTMLDivElement>(null);

  const togglePanel = useCallback((panel: PanelId) => {
    setExpanded((prev: PanelId[]) => {
      // Focused chat mode: chat stays at 66%, editor/terminal toggle in the 34% slot
      if (focusedChat) {
        if (panel === 'chat') {
          if (prev.includes('chat')) {
            const next = prev.filter(p => p !== 'chat') as PanelId[];
            return next.length === 0 ? prev : next;
          }
          return prev.includes('chat') ? prev : (['chat' as PanelId, ...prev.filter(p => p !== 'chat')].slice(0, 2) as PanelId[]);
        }
        // Editor or terminal: swap into the secondary slot alongside chat
        if (prev.includes(panel)) {
          const next = prev.filter(p => p !== panel) as PanelId[];
          return next.length === 0 ? prev : next;
        }
        if (prev.includes('chat')) {
          setSplitRatio(0.66);
          return ['chat', panel] as PanelId[];
        }
        return [...prev, panel].slice(0, 2) as PanelId[];
      }

      // Default mode
      if (prev.includes(panel)) {
        const next = prev.filter(p => p !== panel) as PanelId[];
        if (next.length === 0) return prev;
        setSplitRatio(0.66);
        return next;
      } else {
        const next = [...prev, panel] as PanelId[];
        setSplitRatio(0.66);
        return next.length > 2 ? next.slice(1) as PanelId[] : next;
      }
    });
  }, [focusedChat]);

  // Drag handling
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const hasFiles = openFiles.length > 0;

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!mainContentRef.current) return;
      const rect = mainContentRef.current.getBoundingClientRect();
      // Total height minus the accordion bars (32px each * number of panels)
      const panels: PanelId[] = hasFiles ? ['chat', 'editor', 'terminal'] : ['chat', 'terminal'];
      const barHeight = panels.length * 32;
      const handleHeight = 6;
      const availableHeight = rect.height - barHeight - handleHeight;
      const mouseY = e.clientY - rect.top;

      // Find the position of the first expanded panel's bar
      let firstBarOffset = 0;
      for (const p of panels) {
        if (p === expandedPanels[0]) break;
        firstBarOffset += expanded.includes(p) ? 32 : 32; // collapsed panels are just bars
      }
      // Actually, let's compute based on panels above the divider
      // The divider sits between the two expanded panels. We need to figure out
      // how much vertical space is above the divider vs below.
      const relativeY = mouseY - firstBarOffset - 32; // subtract the first expanded panel's bar
      const ratio = Math.max(0.15, Math.min(0.85, relativeY / availableHeight));
      setSplitRatio(ratio);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, expanded, hasFiles]);

  // Determine which panels are visible and which are expanded
  const allPanels: PanelId[] = hasFiles ? ['chat', 'editor', 'terminal'] : ['chat', 'terminal'];
  const expandedPanels = allPanels.filter(p => expanded.includes(p));
  const twoExpanded = expandedPanels.length === 2;

  const handleFileClick = useCallback((file: GitFile) => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => {
      const exists = ws.openFiles.some(f => f.path === file.path);
      return {
        ...ws,
        openFiles: exists ? ws.openFiles : [...ws.openFiles, { path: file.path, viewMode: 'diff', file, diffMode: 'unified' }],
        activeFilePath: file.path,
      };
    });
    setExpanded(prev => {
      if (prev.includes('editor')) return prev;
      if (focusedChat && prev.includes('chat')) {
        setSplitRatio(0.66);
        return ['chat', 'editor'];
      }
      const next = [...prev, 'editor' as PanelId];
      setSplitRatio(0.66);
      return next.length > 2 ? next.slice(1) : next;
    });
  }, [activeProjectPath, updateWorkspace, focusedChat]);

  const handleFileOpen = useCallback(async (filePath: string) => {
    if (!activeProjectPath) return;
    try {
      const [content, { mtime }] = await Promise.all([
        window.sai.fsReadFile(filePath) as Promise<string>,
        window.sai.fsMtime(filePath) as Promise<{ mtime: number }>,
      ]);
      updateWorkspace(activeProjectPath, ws => {
        const exists = ws.openFiles.some(f => f.path === filePath);
        return {
          ...ws,
          openFiles: exists ? ws.openFiles : [...ws.openFiles, { path: filePath, viewMode: 'editor', content, savedContent: content, diskMtime: mtime }],
          activeFilePath: filePath,
        };
      });
      setExpanded(prev => {
        if (prev.includes('editor')) return prev;
        if (focusedChat && prev.includes('chat')) {
          setSplitRatio(0.66);
          return ['chat', 'editor'];
        }
        const next = [...prev, 'editor' as PanelId];
        setSplitRatio(0.66);
        return next.length > 2 ? next.slice(1) : next;
      });
    } catch {
      // File couldn't be read
    }
  }, [activeProjectPath, updateWorkspace, focusedChat]);

  const doFileClose = useCallback((path: string) => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => {
      const next = ws.openFiles.filter(f => f.path !== path);
      let newActive = ws.activeFilePath;
      if (next.length === 0) {
        newActive = null;
        setExpanded(['chat', 'terminal']);
        setSplitRatio(0.66);
      } else if (path === ws.activeFilePath) {
        const idx = ws.openFiles.findIndex(f => f.path === path);
        newActive = next[Math.min(idx, next.length - 1)].path;
      }
      return { ...ws, openFiles: next, activeFilePath: newActive };
    });
  }, [activeProjectPath, updateWorkspace]);

  const handleFileClose = useCallback((path: string) => {
    if (!activeProjectPath) return;
    const ws = workspaces.get(activeProjectPath);
    const file = ws?.openFiles.find(f => f.path === path);
    const isDirty = file?.viewMode === 'editor' && !!file.isDirty;
    if (isDirty) {
      setPendingClose(path);
    } else {
      doFileClose(path);
    }
  }, [activeProjectPath, workspaces, doFileClose]);

  const handleCloseAllFiles = useCallback(() => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => ({
      ...ws,
      openFiles: [],
      activeFilePath: null,
    }));
    setExpanded(['chat', 'terminal']);
    setSplitRatio(0.66);
  }, [activeProjectPath, updateWorkspace]);

  const handleDiffModeChange = useCallback((path: string, mode: 'unified' | 'split') => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => ({
      ...ws,
      openFiles: ws.openFiles.map(f => f.path === path ? { ...f, diffMode: mode } : f),
    }));
  }, [activeProjectPath, updateWorkspace]);

  const handleProjectSwitch = useCallback((newPath: string) => {
    if (newPath === activeProjectPath) return;
    window.sai.openRecentProject(newPath);
    const sessions = loadSessions(newPath);
    setWorkspaces(prev => {
      const next = new Map(prev);
      if (!next.has(newPath)) {
        next.set(newPath, {
          projectPath: newPath,
          sessions,
          activeSession: createSession(),
          openFiles: [],
          activeFilePath: null,
          terminalIds: [],
          status: 'active',
          lastActivity: Date.now(),
        });
      } else {
        const ws = next.get(newPath)!;
        next.set(newPath, { ...ws, status: 'active', lastActivity: Date.now() });
      }
      return next;
    });
    setActiveProjectPath(newPath);
    setCompletedWorkspaces(prev => {
      const next = new Set(prev);
      next.delete(newPath);
      return next;
    });
  }, [activeProjectPath]);

  const handleEditorSave = useCallback(async (filePath: string, content: string) => {
    await window.sai.fsWriteFile(filePath, content);
    const { mtime } = await window.sai.fsMtime(filePath) as { mtime: number };
    if (activeProjectPath) {
      updateWorkspace(activeProjectPath, ws => ({
        ...ws,
        openFiles: ws.openFiles.map(f => f.path === filePath ? { ...f, savedContent: content, isDirty: false, diskMtime: mtime } : f),
      }));
    }
  }, [activeProjectPath, updateWorkspace]);

  const handleEditorContentChange = useCallback((filePath: string, content: string) => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => ({
      ...ws,
      openFiles: ws.openFiles.map(f => f.path === filePath ? { ...f, content } : f),
    }));
  }, [activeProjectPath, updateWorkspace]);

  const handleEditorDirtyChange = useCallback((filePath: string, dirty: boolean) => {
    if (!activeProjectPath) return;
    updateWorkspace(activeProjectPath, ws => ({
      ...ws,
      openFiles: ws.openFiles.map(f => f.path === filePath ? { ...f, isDirty: dirty } : f),
    }));
  }, [activeProjectPath, updateWorkspace]);

  const handleReloadFile = useCallback(async (filePath: string) => {
    if (!activeProjectPath) return;
    try {
      const [content, { mtime }] = await Promise.all([
        window.sai.fsReadFile(filePath) as Promise<string>,
        window.sai.fsMtime(filePath) as Promise<{ mtime: number }>,
      ]);
      updateWorkspace(activeProjectPath, ws => ({
        ...ws,
        openFiles: ws.openFiles.map(f =>
          f.path === filePath
            ? { ...f, content, savedContent: content, isDirty: false, diskMtime: mtime }
            : f
        ),
      }));
    } catch { }
    setExternallyModified(prev => {
      const next = new Set(prev);
      next.delete(filePath);
      return next;
    });
  }, [activeProjectPath, updateWorkspace]);

  const handleKeepMyEdits = useCallback(async (filePath: string) => {
    try {
      const { mtime } = await (window.sai.fsMtime(filePath) as Promise<{ mtime: number }>);
      if (activeProjectPath) {
        updateWorkspace(activeProjectPath, ws => ({
          ...ws,
          openFiles: ws.openFiles.map(f =>
            f.path === filePath ? { ...f, diskMtime: mtime } : f
          ),
        }));
      }
    } catch { }
    setExternallyModified(prev => {
      const next = new Set(prev);
      next.delete(filePath);
      return next;
    });
  }, [activeProjectPath, updateWorkspace]);

  const persistSessionForWorkspace = useCallback((wsPath: string, session: ChatSession) => {
    updateWorkspace(wsPath, ws => {
      const updated = upsertSession(ws.sessions, session);
      saveSessions(wsPath, updated);
      return { ...ws, sessions: updated };
    });
  }, [updateWorkspace]);

  const persistSession = useCallback((session: ChatSession) => {
    if (!activeProjectPath) return;
    persistSessionForWorkspace(activeProjectPath, session);
  }, [activeProjectPath, persistSessionForWorkspace]);

  const toggleSidebar = (id: string) => {
    setSidebarOpen(prev => prev === id ? null : id);
  };

  // Flush latest messages from ref into workspace state
  const flushMessages = useCallback((wsPath: string) => {
    const latestMessages = wsMessagesRef.current.get(wsPath);
    if (!latestMessages || latestMessages.length === 0) return;
    updateWorkspace(wsPath, ws => {
      const updated = { ...ws.activeSession, messages: latestMessages, updatedAt: Date.now() };
      if (!updated.title) {
        const firstUserMsg = latestMessages.find(m => m.role === 'user');
        if (firstUserMsg) updated.title = firstUserMsg.content.slice(0, 40);
      }
      return { ...ws, activeSession: updated };
    });
  }, [updateWorkspace]);

  const handleNewChat = () => {
    if (!activeProjectPath) return;
    flushMessages(activeProjectPath);
    persistSession(activeSession);
    // Clear backend session so next message starts fresh
    window.sai.claudeSetSessionId(activeProjectPath, undefined);
    updateWorkspace(activeProjectPath, ws => ({
      ...ws,
      activeSession: createSession(),
    }));
  };

  const handleSelectSession = (id: string) => {
    if (!activeProjectPath) return;
    flushMessages(activeProjectPath);
    persistSession(activeSession);
    const selected = sessions.find(s => s.id === id);
    if (selected) {
      // Tell backend to switch to the selected session's Claude session ID
      window.sai.claudeSetSessionId(activeProjectPath, selected.claudeSessionId);
      updateWorkspace(activeProjectPath, ws => ({
        ...ws,
        activeSession: { ...selected },
      }));
    }
  };

  const saveClaudeSetting = (key: string, value: any) => {
    window.sai.settingsGet('claude', {}).then((existing: any) => {
      window.sai.settingsSet('claude', { ...existing, [key]: value });
    });
  };

  const saveCodexSetting = (key: string, value: any) => {
    window.sai.settingsGet('codex', {}).then((existing: any) => {
      window.sai.settingsSet('codex', { ...existing, [key]: value });
    });
  };

  const handlePermissionChange = (mode: PermissionMode) => {
    setPermissionMode(mode);
    saveClaudeSetting('permission', mode);
  };

  const handleEffortChange = (level: EffortLevel) => {
    setEffortLevel(level);
    saveClaudeSetting('effort', level);
  };

  const handleModelChange = (model: ModelChoice) => {
    setModelChoice(model);
    saveClaudeSetting('model', model);
  };

  const handleCodexModelChange = (model: string) => {
    setCodexModel(model);
    saveCodexSetting('model', model);
  };

  const handleCodexPermissionChange = (perm: CodexPermission) => {
    setCodexPermission(perm);
    saveCodexSetting('permission', perm);
  };

  const saveGeminiSetting = (key: string, value: any) => {
    window.sai.settingsGet('gemini', {}).then((existing: any) => {
      window.sai.settingsSet('gemini', { ...existing, [key]: value });
    });
  };

  const handleGeminiModelChange = (model: string) => {
    setGeminiModel(model);
    saveGeminiSetting('model', model);
  };

  const handleGeminiApprovalModeChange = (mode: GeminiApprovalMode) => {
    setGeminiApprovalMode(mode);
    saveGeminiSetting('approvalMode', mode);
  };

  const handleGeminiConversationModeChange = (mode: GeminiConversationMode) => {
    setGeminiConversationMode(mode);
    saveGeminiSetting('conversationMode', mode);
  };

  const handleGeminiLoadingPhrasesChange = (mode: 'witty' | 'tips' | 'all' | 'off') => {
    setGeminiLoadingPhrases(mode);
    saveGeminiSetting('loadingPhrases', mode);
  };

  const chatOpen = expanded.includes('chat');
  const editorOpen = expanded.includes('editor');
  const terminalOpen = expanded.includes('terminal');

  // Compute flex values: first expanded panel gets splitRatio, second gets the rest
  const getPanelFlex = (panel: PanelId): string => {
    if (!expanded.includes(panel)) return '0 0 32px';
    if (expandedPanels.length === 1) return '1 1 0%';
    const isFirst = expandedPanels[0] === panel;
    const ratio = isFirst ? splitRatio : 1 - splitRatio;
    return `${ratio} ${ratio} 0%`;
  };

  // Should we show a drag handle after this panel?
  const showHandleAfter = (panel: PanelId): boolean => {
    if (!twoExpanded) return false;
    return panel === expandedPanels[0];
  };

  const renderPanel = (panel: PanelId) => {
    const isOpen = expanded.includes(panel);
    const providerSvg = aiProvider === 'codex' ? 'svg/openai.svg' : aiProvider === 'gemini' ? 'svg/Google-gemini-icon.svg' : 'svg/claude.svg';
    const providerColor = aiProvider === 'codex' ? 'var(--text)' : aiProvider === 'gemini' ? '#4285f4' : '#e27b4a';
    const icon = panel === 'chat'
      ? <span className="accordion-provider-icon" style={{
          maskImage: `url('${providerSvg}')`,
          WebkitMaskImage: `url('${providerSvg}')`,
          backgroundColor: providerColor,
          opacity: 1,
        }} />
      : panel === 'editor' ? <Code2 size={12} />
      : <TerminalSquare size={12} />;
    const label = panel === 'chat' ? 'Chat' : panel === 'editor' ? 'Editor' : 'Terminal';

    return (
      <div
        key={panel}
        className={`accordion-panel ${isOpen ? 'accordion-expanded' : 'accordion-collapsed'}`}
        style={{ flex: getPanelFlex(panel), transition: isDragging ? 'none' : undefined }}
      >
        <div className="accordion-bar" onClick={() => togglePanel(panel)}>
          <ChevronRight size={12} className={`accordion-chevron ${isOpen ? 'open' : ''}`} />
          {icon}
          <span>{label}</span>
          {panel === 'editor' && !isOpen && activeFilePath && (
            <span className="accordion-bar-detail">
              {activeFilePath.split('/').pop()}
            </span>
          )}
          {panel === 'chat' && (
            <div className="accordion-bar-actions" ref={historyRef}>
              <button
                className="accordion-bar-btn"
                onClick={(e) => { e.stopPropagation(); setHistoryOpen(!historyOpen); }}
                title="Recent conversations"
              >
                <Clock size={12} />
              </button>
              <button
                className="accordion-bar-btn"
                onClick={(e) => { e.stopPropagation(); handleNewChat(); }}
                title="New conversation"
              >
                <MessageCirclePlus size={12} />
              </button>
              {historyOpen && (
                <div className="chat-history-dropdown">
                  {sessions.length === 0 ? (
                    <div className="dropdown-label" style={{ padding: '12px' }}>
                      No recent conversations
                    </div>
                  ) : (
                    groupedSessions.map((group, gi) => (
                      <div key={group.label}>
                        {gi > 0 && <div className="dropdown-divider" />}
                        <div className="dropdown-label">{group.label}</div>
                        {group.sessions.map(session => (
                          <button
                            key={session.id}
                            className={`dropdown-item history-item ${session.id === activeSession.id ? 'active' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectSession(session.id);
                              setHistoryOpen(false);
                            }}
                          >
                            <span className="dropdown-item-title-row">
                              {session.aiProvider && (
                                <img
                                  src={session.aiProvider === 'gemini' ? 'svg/Google-gemini-icon.svg' : session.aiProvider === 'codex' ? 'svg/openai.svg' : 'svg/claude.svg'}
                                  alt={session.aiProvider}
                                  className="history-provider-icon"
                                />
                              )}
                              <span className="dropdown-item-name">{session.title || 'Untitled'}</span>
                            </span>
                            <span className="dropdown-item-path">{formatSessionTime(session.updatedAt)}</span>
                          </button>
                        ))}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="accordion-body-wrapper">
          <div className="accordion-body">
            {panel === 'chat' && workspaces.size === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 16, color: 'var(--text-muted)', padding: 32 }}>
                <WelcomeTypewriter />
                <span style={{ fontSize: 13 }}>Open a folder to get started</span>
                <button
                  style={{ marginTop: 8, padding: '8px 20px', background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}
                  onClick={async () => {
                    const folder = await window.sai.selectFolder();
                    if (folder) handleProjectSwitch(folder);
                  }}
                >
                  Open Folder
                </button>
              </div>
            )}
            {panel === 'chat' && Array.from(workspaces.entries()).map(([wsPath, ws]) => (
              <div
                key={`chat-${wsPath}`}
                style={{
                  display: wsPath === activeProjectPath ? 'flex' : 'none',
                  flexDirection: 'column',
                  flex: 1,
                  minHeight: 0,
                  overflow: 'hidden',
                }}
              >
                <ChatPanel
                  key={ws.activeSession.id}
                  projectPath={wsPath}
                  permissionMode={permissionMode}
                  onPermissionChange={handlePermissionChange}
                  effortLevel={effortLevel}
                  onEffortChange={handleEffortChange}
                  modelChoice={modelChoice}
                  onModelChange={handleModelChange}
                  aiProvider={aiProvider}
                  codexModel={codexModel}
                  onCodexModelChange={handleCodexModelChange}
                  codexModels={codexModels}
                  codexPermission={codexPermission}
                  onCodexPermissionChange={handleCodexPermissionChange}
                  geminiModel={geminiModel}
                  onGeminiModelChange={handleGeminiModelChange}
                  geminiModels={geminiModels}
                  geminiApprovalMode={geminiApprovalMode}
                  onGeminiApprovalModeChange={handleGeminiApprovalModeChange}
                  geminiConversationMode={geminiConversationMode}
                  onGeminiConversationModeChange={handleGeminiConversationModeChange}
                  geminiLoadingPhrases={geminiLoadingPhrases}
                  initialMessages={ws.activeSession.messages}
                  activeFilePath={ws.activeFilePath}
                  onFileOpen={handleFileOpen}
                  onMessagesChange={(messages: ChatMessage[]) => {
                    wsMessagesRef.current.set(wsPath, messages);
                  }}
                  onClaudeSessionId={(sessionId: string) => {
                    updateWorkspace(wsPath, w => ({
                      ...w,
                      activeSession: { ...w.activeSession, claudeSessionId: sessionId },
                    }));
                  }}
                  onTurnComplete={() => {
                    const latestMessages = wsMessagesRef.current.get(wsPath) || [];
                    if (latestMessages.length === 0) return;
                    updateWorkspace(wsPath, w => {
                      const updated = { ...w.activeSession, messages: latestMessages, updatedAt: Date.now(), aiProvider };
                      if (!updated.title) {
                        const firstUserMsg = latestMessages.find(m => m.role === 'user');
                        if (firstUserMsg) updated.title = firstUserMsg.content.slice(0, 40);
                      }
                      const updatedSessions = upsertSession(w.sessions, updated);
                      saveSessions(wsPath, updatedSessions);
                      return { ...w, activeSession: updated, sessions: updatedSessions };
                    });
                  }}
                />
              </div>
            ))}
            {panel === 'editor' && activeFilePath && (
              <CodePanel
                openFiles={openFiles}
                activeFilePath={activeFilePath}
                projectPath={projectPath}
                editorFontSize={editorFontSize}
                editorMinimap={editorMinimap}
                onActivate={(path: string) => {
                  if (activeProjectPath) {
                    updateWorkspace(activeProjectPath, ws => ({ ...ws, activeFilePath: path }));
                  }
                }}
                onClose={handleFileClose}
                onCloseAll={handleCloseAllFiles}
                onDiffModeChange={handleDiffModeChange}
                onEditorSave={handleEditorSave}
                onEditorContentChange={handleEditorContentChange}
                onEditorDirtyChange={handleEditorDirtyChange}
                externallyModified={externallyModified}
                onReloadFile={handleReloadFile}
                onKeepMyEdits={handleKeepMyEdits}
              />
            )}
            {panel === 'terminal' && Array.from(workspaces.entries()).map(([wsPath]) => (
              <div
                key={`term-${wsPath}`}
                style={{
                  display: wsPath === activeProjectPath ? 'flex' : 'none',
                  flexDirection: 'column',
                  flex: 1,
                  minHeight: 0,
                  overflow: 'hidden',
                }}
              >
                <TerminalPanel projectPath={wsPath} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="app">
      <TitleBar
        projectPath={projectPath}
        onProjectChange={handleProjectSwitch}
        completedWorkspaces={completedWorkspaces}
        busyWorkspaces={busyWorkspaces}
        onSettingChange={(key, value) => {
          if (key === 'editorFontSize') setEditorFontSize(value);
          if (key === 'editorMinimap') setEditorMinimap(value);
          if (key === 'aiProvider') { setAiProvider(value); handleNewChat(); }
          if (key === 'geminiLoadingPhrases') handleGeminiLoadingPhrasesChange(value);
          if (key === 'focusedChat') { setFocusedChat(value); if (value) { setExpanded(['chat', 'terminal']); setSplitRatio(0.66); } }
        }}
      />
      <div className="app-body">
        <NavBar activeSidebar={sidebarOpen} onToggle={toggleSidebar} gitChangeCount={gitChangeCount} />
        {sidebarOpen === 'files' && <FileExplorerSidebar projectPath={projectPath} onFileOpen={handleFileOpen} />}
        {sidebarOpen === 'git' && <GitSidebar projectPath={projectPath} onFileClick={handleFileClick} aiProvider={aiProvider} />}
        <div className="main-content" ref={mainContentRef}>
          {allPanels.map((panel, i) => (
            <div key={panel} style={{ display: 'contents' }}>
              {renderPanel(panel)}
              {showHandleAfter(panel) && (
                <div
                  className={`drag-handle ${isDragging ? 'dragging' : ''}`}
                  onMouseDown={handleDragStart}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {isDragging && <div className="drag-overlay" />}

      {pendingClose && (() => {
        const ws = activeProjectPath ? workspaces.get(activeProjectPath) : null;
        const file = ws?.openFiles.find(f => f.path === pendingClose);
        const fileName = pendingClose.split('/').pop() ?? pendingClose;
        return (
          <UnsavedChangesModal
            fileName={fileName}
            onSave={async () => {
              if (file?.content !== undefined) {
                await handleEditorSave(pendingClose, file.content);
              }
              doFileClose(pendingClose);
              setPendingClose(null);
            }}
            onDiscard={() => {
              doFileClose(pendingClose);
              setPendingClose(null);
            }}
            onCancel={() => setPendingClose(null)}
          />
        );
      })()}

      {toast && (
        <WorkspaceToast key={toast.key} message={toast.message} onDismiss={() => setToast(null)} />
      )}

      <style>{`
        .accordion-panel {
          display: flex;
          flex-direction: column;
          overflow: hidden;
          transition: flex 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          min-height: 0;
        }
        .accordion-panel.accordion-collapsed {
          flex: 0 0 32px !important;
        }
        .accordion-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 12px;
          height: 32px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-muted);
          cursor: pointer;
          user-select: none;
          flex-shrink: 0;
          background: var(--bg-secondary);
          border-top: 1px solid var(--border);
        }
        .accordion-panel:first-child .accordion-bar {
          border-top: none;
        }
        .accordion-bar:hover {
          color: var(--text-secondary);
          background: var(--bg-hover);
        }
        .accordion-chevron {
          transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          flex-shrink: 0;
          color: var(--text-muted);
        }
        .accordion-chevron.open {
          transform: rotate(90deg);
        }
        .accordion-bar-actions {
          display: flex;
          align-items: center;
          gap: 2px;
          margin-left: auto;
          position: relative;
        }
        .accordion-bar-btn {
          background: none;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 3px;
          border-radius: 4px;
          display: flex;
          align-items: center;
        }
        .accordion-bar-btn:hover {
          color: var(--accent);
          background: var(--bg-hover);
        }
        .accordion-provider-icon {
          display: inline-block;
          width: 12px;
          height: 12px;
          mask-size: contain;
          -webkit-mask-size: contain;
          mask-repeat: no-repeat;
          -webkit-mask-repeat: no-repeat;
          flex-shrink: 0;
        }
        .chat-history-dropdown {
          position: absolute;
          top: 100%;
          right: 0;
          margin-top: 4px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 6px;
          min-width: 280px;
          max-width: 350px;
          max-height: 400px;
          overflow-y: auto;
          box-shadow: 0 8px 24px rgba(0,0,0,0.4);
          z-index: 200;
          text-transform: none;
          letter-spacing: 0;
          font-weight: 400;
        }
        .chat-history-dropdown .dropdown-label {
          padding: 8px 12px 4px;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-muted);
        }
        .chat-history-dropdown .dropdown-item {
          display: flex;
          flex-direction: column;
          width: 100%;
          padding: 6px 12px;
          background: none;
          border: none;
          color: var(--text);
          cursor: pointer;
          text-align: left;
          font-size: 13px;
        }
        .chat-history-dropdown .dropdown-item:hover {
          background: var(--bg-hover);
        }
        .chat-history-dropdown .dropdown-item-name {
          font-weight: 500;
        }
        .chat-history-dropdown .dropdown-item-path {
          font-size: 11px;
          color: var(--text-muted);
        }
        .chat-history-dropdown .dropdown-divider {
          height: 1px;
          background: var(--border);
          margin: 4px 0;
        }
        .chat-history-dropdown .history-item.active {
          border-left: 2px solid var(--accent);
          background: rgba(126,184,247,0.05);
        }
        .chat-history-dropdown .history-item.active .dropdown-item-path {
          color: #fff;
        }
        .dropdown-item-title-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .history-provider-icon {
          width: 12px;
          height: 12px;
          flex-shrink: 0;
          opacity: 0.6;
        }
        .accordion-bar-detail {
          font-weight: 400;
          text-transform: none;
          letter-spacing: 0;
          color: var(--text-muted);
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          opacity: 0.6;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .accordion-body-wrapper {
          flex: 1;
          overflow: hidden;
          min-height: 0;
        }
        .accordion-collapsed .accordion-body-wrapper {
          flex: 0;
          height: 0;
        }
        .accordion-body {
          height: 100%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .accordion-body .terminal-panel {
          height: 100%;
          border-top: none;
        }
        .drag-handle {
          height: 6px;
          flex-shrink: 0;
          cursor: row-resize;
          background: transparent;
          position: relative;
          z-index: 10;
        }
        .drag-handle::after {
          content: '';
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 32px;
          height: 3px;
          border-radius: 2px;
          background: var(--text-muted);
          opacity: 0;
          transition: opacity 0.15s;
        }
        .drag-handle:hover::after,
        .drag-handle.dragging::after {
          opacity: 0.5;
        }
        .drag-handle:hover,
        .drag-handle.dragging {
          background: var(--bg-hover);
        }
        .drag-overlay {
          position: fixed;
          inset: 0;
          z-index: 9999;
          cursor: row-resize;
        }
      `}</style>
    </div>
  );
}
