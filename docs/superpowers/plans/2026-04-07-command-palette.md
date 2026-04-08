# Command Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a keyboard-first command palette (`Ctrl+K` / `Cmd+K`) with file search, slash commands, grep, and session switching.

**Architecture:** Two new IPC handlers (`fs:walkFiles`, `fs:grep`) in the Electron main process provide data to a single React component (`CommandPalette.tsx`) rendered as an overlay in `App.tsx`. The palette has four modes (Files/Commands/Grep/Sessions) switchable via prefix characters or Tab cycling. File search uses a client-side fuzzy matcher against an index built at project load.

**Tech Stack:** Electron IPC, React 19, TypeScript, Lucide React icons, `git ls-files` for file indexing, `rg`/`grep` for content search.

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/components/CommandPalette.tsx` | Command palette UI component — input, mode pills, results list, keyboard handling |
| Create | `src/utils/fuzzyMatch.ts` | Fuzzy matching algorithm with scoring and highlight index extraction |
| Modify | `electron/services/fs.ts` | Add `fs:walkFiles` and `fs:grep` IPC handlers |
| Modify | `electron/preload.ts` | Expose `fsWalkFiles` and `fsGrep` to renderer |
| Modify | `src/App.tsx` | Add palette state, `Ctrl+K` keybinding, file index, wire props |
| Modify | `src/components/TerminalMode/TerminalModeInput.tsx` | Change `Ctrl+K` to `Shift+Tab` for AI mode toggle |

---

### Task 1: Backend — `fs:walkFiles` IPC Handler

**Files:**
- Modify: `electron/services/fs.ts:6-76`

- [ ] **Step 1: Add the `fs:walkFiles` handler**

Add this handler inside `registerFsHandlers()` after the existing `fs:checkIgnored` handler (after line 74):

```typescript
  ipcMain.handle('fs:walkFiles', async (_event, rootPath: string) => {
    try {
      // Try git ls-files first (respects .gitignore, handles submodules)
      const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
        cwd: rootPath,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });
      if (result.status === 0 && result.stdout.trim()) {
        return result.stdout.trim().split('\n').filter(Boolean);
      }
    } catch {
      // Not a git repo, fall through
    }

    // Fallback: recursive filesystem walk
    const EXCLUDED = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv']);
    const files: string[] = [];
    const walk = (dir: string, prefix: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (EXCLUDED.has(entry.name)) continue;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name), rel);
        } else {
          files.push(rel);
        }
      }
    };
    walk(rootPath, '');
    return files;
  });
