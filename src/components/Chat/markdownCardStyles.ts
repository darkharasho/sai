/** Shared markdown element styling for compact "card" contexts
 *  (tool cards, plan review). Layout/padding/scroll stays on the host. */
export const CARD_MD_CLASS = 'card-md';

export const CARD_MD_STYLES = `
  .card-md h1,
  .card-md h2,
  .card-md h3 {
    margin: 14px 0 6px;
    font-weight: 700;
    color: var(--text);
  }
  .card-md h1 { font-size: 15px; }
  .card-md h2 { font-size: 13.5px; }
  .card-md h3 { font-size: 12.5px; }
  .card-md h1:first-child,
  .card-md h2:first-child,
  .card-md h3:first-child { margin-top: 0; }
  .card-md p { margin: 6px 0; }
  .card-md ul,
  .card-md ol {
    margin: 4px 0;
    padding-left: 20px;
  }
  .card-md li { margin: 2px 0; }
  .card-md code {
    font-family: 'Geist Mono', 'JetBrains Mono', ui-monospace, monospace;
    font-size: 11.5px;
    background: var(--bg-secondary);
    padding: 1px 4px;
    border-radius: 3px;
  }
  .card-md pre {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    overflow-x: auto;
    margin: 8px 0;
  }
  .card-md pre code {
    background: transparent;
    padding: 0;
  }
  .card-md table {
    width: 100%;
    border-collapse: collapse;
    margin: 8px 0;
    font-size: 11.5px;
  }
  .card-md th,
  .card-md td {
    border: 1px solid var(--border);
    padding: 4px 8px;
    text-align: left;
  }
  .card-md th {
    background: var(--bg-secondary);
    font-weight: 600;
  }
  .card-md hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 12px 0;
  }
  .card-md a {
    color: var(--accent);
    text-decoration: underline;
  }
  .card-md a:hover { color: var(--accent-hover); }
  .card-md strong { color: var(--text); }
  .card-md blockquote {
    margin: 6px 0;
    padding: 4px 12px;
    border-left: 3px solid var(--border);
    color: var(--text-muted);
  }
`;
