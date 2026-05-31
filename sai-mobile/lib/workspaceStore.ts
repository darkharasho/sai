import { create } from 'zustand';

export interface Workspace {
  projectPath: string;
  label: string;
  scope?: string;
  kind?: 'project' | 'meta';
  members?: { projectPath: string; name: string }[];
}

interface State {
  workspacesByMachine: Record<string, Workspace[]>;
  activeByMachine: Record<string, Workspace | null>;
  setWorkspaces(machineId: string, ws: Workspace[]): void;
  setActive(machineId: string, w: Workspace | null): void;
}

export const useWorkspaces = create<State>((set, get) => ({
  workspacesByMachine: {},
  activeByMachine: {},
  setWorkspaces(machineId, ws) {
    set({ workspacesByMachine: { ...get().workspacesByMachine, [machineId]: ws } });
    const active = get().activeByMachine[machineId];
    if (!active && ws.length > 0) {
      set({ activeByMachine: { ...get().activeByMachine, [machineId]: ws[0] } });
    }
  },
  setActive(machineId, w) {
    set({ activeByMachine: { ...get().activeByMachine, [machineId]: w } });
  },
}));
