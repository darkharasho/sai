import type React from 'react';
import { WorkspaceSquircle } from '../components/shared/WorkspaceSquircle';

export interface RegisteredComponent {
  component: React.ComponentType<any>;
}

export const componentRegistry: Record<string, RegisteredComponent> = {
  WorkspaceSquircle: { component: WorkspaceSquircle },
};

export function getRegisteredComponent(key: string): RegisteredComponent | null {
  return componentRegistry[key] ?? null;
}

export function registeredComponentKeys(): string[] {
  return Object.keys(componentRegistry);
}
