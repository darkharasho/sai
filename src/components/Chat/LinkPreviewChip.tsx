import { useState, useEffect, useRef } from 'react';
import { SiJirasoftware, SiLinear, SiGithub } from '@icons-pack/react-simple-icons';
import { ExternalLink, User, AlertCircle } from 'lucide-react';
import type { LinkPreviewMatch } from './linkPreview';

// ─── Types ────────────────────────────────────────────────────────────────────

interface IssueData {
  title: string;
  status: string;
  statusColor?: string;
  type?: string;
  assignee?: string;
  assigneeAvatar?: string;
  priority?: string;
  url: string;
}

interface CacheEntry {
  data: IssueData;
  fetchedAt: number;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached(key: string): IssueData | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.fetchedAt < CACHE_TTL) return entry.data;
  if (entry) cache.delete(key);
  return null;
}

function setCache(key: string, data: IssueData) {
  cache.set(key, { data, fetchedAt: Date.now() });
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────

async function fetchJiraIssue(key: string, url: string): Promise<IssueData | null> {
  try {
    const res = await window.sai.jiraGetIssue(key);
    if (!res.ok) return null;
    const f = res.body.fields;
    return {
      title: f?.summary || key,
      status: f?.status?.name || 'Unknown',
      statusColor: f?.status?.statusCategory?.colorName === 'green' ? '#3fb950' :
                   f?.status?.statusCategory?.colorName === 'blue-gray' ? '#848d97' :
                   f?.status?.statusCategory?.colorName === 'yellow' ? '#d29922' : undefined,
      type: f?.issuetype?.name,
      assignee: f?.assignee?.displayName,
      assigneeAvatar: f?.assignee?.avatarUrls?.['24x24'],
      priority: f?.priority?.name,
      url,
    };
  } catch { return null; }
}

async function fetchLinearIssue(key: string, url: string): Promise<IssueData | null> {
  try {
    const res = await window.sai.linearGetIssue(key);
    if (!res.ok || !res.body?.data?.issueSearch?.nodes?.length) return null;
    const issue = res.body.data.issueSearch.nodes[0];
    return {
      title: issue.title || key,
      status: issue.state?.name || 'Unknown',
      statusColor: issue.state?.color,
      assignee: issue.assignee?.name,
      assigneeAvatar: issue.assignee?.avatarUrl,
      priority: issue.priorityLabel,
      url: issue.url || url,
    };
  } catch { return null; }
}

async function fetchGitHubIssue(meta: Record<string, string>, url: string): Promise<IssueData | null> {
  try {
    const res = await window.sai.githubApiGet(`/repos/${meta.owner}/${meta.repo}/issues/${meta.number}`);
    if (!res.ok) return null;
    const b = res.body;
    return {
      title: b.title || `#${meta.number}`,
      status: b.state || 'unknown',
      statusColor: b.state === 'open' ? '#3fb950' : '#8b949e',
      type: b.pull_request ? 'Pull Request' : 'Issue',
      assignee: b.assignee?.login,
      assigneeAvatar: b.assignee?.avatar_url,
      url: b.html_url || url,
    };
  } catch { return null; }
}

// ─── Component ────────────────────────────────────────────────────────────────

const providerLogos = {
  'jira': SiJirasoftware,
  'linear': SiLinear,
  'github-issues': SiGithub,
} as const;

const providerNames = {
  'jira': 'Jira',
  'linear': 'Linear',
  'github-issues': 'GitHub',
} as const;

interface Props {
  preview: LinkPreviewMatch;
  children?: React.ReactNode;
}

export default function LinkPreviewChip({ preview, children }: Props) {
  const [issue, setIssue] = useState<IssueData | null>(() => getCached(preview.url));
  const [state, setState] = useState<'loading' | 'loaded' | 'error' | 'unconfigured'>(
    getCached(preview.url) ? 'loaded' : 'loading'
  );
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (issue) return; // already cached

    let cancelled = false;

    (async () => {
      // Check if provider is configured
      if (preview.provider === 'jira') {
        const ok = await window.sai.jiraConfigured();
        if (!ok) { if (!cancelled) setState('unconfigured'); return; }
      } else if (preview.provider === 'linear') {
        const ok = await window.sai.linearConfigured();
        if (!ok) { if (!cancelled) setState('unconfigured'); return; }
      }
      // GitHub Issues uses existing auth — always try

      let data: IssueData | null = null;
      if (preview.provider === 'jira') {
        data = await fetchJiraIssue(preview.key, preview.url);
      } else if (preview.provider === 'linear') {
        data = await fetchLinearIssue(preview.key, preview.url);
      } else if (preview.provider === 'github-issues' && preview.meta) {
        data = await fetchGitHubIssue(preview.meta, preview.url);
      }

      if (cancelled) return;
      if (data) {
        setCache(preview.url, data);
        setIssue(data);
        setState('loaded');
      } else {
        setState('error');
      }
    })();

    return () => { cancelled = true; };
  }, [preview.url, preview.provider, preview.key, preview.meta, issue]);

  // Click outside to collapse
  useEffect(() => {
    if (!expanded) return;
    const handleClick = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [expanded]);

  const Logo = providerLogos[preview.provider];
  const providerName = providerNames[preview.provider];

  // Unconfigured or error: render as plain link
  if (state === 'unconfigured' || state === 'error') {
    return (
      <a href={preview.url} onClick={(e) => { e.preventDefault(); window.sai.openExternal(preview.url); }}>
        {children || preview.key}
      </a>
    );
  }

  return (
    <span className="link-preview-wrap" ref={cardRef}>
      <button
        type="button"
        className={`link-preview-chip${state === 'loading' ? ' link-preview-chip-loading' : ''}`}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpanded(!expanded); }}
      >
        <Logo size={12} className="link-preview-logo" />
        <span className="link-preview-key">{preview.key}</span>
        {state === 'loaded' && issue && (
          <>
            <span className="link-preview-dot" style={issue.statusColor ? { background: issue.statusColor } : undefined} />
            <span className="link-preview-status">{issue.status}</span>
            {issue.assignee && (
              <span className="link-preview-assignee">
                {issue.assigneeAvatar
                  ? <img src={issue.assigneeAvatar} alt="" className="link-preview-avatar" />
                  : <User size={10} />
                }
              </span>
            )}
          </>
        )}
        {state === 'loading' && <span className="link-preview-spinner" />}
      </button>

      {expanded && state === 'loaded' && issue && (
        <div className="link-preview-card">
          <div className="link-preview-card-header">
            <Logo size={16} className="link-preview-logo" />
            <span className="link-preview-card-key">{preview.key}</span>
            {issue.type && <span className="link-preview-card-type">{issue.type}</span>}
          </div>
          <div className="link-preview-card-title">{issue.title}</div>
          <div className="link-preview-card-meta">
            <span className="link-preview-card-status">
              <span className="link-preview-dot" style={issue.statusColor ? { background: issue.statusColor } : undefined} />
              {issue.status}
            </span>
            {issue.priority && (
              <span className="link-preview-card-priority">{issue.priority}</span>
            )}
            {issue.assignee && (
              <span className="link-preview-card-assignee">
                {issue.assigneeAvatar
                  ? <img src={issue.assigneeAvatar} alt="" className="link-preview-avatar link-preview-avatar-lg" />
                  : <User size={12} />
                }
                {issue.assignee}
              </span>
            )}
          </div>
          <button
            type="button"
            className="link-preview-card-open"
            onClick={(e) => { e.stopPropagation(); window.sai.openExternal(issue.url); }}
          >
            <ExternalLink size={12} />
            Open in {providerName}
          </button>
        </div>
      )}
      <style>{STYLES}</style>
    </span>
  );
}

