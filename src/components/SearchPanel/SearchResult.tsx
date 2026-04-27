import { useState } from 'react';
import { ChevronRight, ChevronDown, Replace } from 'lucide-react';
import type { FileMatches } from '../../types';

export interface SearchResultProps {
  file: FileMatches;
  replacement: string;
  onReplaceMatch: (matchIndex: number) => void;
  onReplaceFile: () => void;
}

export default function SearchResult({ file, replacement, onReplaceMatch, onReplaceFile }: SearchResultProps) {
  const [expanded, setExpanded] = useState(true);
  const showReplace = replacement.length > 0;

  return (
    <div className="search-result">
      <div className="search-file-header">
        <button className="search-file-toggle" onClick={() => setExpanded(e => !e)}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="search-file-path">{file.path}</span>
          <span className="search-file-count">({file.matches.length})</span>
        </button>
        {showReplace && (
          <button
            className="search-file-replace"
            title="Replace all in file"
            onClick={onReplaceFile}
          >
            <Replace size={12} />
          </button>
        )}
      </div>
      {expanded && file.matches.map((m, i) => (
        <div key={`${m.line}:${m.column}`} className="search-match-row">
          <span className="search-match-line">{m.line}</span>
          <span className="search-match-preview">
            {m.preview.slice(0, m.matchStart)}
            {showReplace ? (
              <>
                <span className="search-match-old">{m.preview.slice(m.matchStart, m.matchEnd)}</span>
                <span className="search-match-new">{replacement}</span>
              </>
            ) : (
              <span className="search-match-hit">{m.preview.slice(m.matchStart, m.matchEnd)}</span>
            )}
            {m.preview.slice(m.matchEnd)}
          </span>
          {showReplace && (
            <button
              className="search-match-replace"
              title="Replace this match"
              onClick={() => onReplaceMatch(i)}
            >
              <Replace size={11} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
