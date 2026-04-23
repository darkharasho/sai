// electron/services/scaffold.ts
import fs from 'node:fs';
import path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import https from 'node:https';
import { ipcMain } from 'electron';

export interface ScaffoldOptions {
  path: string;
  context: string;
  helpers: {
    claudeMd: boolean;
    gitInit: boolean;
    gitignore: boolean;
    readme: boolean;
    claudeSettings: boolean;
    githubRepo: boolean;
  };
  github?: {
    repoName: string;
    visibility: 'private' | 'public';
  };
}

export interface ScaffoldResult {
  ok: boolean;
  error?: string;        // blocking failure (directory creation)
  warnings: string[];    // non-blocking step failures
  repoUrl?: string;      // set if GitHub repo was created
}

function githubPost(endpoint: string, body: object, token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = https.request({
      hostname: 'api.github.com',
      path: endpoint,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'User-Agent': 'SAI-App',
      },
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(parsed.message || `HTTP ${res.statusCode}`));
          } else {
            resolve(parsed);
          }
        } catch {
          resolve(raw);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

export async function scaffoldProject(
  options: ScaffoldOptions,
  getToken: () => string | null,
): Promise<ScaffoldResult> {
  const warnings: string[] = [];
  const normalizedPath = options.path.replace(/[/\\]+$/, '');
  const resolved = path.resolve(normalizedPath);
  if (!resolved || resolved === '/') {
    return { ok: false, error: 'Invalid project path', warnings };
  }
  const folderName = path.basename(normalizedPath);

  // Step 1 — blocking: create directory
  try {
    fs.mkdirSync(resolved, { recursive: true });
  } catch (e: any) {
    return { ok: false, error: `Could not create directory: ${e.message}`, warnings };
  }

  // Step 2 — CLAUDE.md
  if (options.helpers.claudeMd) {
    try {
      const content = options.context
        ? `## Project Context\n\n${options.context}\n`
        : `## Project Context\n\n_No context provided._\n`;
      fs.writeFileSync(path.join(resolved, 'CLAUDE.md'), content, 'utf8');
    } catch (e: any) {
      warnings.push(`CLAUDE.md: ${e.message}`);
    }
  }

  // Step 3 — git init
  if (options.helpers.gitInit) {
    try {
      execSync('git init', { cwd: resolved, stdio: 'ignore' });
    } catch (e: any) {
      warnings.push(`git init: ${e.message}`);
    }
  }

  // Step 4 — .gitignore
  if (options.helpers.gitignore) {
    try {
      const content = [
        'node_modules',
        '.env',
        '.env.*',
        '.DS_Store',
        'dist',
        'build',
        '*.log',
        '.superpowers',
      ].join('\n') + '\n';
      fs.writeFileSync(path.join(resolved, '.gitignore'), content, 'utf8');
    } catch (e: any) {
      warnings.push(`.gitignore: ${e.message}`);
    }
  }

  // Step 5 — README.md
  if (options.helpers.readme) {
    try {
      const desc = options.context ? `\n\n${options.context}\n` : '';
      fs.writeFileSync(path.join(resolved, 'README.md'), `# ${folderName}${desc}`, 'utf8');
    } catch (e: any) {
      warnings.push(`README.md: ${e.message}`);
    }
  }

  // Step 6 — .claude/settings.json
  if (options.helpers.claudeSettings) {
    try {
      const dir = path.join(resolved, '.claude');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'settings.json'), '{}\n', 'utf8');
    } catch (e: any) {
      warnings.push(`.claude/settings.json: ${e.message}`);
    }
  }

  // Step 7 — GitHub repo
  let repoUrl: string | undefined;
  if (options.helpers.githubRepo && !options.github) {
    warnings.push('GitHub repo: options.github not provided');
  } else if (options.helpers.githubRepo && options.github) {
    const token = getToken();
    if (!token) {
      warnings.push('GitHub repo: not authenticated');
    } else {
      try {
        const repo = await githubPost('/user/repos', {
          name: options.github.repoName,
          private: options.github.visibility === 'private',
          auto_init: false,
        }, token);
        if (repo.clone_url) {
          repoUrl = repo.clone_url;
          try {
            execFileSync('git', ['remote', 'add', 'origin', repo.clone_url], { cwd: resolved });
          } catch (e: any) {
            warnings.push(`git remote add origin: ${e.message}`);
          }
          // Ensure README exists before initial push
          const readmePath = path.join(resolved, 'README.md');
          if (!fs.existsSync(readmePath)) {
            try {
              const desc = options.context ? `\n\n${options.context}\n` : '';
              fs.writeFileSync(readmePath, `# ${folderName}${desc}`, 'utf8');
            } catch (e: any) {
              warnings.push(`README.md: ${e.message}`);
            }
          }
          // Initial commit and push
          try {
            execFileSync('git', ['add', '.'], { cwd: resolved });
            execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: resolved });
            execFileSync('git', ['push', '-u', 'origin', 'HEAD'], { cwd: resolved });
          } catch (e: any) {
            warnings.push(`Initial push: ${e.message}`);
          }
        } else {
          warnings.push(`GitHub repo: ${repo.message || 'unknown error'}`);
        }
      } catch (e: any) {
        warnings.push(`GitHub repo: ${e.message}`);
      }
    }
  }

  return { ok: true, warnings, repoUrl };
}

export function registerScaffoldHandler(
  readSettings: () => Record<string, any>,
) {
  ipcMain.handle('project:scaffold', async (_event, options: ScaffoldOptions) => {
    const getToken = () => readSettings().github_auth?.token ?? null;
    return scaffoldProject(options, getToken);
  });
}
