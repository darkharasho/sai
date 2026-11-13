import { useSyncExternalStore } from 'react';

// At most one chat model card app-wide holds a live WebGL viewer. A new claim
// demotes the previous holder (its card unmounts the viewer, freeing the context).
let activeId: string | null = null;
const listeners = new Set<() => void>();

function emit() { for (const l of [...listeners]) l(); }

export function claim(renderId: string): void {
  if (activeId === renderId) return;
  activeId = renderId;
  emit();
}

export function release(renderId: string): void {
  if (activeId !== renderId) return;
  activeId = null;
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useIsActiveModelCard(renderId: string): boolean {
  return useSyncExternalStore(subscribe, () => activeId === renderId);
}

export const activeModelCard = { claim, release };
