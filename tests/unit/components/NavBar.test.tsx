import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

import NavBar from '../../../src/components/NavBar';

/** Get a nav-btn button element by its title attribute directly on the button */
function getNavButton(container: HTMLElement, title: string): HTMLButtonElement {
  const btn = container.querySelector(`button[title="${title}"]`);
  if (!btn) throw new Error(`No button with title "${title}" found`);
  return btn as HTMLButtonElement;
}

describe('NavBar', () => {
  it('renders without crashing', () => {
    const { container } = render(
      <NavBar activeSidebar={null} onToggle={vi.fn()} />
    );
    expect(container).toBeTruthy();
  });

  it('renders files toggle button', () => {
    const { container } = render(<NavBar activeSidebar={null} onToggle={vi.fn()} />);
    expect(getNavButton(container, 'Explorer')).toBeTruthy();
  });

  it('renders git toggle button', () => {
    const { container } = render(<NavBar activeSidebar={null} onToggle={vi.fn()} />);
    expect(getNavButton(container, 'Source Control')).toBeTruthy();
  });

  it('calls onToggle with "files" when files button is clicked', () => {
    const onToggle = vi.fn();
    const { container } = render(<NavBar activeSidebar={null} onToggle={onToggle} />);
    fireEvent.click(getNavButton(container, 'Explorer'));
    expect(onToggle).toHaveBeenCalledWith('files');
  });

  it('calls onToggle with "git" when git button is clicked', () => {
    const onToggle = vi.fn();
    const { container } = render(<NavBar activeSidebar={null} onToggle={onToggle} />);
    fireEvent.click(getNavButton(container, 'Source Control'));
    expect(onToggle).toHaveBeenCalledWith('git');
  });

  it('adds active class to files button when activeSidebar is "files"', () => {
    const { container } = render(<NavBar activeSidebar="files" onToggle={vi.fn()} />);
    const filesBtn = getNavButton(container, 'Explorer');
    expect(filesBtn.className).toContain('active');
  });

  it('adds active class to git button when activeSidebar is "git"', () => {
    const { container } = render(<NavBar activeSidebar="git" onToggle={vi.fn()} />);
    const gitBtn = getNavButton(container, 'Source Control');
    expect(gitBtn.className).toContain('active');
  });

  it('does not add active class when activeSidebar is null', () => {
    const { container } = render(<NavBar activeSidebar={null} onToggle={vi.fn()} />);
    const filesBtn = getNavButton(container, 'Explorer');
    const gitBtn = getNavButton(container, 'Source Control');
    expect(filesBtn.className).not.toContain('active');
    expect(gitBtn.className).not.toContain('active');
  });

  it('does not add active to files when git is active', () => {
    const { container } = render(<NavBar activeSidebar="git" onToggle={vi.fn()} />);
    const filesBtn = getNavButton(container, 'Explorer');
    expect(filesBtn.className).not.toContain('active');
  });

  it('does not show git badge when gitChangeCount is 0', () => {
    const { container } = render(
      <NavBar activeSidebar={null} onToggle={vi.fn()} gitChangeCount={0} />
    );
    expect(container.querySelector('.git-badge')).toBeNull();
  });

  it('shows git badge with count when gitChangeCount > 0', () => {
    const { container } = render(
      <NavBar activeSidebar={null} onToggle={vi.fn()} gitChangeCount={5} />
    );
    const badge = container.querySelector('.git-badge');
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toBe('5');
  });

  it('shows "99+" badge when gitChangeCount > 100', () => {
    const { container } = render(
      <NavBar activeSidebar={null} onToggle={vi.fn()} gitChangeCount={150} />
    );
    const badge = container.querySelector('.git-badge');
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toBe('99+');
  });

  it('shows badge count of exactly 100 as "100"', () => {
    const { container } = render(
      <NavBar activeSidebar={null} onToggle={vi.fn()} gitChangeCount={100} />
    );
    const badge = container.querySelector('.git-badge');
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toBe('100');
  });

  it('renders navbar container div', () => {
    const { container } = render(
      <NavBar activeSidebar={null} onToggle={vi.fn()} />
    );
    expect(container.querySelector('.navbar')).toBeTruthy();
  });

  it('renders terminal mode toggle button', () => {
    const { container } = render(
      <NavBar activeSidebar={null} onToggle={vi.fn()} />
    );
    expect(getNavButton(container, 'Terminal Mode')).toBeTruthy();
  });

  it('calls onToggle with "terminal-mode" when terminal mode button is clicked', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <NavBar activeSidebar={null} onToggle={onToggle} />
    );
    fireEvent.click(getNavButton(container, 'Terminal Mode'));
    expect(onToggle).toHaveBeenCalledWith('terminal-mode');
  });

  it('adds active class to terminal mode button when activeTerminal is true', () => {
    const { container } = render(
      <NavBar activeSidebar={null} activeTerminal={true} onToggle={vi.fn()} />
    );
    const btn = getNavButton(container, 'Terminal Mode');
    expect(btn.className).toContain('active');
  });

  it('renders chats toggle button', () => {
    const { container } = render(<NavBar activeSidebar={null} onToggle={vi.fn()} />);
    expect(getNavButton(container, 'Chat History')).toBeTruthy();
  });

  it('calls onToggle with "chats" when chats button is clicked', () => {
    const onToggle = vi.fn();
    const { container } = render(<NavBar activeSidebar={null} onToggle={onToggle} />);
    fireEvent.click(getNavButton(container, 'Chat History'));
    expect(onToggle).toHaveBeenCalledWith('chats');
  });

  it('adds active class to chats button when activeSidebar is "chats"', () => {
    const { container } = render(<NavBar activeSidebar="chats" onToggle={vi.fn()} />);
    const chatsBtn = getNavButton(container, 'Chat History');
    expect(chatsBtn.className).toContain('active');
  });

  it('disables chats button when terminal mode is active', () => {
    const { container } = render(<NavBar activeSidebar={null} activeTerminal={true} onToggle={vi.fn()} />);
    const chatsBtn = getNavButton(container, 'Chat History');
    expect(chatsBtn.className).toContain('disabled');
  });
});
