import { describe, it, expect } from 'vitest';
import { componentRegistry, getRegisteredComponent, registeredComponentKeys } from '../../../src/render/componentRegistry';

describe('componentRegistry', () => {
  it('registers WorkspaceSquircle', () => {
    expect(getRegisteredComponent('WorkspaceSquircle')).toBeTruthy();
  });

  it('returns null for unknown keys', () => {
    expect(getRegisteredComponent('Nope')).toBeNull();
  });

  it('exposes the list of keys', () => {
    expect(registeredComponentKeys()).toContain('WorkspaceSquircle');
    expect(registeredComponentKeys()).toEqual(Object.keys(componentRegistry));
  });
});
