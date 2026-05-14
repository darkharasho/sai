import type { MetaWorkspaceRuntimeProject } from '../types';

export interface MetaPreambleInput {
  name: string;
  syntheticRoot: string;
  projects: MetaWorkspaceRuntimeProject[];
}

export function buildMetaPreamble(meta: MetaPreambleInput | null): string {
  if (!meta) return '';
  const available = meta.projects.filter(p => p.status === 'ok');
  if (available.length === 0) return '';
  const lines: string[] = [];
  lines.push(`You are operating inside a SAI Meta Workspace "${meta.name}".`);
  lines.push(`Your working directory is ${meta.syntheticRoot}, which contains symlinks/junctions to multiple project roots.`);
  lines.push(`Each top-level entry below the working directory is a separate project. Treat each project's root as authoritative for its own files, git history, and configuration.`);
  lines.push(`Included projects:`);
  for (const p of available) {
    const suffix = p.description ? ` (${p.description})` : '';
    lines.push(`- ${p.linkName} -> ${p.path}${suffix}`);
  }
  lines.push(`When the user request is ambiguous about which project to change, ask before making cross-project edits.`);
  lines.push(`When spawning swarm tasks via mcp__swarm__spawn_task, set the "project" argument to one of: ${available.map(p => p.linkName).join(', ')}. Each task runs inside that project's real git repo.`);
  return lines.join('\n');
}
