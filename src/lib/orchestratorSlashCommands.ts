import type { SwarmHost } from './swarmOrchestratorDispatcher';

export interface SlashCommandResult {
  handled: true;
  reply: string;
}

export interface SlashCommandResolution {
  handled: false;
}

export type SlashCommandOutcome = SlashCommandResult | SlashCommandResolution;

export function isSlashCommand(text: string): boolean {
  if (!text) return false;
  return text.trimStart().startsWith('/');
}

const HELP_TEXT = [
  'Orchestrator slash commands:',
  '  /spawn <prompt>           — spawn a single task',
  '  /burst                    — spawn multiple tasks (one prompt per line below)',
  '  /status [filter]          — show swarm snapshot summary',
  '  /approve <approvalId>     — approve a pending tool call',
  '  /deny <approvalId>        — deny a pending tool call',
  '  /land <taskRef>           — land a completed task',
  '  /discard <taskRef>        — discard a task',
  '  /pause <taskRef>          — pause a task',
  '  /resume <taskRef>         — resume a task',
  '  /help                     — show this message',
].join('\n');

function formatSnapshot(snap: unknown): string {
  if (!snap || typeof snap !== 'object') return String(snap);
  const s = snap as Record<string, unknown>;
  const active = typeof s.active === 'number' ? s.active : 0;
  const approvals = typeof s.approvals === 'number' ? s.approvals : 0;
  const ready = typeof s.ready === 'number' ? s.ready : 0;
  return `${active} active · ${approvals} approvals · ${ready} ready`;
}

export async function executeSlashCommand(
  text: string,
  host: SwarmHost,
): Promise<SlashCommandOutcome> {
  if (!isSlashCommand(text)) return { handled: false };

  const trimmed = text.trimStart();
  // Split off first line for command + args; rest for /burst body
  const firstNewline = trimmed.indexOf('\n');
  const firstLine = firstNewline === -1 ? trimmed : trimmed.slice(0, firstNewline);
  const body = firstNewline === -1 ? '' : trimmed.slice(firstNewline + 1);

  const match = firstLine.match(/^\/(\S+)\s*(.*)$/);
  if (!match) {
    return { handled: true, reply: `Unknown slash command: ${firstLine}. Try /help.` };
  }
  const cmd = match[1];
  const rest = match[2].trim();

  try {
    switch (cmd) {
      case 'help':
        return { handled: true, reply: HELP_TEXT };

      case 'spawn': {
        if (!rest) return { handled: true, reply: '/spawn requires a prompt. Usage: /spawn <prompt>' };
        const task = await host.spawnTask({ prompt: rest });
        return { handled: true, reply: `✓ "${task.title}" → spawned` };
      }

      case 'burst': {
        const lines = body
          .split('\n')
          .map(l => l.trim())
          .filter(l => l.length > 0);
        if (lines.length === 0) {
          return {
            handled: true,
            reply: '/burst expects each task on its own line below the command.',
          };
        }
        const tasks = await host.spawnTasks(lines);
        const titles = tasks.map(t => `"${t.title}"`).join(', ');
        return { handled: true, reply: `✓ ${tasks.length} tasks spawned: ${titles}` };
      }

      case 'status': {
        const filter = rest || undefined;
        const snap = await host.snapshot(filter);
        return { handled: true, reply: formatSnapshot(snap) };
      }

      case 'approve': {
        if (!rest) return { handled: true, reply: '/approve requires an approvalId.' };
        await host.approve(rest);
        return { handled: true, reply: `✓ approved ${rest}` };
      }

      case 'deny': {
        if (!rest) return { handled: true, reply: '/deny requires an approvalId.' };
        await host.deny(rest);
        return { handled: true, reply: `✓ denied ${rest}` };
      }

      case 'land': {
        if (!rest) return { handled: true, reply: '/land requires a taskRef.' };
        const result = await host.land(rest);
        if (result.ok) return { handled: true, reply: `✓ landed ${rest}` };
        return { handled: true, reply: `✗ ${result.reason}` };
      }

      case 'discard': {
        if (!rest) return { handled: true, reply: '/discard requires a taskRef.' };
        await host.discard(rest);
        return { handled: true, reply: `✓ discarded ${rest}` };
      }

      case 'pause': {
        if (!rest) return { handled: true, reply: '/pause requires a taskRef.' };
        await host.pause(rest);
        return { handled: true, reply: `✓ paused ${rest}` };
      }

      case 'resume': {
        if (!rest) return { handled: true, reply: '/resume requires a taskRef.' };
        await host.resume(rest);
        return { handled: true, reply: `✓ resumed ${rest}` };
      }

      default:
        return {
          handled: true,
          reply: `Unknown slash command: /${cmd}. Try /help.`,
        };
    }
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    return { handled: true, reply: `✗ ${msg}` };
  }
}