```

- [ ] **Step 2: Verify the import for `spawnSync` already exists**

Check line 4 of `electron/services/fs.ts` — it already has:
```typescript
import { spawnSync } from 'node:child_process';
```

No change needed.

- [ ] **Step 3: Commit**

```bash
git add electron/services/fs.ts
git commit -m "feat(ipc): add fs:walkFiles handler for file indexing"
```

---

### Task 2: Backend — `fs:grep` IPC Handler

**Files:**
- Modify: `electron/services/fs.ts`

- [ ] **Step 1: Add the `fs:grep` handler**

Add this handler right after the `fs:walkFiles` handler added in Task 1:

```typescript
  ipcMain.handle('fs:grep', async (_event, rootPath: string, query: string, maxResults: number = 50) => {
    if (!query || query.length < 2) return [];

    // Escape special regex characters for literal search
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    try {
      // Try ripgrep first
      const rgResult = spawnSync('rg', [
        '--json',
        '--max-count', '3',           // max matches per file
        '--max-filesize', '1M',
        '-i',                          // case insensitive
        escaped,
      ], {
        cwd: rootPath,
        encoding: 'utf-8',
        maxBuffer: 5 * 1024 * 1024,
        timeout: 5000,
      });

      if (rgResult.status !== null && rgResult.status <= 1) {
        const results: { file: string; line: number; text: string }[] = [];
        const lines = rgResult.stdout.split('\n').filter(Boolean);
        for (const line of lines) {
          if (results.length >= maxResults) break;
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'match') {
              const rel = path.relative(rootPath, parsed.data.path.text);
              results.push({
                file: rel,
                line: parsed.data.line_number,
                text: parsed.data.lines.text.trim().slice(0, 200),
              });
            }
          } catch {
            // skip malformed JSON lines
          }
        }
        return results;
      }
    } catch {
      // rg not found, fall through
    }

    // Fallback: grep -rn
    try {
      const grepResult = spawnSync('grep', [
        '-rn', '-i',
        '--include=*.{ts,tsx,js,jsx,py,rs,go,java,c,cpp,h,css,html,json,md,yaml,yml,toml}',
        '-m', '3',
        escaped,
        '.',
      ], {
        cwd: rootPath,
        encoding: 'utf-8',
        maxBuffer: 5 * 1024 * 1024,
        timeout: 5000,
      });

      const results: { file: string; line: number; text: string }[] = [];
      const lines = grepResult.stdout.split('\n').filter(Boolean);
      for (const line of lines) {
        if (results.length >= maxResults) break;
        const match = line.match(/^\.\/(.+?):(\d+):(.*)$/);
        if (match) {
          results.push({
            file: match[1],
            line: parseInt(match[2], 10),
            text: match[3].trim().slice(0, 200),
          });
        }
      }
      return results;
    } catch {
      return [];
    }
  });
```

- [ ] **Step 2: Commit**

```bash
git add electron/services/fs.ts
git commit -m "feat(ipc): add fs:grep handler for project-wide text search"
```

---

### Task 3: Preload Bridge — Expose New IPC Methods

**Files:**
- Modify: `electron/preload.ts:57-65`

- [ ] **Step 1: Add `fsWalkFiles` and `fsGrep` to the preload bridge**

After the existing `fsCheckIgnored` line (line 65), add:

```typescript
  fsWalkFiles: (rootPath: string) => ipcRenderer.invoke('fs:walkFiles', rootPath),
  fsGrep: (rootPath: string, query: string, maxResults?: number) => ipcRenderer.invoke('fs:grep', rootPath, query, maxResults),
```

- [ ] **Step 2: Commit**

```bash
git add electron/preload.ts
git commit -m "feat(preload): expose fsWalkFiles and fsGrep to renderer"
```

---

### Task 4: Fuzzy Match Utility

**Files:**
- Create: `src/utils/fuzzyMatch.ts`

- [ ] **Step 1: Create the fuzzy match module**

```typescript
export interface FuzzyResult {
  path: string;
  score: number;
  matchIndices: number[]; // indices into the filename for highlight rendering
}

