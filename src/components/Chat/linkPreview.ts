// Provider registry for issue tracker link previews.
// Each provider defines a URL pattern and key extraction logic.

export interface LinkPreviewProvider {
  id: 'jira' | 'linear' | 'github-issues';
  pattern: RegExp;
  extractKey(match: RegExpExecArray): { key: string; meta?: Record<string, string> };
}

export interface LinkPreviewMatch {
  provider: LinkPreviewProvider['id'];
  key: string;
  url: string;
  /** Extra metadata extracted from the URL (e.g. owner/repo for GitHub). */
  meta?: Record<string, string>;
}

const providers: LinkPreviewProvider[] = [
  {
    id: 'jira',
    // https://{domain}.atlassian.net/browse/{KEY-123}
    pattern: /https:\/\/([a-z0-9-]+\.atlassian\.net)\/browse\/([A-Z][A-Z0-9]+-\d+)/i,
    extractKey(m) {
      return { key: m[2], meta: { domain: m[1] } };
    },
  },
  {
    id: 'linear',
    // https://linear.app/{team}/issue/{KEY-123}
    pattern: /https:\/\/linear\.app\/([a-z0-9-]+)\/issue\/([A-Z][A-Z0-9]+-\d+)/i,
    extractKey(m) {
      return { key: m[2], meta: { team: m[1] } };
    },
  },
  {
    id: 'github-issues',
    // https://github.com/{owner}/{repo}/issues/{number}
    pattern: /https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/,
    extractKey(m) {
      return { key: `${m[1]}/${m[2]}#${m[3]}`, meta: { owner: m[1], repo: m[2], number: m[3] } };
    },
  },
];

/** Check if a single URL matches any known issue tracker provider. */
export function matchLinkPreview(url: string): LinkPreviewMatch | null {
  for (const provider of providers) {
    const m = provider.pattern.exec(url);
    if (m) {
      const { key, meta } = provider.extractKey(m);
      return { provider: provider.id, key, url, meta };
    }
  }
  return null;
}
