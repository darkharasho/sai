import {
  Bug,
  Code,
  FileCode,
  FileText,
  GitPullRequest,
  Globe,
  GraduationCap,
  Anchor,
  Layout,
  Play,
  Puzzle,
  ScrollText,
  Server,
  Settings,
  Shield,
  Sparkles,
  Terminal,
  Wrench,
} from 'lucide-react';
import type { FC } from 'react';

type LucideIcon = FC<{ size?: number; className?: string }>;

const iconMap: [RegExp, LucideIcon][] = [
  [/github/, GitPullRequest],
  [/git|commit|pr-review/, GitPullRequest],
  [/security/, Shield],
  [/frontend|design|layout/, Layout],
  [/terminal|shell|cli/, Terminal],
  [/hook/, Anchor],
  [/lsp|clangd|gopls|pyright|typescript-lsp|ruby-lsp|rust-analyzer|jdtls|kotlin|csharp|php|lua|swift/, FileCode],
  [/code-review|review/, Bug],
  [/code-simplif|simplif/, Sparkles],
  [/mcp|server/, Server],
  [/plugin-dev|sdk-dev|skill-creator/, Wrench],
  [/playground|example/, Play],
  [/session-report|report/, ScrollText],
  [/math|olympiad/, GraduationCap],
  [/style|output-style/, FileText],
  [/setup|config|settings|management/, Settings],
  [/feature-dev|feature/, Code],
  [/web|browser|globe/, Globe],
];

export function getPluginIcon(name: string): LucideIcon {
  const lower = (name || '').toLowerCase();
  for (const [pattern, icon] of iconMap) {
    if (pattern.test(lower)) return icon;
  }
  return Puzzle;
}

interface PluginIconProps {
  name: string;
  size?: number;
  className?: string;
}

export default function PluginIcon({ name, size = 14, className }: PluginIconProps) {
  const Icon = getPluginIcon(name);
  return <Icon size={size} className={className} />;
}
