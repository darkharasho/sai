import { ipcMain, dialog, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function registerFsHandlers(mainWindow: BrowserWindow) {
  ipcMain.handle('fs:readDir', async (_event, dirPath: string) => {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .map(entry => ({
        name: entry.name,
        path: path.join(dirPath, entry.name),
        type: entry.isDirectory() ? 'directory' as const : 'file' as const,
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  });

  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    return fs.readFileSync(filePath, 'utf-8');
  });

  ipcMain.handle('fs:mtime', async (_event, filePath: string) => {
    const stat = await fs.promises.stat(filePath);
    return { mtime: stat.mtimeMs };
  });

  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    fs.writeFileSync(filePath, content, 'utf-8');
  });

  ipcMain.handle('fs:rename', async (_event, oldPath: string, newPath: string) => {
    fs.renameSync(oldPath, newPath);
  });

  ipcMain.handle('fs:delete', async (_event, targetPath: string) => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Delete', 'Cancel'],
      defaultId: 1,
      title: 'Confirm Delete',
      message: `Delete "${path.basename(targetPath)}"?`,
      detail: 'This action cannot be undone.',
    });
    if (result.response === 0) {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return true;
    }
    return false;
  });

  ipcMain.handle('fs:createFile', async (_event, filePath: string) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '', 'utf-8');
  });

  ipcMain.handle('fs:createDir', async (_event, dirPath: string) => {
    fs.mkdirSync(dirPath, { recursive: true });
  });

  ipcMain.handle('fs:checkIgnored', async (_event, rootPath: string, paths: string[]) => {
    if (!paths.length) return [];
    try {
      const result = spawnSync('git', ['check-ignore', '--stdin', '-z'], {
        cwd: rootPath,
        input: paths.join('\0') + '\0',
        encoding: 'utf-8',
      });
      return result.stdout.split('\0').filter(Boolean);
    } catch {
      return [];
    }
  });

  ipcMain.handle('fs:walkFiles', async (_event, rootPath: string) => {
    try {
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

  ipcMain.handle('fs:grep', async (_event, rootPath: string, query: string, maxResults: number = 50) => {
    if (!query || query.length < 2) return [];

    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    try {
      const rgResult = spawnSync('rg', [
        '--json',
        '--max-count', '3',
        '--max-filesize', '1M',
        '-i',
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
}
