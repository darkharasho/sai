export function swarmBranchName(title: string, id: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    || 'task';
  const short = id.replace(/-/g, '').slice(0, 8);
  return `swarm/${slug}-${short}`;
}