const STYLES = `
  .link-preview-wrap {
    position: relative;
    display: inline;
  }
  .link-preview-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 7px;
    border-radius: 4px;
    font-size: 12px;
    font-family: 'Geist Mono', 'JetBrains Mono', ui-monospace, monospace;
    background: var(--elev-2);
    border: 1px solid var(--border);
    color: var(--text);
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
    vertical-align: baseline;
    line-height: 1.5;
    box-shadow: var(--elev-highlight);
  }
  .link-preview-chip:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
    border-color: color-mix(in srgb, var(--text) 20%, transparent);
  }
  .link-preview-chip-loading {
    opacity: 0.7;
  }
  .link-preview-logo {
    flex-shrink: 0;
    opacity: 0.7;
  }
  .link-preview-key {
    font-weight: 600;
  }
  .link-preview-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-muted);
    flex-shrink: 0;
  }
  .link-preview-status {
    font-size: 11px;
    color: var(--text-muted);
    font-family: inherit;
  }
  .link-preview-assignee {
    display: inline-flex;
    align-items: center;
  }
  .link-preview-avatar {
    width: 14px;
    height: 14px;
    border-radius: 50%;
  }
  .link-preview-avatar-lg {
    width: 16px;
    height: 16px;
  }
  .link-preview-spinner {
    width: 10px;
    height: 10px;
    border: 1.5px solid var(--border);
    border-top-color: var(--text-muted);
    border-radius: 50%;
    animation: link-preview-spin 0.6s linear infinite;
  }
  @keyframes link-preview-spin {
    to { transform: rotate(360deg); }
  }

  /* Expanded card */
  .link-preview-card {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 100;
    min-width: 280px;
    max-width: 400px;
    background: var(--elev-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
    box-shadow: var(--shadow-card), var(--elev-highlight);
    font-family: inherit;
  }
  .link-preview-card-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }
  .link-preview-card-key {
    font-family: 'Geist Mono', 'JetBrains Mono', ui-monospace, monospace;
    font-weight: 700;
    font-size: 12px;
    color: var(--text);
  }
  .link-preview-card-type {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    background: var(--bg-secondary);
    color: var(--text-muted);
    margin-left: auto;
  }
  .link-preview-card-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--text);
    line-height: 1.4;
    margin-bottom: 8px;
  }
  .link-preview-card-meta {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 11px;
    color: var(--text-muted);
    margin-bottom: 10px;
  }
  .link-preview-card-status {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .link-preview-card-assignee {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .link-preview-card-open {
    display: flex;
    align-items: center;
    gap: 5px;
    width: 100%;
    padding: 6px 10px;
    border-radius: 5px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-family: inherit;
    transition: background 0.12s ease;
  }
  .link-preview-card-open:hover {
    background: color-mix(in srgb, var(--text) 10%, transparent);
    color: var(--text);
  }
`;