export function fuzzyMatch(query: string, candidates: string[], maxResults = 50): FuzzyResult[] {
  if (!query) return candidates.slice(0, maxResults).map(p => ({ path: p, score: 0, matchIndices: [] }));

  const lowerQuery = query.toLowerCase();
  const results: FuzzyResult[] = [];

  for (const candidate of candidates) {
    const filename = candidate.split('/').pop() || candidate;
    const lowerFilename = filename.toLowerCase();
    const lowerCandidate = candidate.toLowerCase();

    // Try matching against filename first, then full path
    const filenameMatch = matchChars(lowerQuery, lowerFilename);
    const pathMatch = filenameMatch ? null : matchChars(lowerQuery, lowerCandidate);

    if (!filenameMatch && !pathMatch) continue;

    const isFilename = !!filenameMatch;
    const { indices } = (filenameMatch || pathMatch)!;
    let score = 0;

    // Bonus: filename match vs path match
    if (isFilename) score += 100;

    // Bonus: consecutive matches
    for (let i = 1; i < indices.length; i++) {
      if (indices[i] === indices[i - 1] + 1) score += 10;
    }

    // Bonus: match at start of filename
    if (isFilename && indices[0] === 0) score += 50;

    // Bonus: match after separator (/, ., -, _)
    const target = isFilename ? lowerFilename : lowerCandidate;
    for (const idx of indices) {
      if (idx > 0 && '/.-_'.includes(target[idx - 1])) score += 20;
    }

    // Penalty: longer paths
    score -= candidate.length * 0.5;

    // Penalty: spread between matches
    if (indices.length > 1) {
      score -= (indices[indices.length - 1] - indices[0] - indices.length + 1) * 2;
    }

    results.push({ path: candidate, score, matchIndices: isFilename ? indices : [] });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

function matchChars(query: string, target: string): { indices: number[] } | null {
  const indices: number[] = [];
  let ti = 0;
  for (let qi = 0; qi < query.length; qi++) {
    const found = target.indexOf(query[qi], ti);
    if (found === -1) return null;
    indices.push(found);
    ti = found + 1;
  }
  return { indices };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/fuzzyMatch.ts
git commit -m "feat: add fuzzy match utility for command palette file search"
```

---

### Task 5: CommandPalette Component

**Files:**
- Create: `src/components/CommandPalette.tsx`

- [ ] **Step 1: Create the CommandPalette component**

```tsx
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, File, ChevronRight, FileCode2, MessageSquare, Loader2 } from 'lucide-react';
import { fuzzyMatch } from '../utils/fuzzyMatch';

type PaletteMode = 'files' | 'commands' | 'grep' | 'sessions';

interface GrepResult {
  file: string;
  line: number;
  text: string;
}

interface WorkspaceInfo {
  projectPath: string;
  status?: string;
  lastActivity?: number;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  fileIndex: string[];
  slashCommands: string[];
  workspaces: WorkspaceInfo[];
  projectPath: string;
  onFileOpen: (path: string, line?: number) => void;
  onCommand: (command: string) => void;
  onWorkspaceSwitch: (path: string) => void;
}

const MODE_ORDER: PaletteMode[] = ['files', 'commands', 'grep', 'sessions'];

const MODE_CONFIG: Record<PaletteMode, { label: string; placeholder: string; prefix: string }> = {
  files:    { label: 'Files',    placeholder: 'Search files...',      prefix: '' },
  commands: { label: 'Commands', placeholder: 'Run command...',       prefix: '>' },
  grep:    { label: 'Grep',     placeholder: 'Search in files...',   prefix: '#' },
  sessions: { label: 'Sessions', placeholder: 'Switch session...',   prefix: '@' },
};

const EXT_COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  ts:   { bg: 'rgba(17,183,212,0.12)', fg: '#11B7D4', label: 'TS' },
  tsx:  { bg: 'rgba(17,183,212,0.12)', fg: '#11B7D4', label: 'TS' },
  js:   { bg: 'rgba(199,145,12,0.12)', fg: '#c7910c', label: 'JS' },
  jsx:  { bg: 'rgba(199,145,12,0.12)', fg: '#c7910c', label: 'JS' },
  py:   { bg: 'rgba(0,168,132,0.12)',  fg: '#00a884', label: 'PY' },
  rs:   { bg: 'rgba(212,119,12,0.12)', fg: '#d4770c', label: 'RS' },
  go:   { bg: 'rgba(56,199,189,0.12)', fg: '#38c7bd', label: 'GO' },
  css:  { bg: 'rgba(212,110,192,0.12)', fg: '#d46ec0', label: 'CSS' },
  html: { bg: 'rgba(227,85,53,0.12)',  fg: '#E35535', label: 'HTM' },
  json: { bg: 'rgba(199,145,12,0.12)', fg: '#c7910c', label: 'JSON' },
  md:   { bg: 'rgba(160,172,187,0.12)', fg: '#a0acbb', label: 'MD' },
  yaml: { bg: 'rgba(168,95,241,0.12)', fg: '#a85ff1', label: 'YML' },
  yml:  { bg: 'rgba(168,95,241,0.12)', fg: '#a85ff1', label: 'YML' },
  toml: { bg: 'rgba(168,95,241,0.12)', fg: '#a85ff1', label: 'TOML' },
};

function getExtInfo(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return EXT_COLORS[ext] || { bg: 'rgba(160,172,187,0.12)', fg: '#a0acbb', label: ext.toUpperCase().slice(0, 4) || '?' };
}

function highlightFilename(name: string, indices: number[]) {
  if (!indices.length) return <>{name}</>;
  const chars: React.ReactNode[] = [];
  let inHighlight = false;
  let buf = '';
  for (let i = 0; i < name.length; i++) {
    const isMatch = indices.includes(i);
    if (isMatch !== inHighlight) {
      if (buf) chars.push(inHighlight ? <mark key={i}>{buf}</mark> : buf);
      buf = '';
      inHighlight = isMatch;
    }
    buf += name[i];
  }
  if (buf) chars.push(inHighlight ? <mark key="end">{buf}</mark> : buf);
  return <>{chars}</>;
}

export default function CommandPalette({
  open, onClose, fileIndex, slashCommands, workspaces,
  projectPath, onFileOpen, onCommand, onWorkspaceSwitch,
}: CommandPaletteProps) {
  const [mode, setMode] = useState<PaletteMode>('files');
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [grepResults, setGrepResults] = useState<GrepResult[]>([]);
  const [grepLoading, setGrepLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const grepTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setMode('files');
      setSelectedIndex(0);
      setGrepResults([]);
      setGrepLoading(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Detect prefix-based mode switch
  const handleInputChange = useCallback((value: string) => {
    if (value === '>' && mode !== 'commands') {
      setMode('commands');
      setQuery('');
      setSelectedIndex(0);
      return;
    }
    if (value === '#' && mode !== 'grep') {
      setMode('grep');
      setQuery('');
      setSelectedIndex(0);
      return;
    }
    if (value === '@' && mode !== 'sessions') {
      setMode('sessions');
      setQuery('');
      setSelectedIndex(0);
      return;
    }
    setQuery(value);
    setSelectedIndex(0);
  }, [mode]);

  // Grep debounce
  useEffect(() => {
    if (mode !== 'grep') return;
    if (grepTimerRef.current) clearTimeout(grepTimerRef.current);
    if (!query || query.length < 2) {
      setGrepResults([]);
      setGrepLoading(false);
      return;
    }
    setGrepLoading(true);
    grepTimerRef.current = setTimeout(async () => {
      try {
        const results = await (window as any).sai.fsGrep(projectPath, query, 50);
        setGrepResults(results);
      } catch {
        setGrepResults([]);
      }
      setGrepLoading(false);
    }, 300);
    return () => { if (grepTimerRef.current) clearTimeout(grepTimerRef.current); };
  }, [query, mode, projectPath]);

  // Compute results for current mode
  const results = useMemo(() => {
    if (mode === 'files') {
      return fuzzyMatch(query, fileIndex, 50);
    }
    return [];
  }, [mode, query, fileIndex]);

  const commandResults = useMemo(() => {
    if (mode !== 'commands') return [];
    const lq = query.toLowerCase();
    const builtins = [
      { name: 'help', description: 'Show available commands' },
      { name: 'clear', description: 'Clear conversation' },
    ];
    const fromProvider = slashCommands.map(c => ({ name: c, description: '' }));
    const all = [...builtins, ...fromProvider.filter(c => !builtins.some(b => b.name === c.name))];
    if (!lq) return all;
    return all.filter(c => c.name.toLowerCase().includes(lq));
  }, [mode, query, slashCommands]);

  const sessionResults = useMemo(() => {
    if (mode !== 'sessions') return [];
    const lq = query.toLowerCase();
    if (!lq) return workspaces;
    return workspaces.filter(w => {
      const name = w.projectPath.split('/').pop() || w.projectPath;
      return name.toLowerCase().includes(lq) || w.projectPath.toLowerCase().includes(lq);
    });
  }, [mode, query, workspaces]);

  const totalResults = mode === 'files' ? results.length
    : mode === 'commands' ? commandResults.length
    : mode === 'grep' ? grepResults.length
    : sessionResults.length;

  // Scroll active result into view
  useEffect(() => {
    const container = resultsRef.current;
    if (!container) return;
    const active = container.querySelector('.cp-result-active') as HTMLElement;
    if (active) active.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const executeResult = useCallback(() => {
    if (mode === 'files' && results[selectedIndex]) {
      const filePath = projectPath + '/' + results[selectedIndex].path;
      onFileOpen(filePath);
      onClose();
    } else if (mode === 'commands' && commandResults[selectedIndex]) {
      onCommand(commandResults[selectedIndex].name);
      onClose();
    } else if (mode === 'grep' && grepResults[selectedIndex]) {
      const r = grepResults[selectedIndex];
      onFileOpen(projectPath + '/' + r.file, r.line);
      onClose();
    } else if (mode === 'sessions' && sessionResults[selectedIndex]) {
      onWorkspaceSwitch(sessionResults[selectedIndex].projectPath);
      onClose();
    }
  }, [mode, selectedIndex, results, commandResults, grepResults, sessionResults, projectPath, onFileOpen, onCommand, onWorkspaceSwitch, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, totalResults - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      executeResult();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const currentIdx = MODE_ORDER.indexOf(mode);
      const nextMode = MODE_ORDER[(currentIdx + (e.shiftKey ? MODE_ORDER.length - 1 : 1)) % MODE_ORDER.length];
      setMode(nextMode);
      setSelectedIndex(0);
      return;
    }
  }, [onClose, totalResults, executeResult, mode]);

  if (!open) return null;

  return (
    <>
      <div className="cp-backdrop" onClick={onClose} />
      <div className="cp-palette" onKeyDown={handleKeyDown}>
        <div className="cp-input-row">
          <Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            className="cp-input"
            type="text"
            value={query}
            onChange={e => handleInputChange(e.target.value)}
            placeholder={MODE_CONFIG[mode].placeholder}
            spellCheck={false}
            autoComplete="off"
          />
          {mode === 'grep' && grepLoading && (
            <Loader2 size={14} style={{ color: 'var(--text-muted)', animation: 'spin 1s linear infinite' }} />
          )}
        </div>

        <div className="cp-modes">
          {MODE_ORDER.map(m => (
            <button
              key={m}
              className={`cp-mode-pill${mode === m ? ' active' : ''}`}
              onClick={() => { setMode(m); setSelectedIndex(0); inputRef.current?.focus(); }}
            >
              {m === 'files' && <File size={12} />}
              {m === 'commands' && <ChevronRight size={12} />}
              {m === 'grep' && <FileCode2 size={12} />}
              {m === 'sessions' && <MessageSquare size={12} />}
              {MODE_CONFIG[m].label}
            </button>
          ))}
        </div>

        <div className="cp-results" ref={resultsRef}>
          {mode === 'files' && results.map((r, i) => {
            const filename = r.path.split('/').pop() || r.path;
            const dir = r.path.includes('/') ? r.path.slice(0, r.path.lastIndexOf('/') + 1) : './';
            const ext = getExtInfo(filename);
            return (
              <div
                key={r.path}
                className={`cp-result${i === selectedIndex ? ' cp-result-active' : ''}`}
                onClick={() => { setSelectedIndex(i); onFileOpen(projectPath + '/' + r.path); onClose(); }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <div className="cp-result-icon" style={{ background: ext.bg, color: ext.fg }}>{ext.label}</div>
                <div className="cp-result-info">
                  <div className="cp-result-name">{highlightFilename(filename, r.matchIndices)}</div>
                  <div className="cp-result-path">{dir}</div>
                </div>
              </div>
            );
          })}

          {mode === 'commands' && commandResults.map((c, i) => (
            <div
              key={c.name}
              className={`cp-result${i === selectedIndex ? ' cp-result-active' : ''}`}
              onClick={() => { onCommand(c.name); onClose(); }}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <div className="cp-result-icon" style={{ background: 'rgba(199,145,12,0.12)', color: 'var(--accent)' }}>/</div>
              <div className="cp-result-info">
                <div className="cp-result-name">/{c.name}</div>
                {c.description && <div className="cp-result-path">{c.description}</div>}
              </div>
            </div>
          ))}

          {mode === 'grep' && !grepLoading && grepResults.map((r, i) => {
            const filename = r.file.split('/').pop() || r.file;
            const ext = getExtInfo(filename);
            return (
              <div
                key={`${r.file}:${r.line}:${i}`}
                className={`cp-result${i === selectedIndex ? ' cp-result-active' : ''}`}
                onClick={() => { onFileOpen(projectPath + '/' + r.file, r.line); onClose(); }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <div className="cp-result-icon" style={{ background: ext.bg, color: ext.fg }}>{ext.label}</div>
                <div className="cp-result-info">
                  <div className="cp-result-name">{filename}<span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>:{r.line}</span></div>
                  <div className="cp-result-path cp-grep-snippet">{r.text}</div>
                </div>
              </div>
            );
          })}

          {mode === 'grep' && grepLoading && (
            <div className="cp-empty">Searching...</div>
          )}

          {mode === 'grep' && !grepLoading && query.length >= 2 && grepResults.length === 0 && (
            <div className="cp-empty">No results</div>
          )}

          {mode === 'sessions' && sessionResults.map((w, i) => {
            const name = w.projectPath.split('/').pop() || w.projectPath;
            const isActive = w.status === 'active' || w.status === undefined;
            return (
              <div
                key={w.projectPath}
                className={`cp-result${i === selectedIndex ? ' cp-result-active' : ''}`}
                onClick={() => { onWorkspaceSwitch(w.projectPath); onClose(); }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <div className="cp-status-dot" style={{ background: isActive ? 'var(--green)' : 'var(--text-muted)' }} />
                <div className="cp-result-info">
                  <div className="cp-result-name">{name}</div>
                  <div className="cp-result-path">{w.projectPath}</div>
                </div>
              </div>
            );
          })}

          {totalResults === 0 && mode !== 'grep' && (
            <div className="cp-empty">No results</div>
          )}
        </div>

        <div className="cp-footer">
          <span><kbd>Tab</kbd> switch mode</span>
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>Enter</kbd> open</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>

      <style>{`
        .cp-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          backdrop-filter: blur(2px);
          z-index: 9998;
          animation: cp-fade-in 0.15s ease;
        }
        .cp-palette {
          position: fixed;
          top: calc(var(--titlebar-height) + 48px);
          left: 50%;
          transform: translateX(-50%);
          width: 520px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 10px;
          box-shadow: 0 16px 48px rgba(0,0,0,0.5);
          z-index: 9999;
          display: flex;
          flex-direction: column;
          animation: cp-drop-in 0.15s ease;
        }
        .cp-input-row {
          padding: 12px 16px;
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .cp-input {
          flex: 1;
          background: none;
          border: none;
          outline: none;
          color: var(--text);
          font-size: 14px;
          font-family: 'Geist', sans-serif;
          caret-color: var(--accent);
        }
        .cp-input::placeholder {
          color: var(--text-muted);
        }
        .cp-modes {
          padding: 6px 16px;
          border-bottom: 1px solid var(--border);
          display: flex;
          gap: 4px;
        }
        .cp-mode-pill {
          font-size: 11px;
          padding: 3px 10px;
          border-radius: 6px;
          color: var(--text-muted);
          background: transparent;
          border: none;
          cursor: pointer;
          font-family: 'Geist Mono', monospace;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .cp-mode-pill:hover {
          color: var(--text-secondary);
        }
        .cp-mode-pill.active {
          background: rgba(var(--accent-rgb, 199,145,12), 0.12);
          color: var(--accent);
        }
        .cp-results {
          max-height: 320px;
          overflow-y: auto;
          padding: 4px 0;
        }
        .cp-result {
          padding: 8px 16px;
          display: flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
        }
        .cp-result:hover, .cp-result-active {
          background: rgba(var(--accent-rgb, 199,145,12), 0.08);
        }
        .cp-result-icon {
          width: 28px;
          height: 28px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          font-size: 11px;
          font-weight: 600;
          font-family: 'Geist Mono', monospace;
        }
        .cp-status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .cp-result-info {
          flex: 1;
          min-width: 0;
        }
        .cp-result-name {
          font-size: 13px;
          color: var(--text);
          font-family: 'Geist', sans-serif;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .cp-result-name mark {
          background: none;
          color: var(--accent);
          font-weight: 600;
        }
        .cp-result-path {
          font-size: 11px;
          color: var(--text-muted);
          font-family: 'Geist Mono', monospace;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .cp-grep-snippet {
          font-family: 'Geist Mono', monospace;
          font-size: 11px;
        }
        .cp-empty {
          padding: 24px 16px;
          text-align: center;
          color: var(--text-muted);
          font-size: 13px;
        }
        .cp-footer {
          padding: 8px 16px;
          border-top: 1px solid var(--border);
          display: flex;
          gap: 16px;
          font-size: 11px;
          color: var(--text-muted);
          font-family: 'Geist Mono', monospace;
        }
        .cp-footer kbd {
          background: var(--bg-input);
          padding: 1px 5px;
          border-radius: 3px;
          border: 1px solid var(--border);
          color: var(--text-secondary);
          font-size: 10px;
        }
        @keyframes cp-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes cp-drop-in {
          from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/CommandPalette.tsx
git commit -m "feat: add CommandPalette component with four search modes"
```

---

### Task 6: Remap Terminal Mode Toggle Keybinding

**Files:**
- Modify: `src/components/TerminalMode/TerminalModeInput.tsx:107-112`

- [ ] **Step 1: Change Ctrl+K to Shift+Tab for mode toggle**

Replace the Ctrl+K handler at lines 108-111:

```typescript
    if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onToggleMode();
      return;
    }
```

With:

```typescript
    // Ctrl+K is now reserved for command palette — do nothing here
```

The existing Shift+Tab handler at lines 113-117 already calls `onToggleMode()`, so the mode toggle still works via Shift+Tab.

- [ ] **Step 2: Commit**

```bash
git add src/components/TerminalMode/TerminalModeInput.tsx
git commit -m "refactor: remove Ctrl+K terminal mode toggle (now used by command palette)"
```

---

### Task 7: Wire CommandPalette into App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the import**

After the existing component imports (near line 13), add:

```typescript
import CommandPalette from './components/CommandPalette';
```

- [ ] **Step 2: Add state for command palette and file index**

After the `focusedChat` state declaration (around line 131), add:

```typescript
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [fileIndex, setFileIndex] = useState<string[]>([]);
```

- [ ] **Step 3: Add the global Ctrl+K keybinding**

After the existing `useEffect` blocks (around line 152, after the `setExternallyModified` effect), add:

```typescript
  // Global Ctrl+K / Cmd+K handler for command palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCommandPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
```

- [ ] **Step 4: Build file index when project changes**

Right after the Ctrl+K effect, add:

```typescript
  // Build file index for command palette
  useEffect(() => {
    if (!activeProjectPath) { setFileIndex([]); return; }
    let cancelled = false;
    (window as any).sai.fsWalkFiles(activeProjectPath).then((files: string[]) => {
      if (!cancelled) setFileIndex(files);
    }).catch(() => {
      if (!cancelled) setFileIndex([]);
    });
    return () => { cancelled = true; };
  }, [activeProjectPath]);
```

- [ ] **Step 5: Add slash commands state and workspace list plumbing**

The slash commands live inside `ChatPanel` state, so we need to lift them or provide them differently. Since the built-in commands are static and provider commands are per-workspace, the simplest approach is to pass the known built-ins plus expose a ref.

Add a ref after the `fileIndex` state:

```typescript
  const slashCommandsRef = useRef<string[]>([]);
```

And add a callback to receive slash commands from ChatPanel:

```typescript
  const handleSlashCommandsUpdate = useCallback((commands: string[]) => {
    slashCommandsRef.current = commands;
  }, []);
```

- [ ] **Step 6: Add workspace list fetcher for sessions mode**

After the file index effect, add:

```typescript
  const [paletteWorkspaces, setPaletteWorkspaces] = useState<{ projectPath: string; status?: string; lastActivity?: number }[]>([]);

  useEffect(() => {
    if (!commandPaletteOpen) return;
    (window as any).sai.workspaceGetAll().then((ws: any[]) => {
      setPaletteWorkspaces(ws);
    }).catch(() => setPaletteWorkspaces([]));
  }, [commandPaletteOpen]);
```

- [ ] **Step 7: Add onCommand handler**

```typescript
  const handlePaletteCommand = useCallback((command: string) => {
    // Inject the slash command into the chat input by simulating what ChatPanel does
    // For now, we create a synthetic message
    if (command === 'clear' && activeProjectPath) {
      updateWorkspace(activeProjectPath, ws => ({
        ...ws,
        sessions: ws.sessions.map(s =>
          s.id === ws.activeSession.id ? { ...s, messages: [] } : s
        ),
        activeSession: { ...ws.activeSession, messages: [] },
      }));
    }
    // Other commands can be added as needed
  }, [activeProjectPath, updateWorkspace]);
```

- [ ] **Step 8: Render CommandPalette in the JSX**

After the `WorkspaceToast` rendering (around line 1573), add:

```tsx
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        fileIndex={fileIndex}
        slashCommands={slashCommandsRef.current}
        workspaces={paletteWorkspaces}
        projectPath={projectPath}
        onFileOpen={handleFileOpen}
        onCommand={handlePaletteCommand}
        onWorkspaceSwitch={handleProjectSwitch}
      />
```

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire CommandPalette into App with Ctrl+K keybinding and file index"
```

---

### Task 8: Manual Testing & Polish

- [ ] **Step 1: Build and verify**

```bash
cd /var/home/mstephens/Documents/GitHub/sai && npm run build
```

Fix any TypeScript errors.

- [ ] **Step 2: Test file search mode**

Launch the app, press `Ctrl+K`. Type a partial filename. Verify:
- Fuzzy match results appear with correct file-type badges
- Arrow keys navigate results
- Enter opens the file in the editor
- Escape closes the palette

- [ ] **Step 3: Test commands mode**

Press `Ctrl+K`, type `>`. Verify:
- Mode switches to Commands
- Built-in commands (help, clear) appear
- Tab cycles through modes

- [ ] **Step 4: Test grep mode**

Press `Ctrl+K`, type `#`, then a search term (at least 2 chars). Verify:
- Loading indicator appears
- Results show filename:line and snippet
- Enter opens file at correct line

- [ ] **Step 5: Test sessions mode**

Press `Ctrl+K`, type `@`. Verify:
- Active and recent workspaces appear
- Selecting a workspace switches to it

- [ ] **Step 6: Verify Shift+Tab still toggles terminal AI mode**

In terminal mode, press `Shift+Tab`. Verify mode toggles between shell and AI.

- [ ] **Step 7: Commit final polish if needed**

```bash
git add -A
git commit -m "fix: command palette polish and fixes"
```
