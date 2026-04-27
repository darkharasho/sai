import { useEffect, useRef, useState } from 'react';
import { Search, CaseSensitive, WholeWord, Regex, ChevronRight, ChevronDown, Replace, RotateCw, X } from 'lucide-react';
import { useSearch } from '../../hooks/useSearch';
import type { SearchQuery } from '../../types';
import SearchResult from './SearchResult';
import './SearchPanel.css';

export interface SearchPanelProps {
  projectPath: string;
  getOpenBuffers: () => { path: string; content: string }[];
  applyMonacoEdits?: (path: string, edits: { line: number; column: number; length: number; replacement: string }[]) => void;
  onOpenFile?: (filePath: string, line?: number) => void;
}

export default function SearchPanel({ projectPath, getOpenBuffers, applyMonacoEdits, onOpenFile }: SearchPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pattern, setPattern] = useState('');
  const [replacement, setReplacement] = useState('');
  const [replaceVisible, setReplaceVisible] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [includeGlob, setIncludeGlob] = useState('');
  const [excludeGlob, setExcludeGlob] = useState('');
  const [useGitignore, setUseGitignore] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const search = useSearch({ rootPath: projectPath, getOpenBuffers, applyMonacoEdits });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const buildQuery = (): SearchQuery => ({
    pattern,
    caseSensitive,
    wholeWord,
    regex,
    includeGlobs: includeGlob.split(',').map(s => s.trim()).filter(Boolean),
    excludeGlobs: excludeGlob.split(',').map(s => s.trim()).filter(Boolean),
    useGitignore,
  });

  // Debounced re-run when any search-affecting state changes
  useEffect(() => {
    const t = setTimeout(() => {
      search.runSearch(buildQuery());
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern, caseSensitive, wholeWord, regex, includeGlob, excludeGlob, useGitignore]);

  const totalMatches = search.results?.files.reduce((sum, f) => sum + f.matches.length, 0) ?? 0;
  const totalFiles = search.results?.files.length ?? 0;

  const handleReplaceAllClick = () => {
    if (totalMatches === 0) return;
    setConfirmOpen(true);
  };

  const handleReplaceAllConfirm = async () => {
    setConfirmOpen(false);
    await search.replaceAll(replacement);
  };

  const handleClear = () => {
    setPattern('');
    setReplacement('');
    setIncludeGlob('');
    setExcludeGlob('');
    inputRef.current?.focus();
  };

  return (
    <aside className="search-panel">
      <div className="search-header">
        <span className="search-header-icon"><Search size={14} /></span>
        <span className="search-header-title">Search</span>
        <button
          className="search-header-action"
          title="Refresh"
          onClick={() => search.runSearch(buildQuery())}
        ><RotateCw size={12} /></button>
        <button
          className="search-header-action"
          title="Clear"
          onClick={handleClear}
        ><X size={12} /></button>
      </div>

      <div className="search-group">
        <div className="search-line">
          <button
            className="search-collapse-toggle"
            title={replaceVisible ? 'Hide Replace' : 'Toggle Replace'}
            onClick={() => setReplaceVisible(v => !v)}
          >{replaceVisible ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</button>
          <span className="search-line-icon"><Search size={11} /></span>
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder="Search"
            value={pattern}
            onChange={e => setPattern(e.target.value)}
          />
          <button
            className={`search-toggle ${caseSensitive ? 'active' : ''}`}
            title="Case sensitive (Aa)"
            onClick={() => setCaseSensitive(v => !v)}
          ><CaseSensitive size={12} /></button>
          <button
            className={`search-toggle ${wholeWord ? 'active' : ''}`}
            title="Whole word"
            onClick={() => setWholeWord(v => !v)}
          ><WholeWord size={12} /></button>
          <button
            className={`search-toggle ${regex ? 'active' : ''}`}
            title="Regex (.*)"
            onClick={() => setRegex(v => !v)}
          ><Regex size={12} /></button>
        </div>
        {replaceVisible && (
          <>
            <div className="search-divider" />
            <div className="search-line">
              <span className="search-collapse-toggle-spacer" />
              <span className="search-line-icon"><Replace size={11} /></span>
              <input
                type="text"
                className="search-input"
                placeholder="Replace"
                value={replacement}
                onChange={e => setReplacement(e.target.value)}
              />
            </div>
          </>
        )}
      </div>

      <button
        className="search-details-toggle"
        onClick={() => setShowDetails(v => !v)}
      >
        {showDetails ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span>Toggle search details</span>
      </button>

      {showDetails && (
        <div className="search-details">
          <div className="search-input-wrap">
            <input
              type="text"
              className="search-input"
              placeholder="files to include"
              value={includeGlob}
              onChange={e => setIncludeGlob(e.target.value)}
            />
          </div>
          <div className="search-input-wrap">
            <input
              type="text"
              className="search-input"
              placeholder="files to exclude"
              value={excludeGlob}
              onChange={e => setExcludeGlob(e.target.value)}
            />
          </div>
          <label className="search-checkbox">
            <input
              type="checkbox"
              checked={useGitignore}
              onChange={e => setUseGitignore(e.target.checked)}
            />
            Use .gitignore
          </label>
        </div>
      )}

      {search.results && search.results.files.length > 0 && (
        <div className="search-section-label">
          <span>Results</span>
          <span className="search-section-count">{totalMatches}</span>
        </div>
      )}

      <div className="search-results-pane">
        {search.state === 'idle' && (
          <div className="search-empty">Type to search</div>
        )}
        {search.state === 'searching' && (
          <div className="search-empty">Searching…</div>
        )}
        {search.state === 'error' && (
          <div className="search-error">{search.error}</div>
        )}
        {(search.state === 'results' || search.state === 'replacing') && search.results && (
          <>
            {search.results.files.map(file => (
              <SearchResult
                key={file.path}
                file={file}
                replacement={replacement}
                onReplaceMatch={(idx) => search.replaceMatch(file.path, idx, replacement)}
                onReplaceFile={() => search.replaceFile(file.path, replacement)}
                onMatchClick={onOpenFile ? (line) => onOpenFile(`${projectPath}/${file.path}`, line) : undefined}
              />
            ))}
            {search.results.files.length === 0 && (
              <div className="search-empty">No results</div>
            )}
          </>
        )}
      </div>

      <div className="search-footer">
        <span className="search-summary">
          {search.results
            ? `${totalMatches} result${totalMatches === 1 ? '' : 's'} in ${totalFiles} file${totalFiles === 1 ? '' : 's'}${search.results.truncated ? ' (truncated)' : ''}`
            : ''}
        </span>
        {replaceVisible && (
          <button
            className={`search-replace-all ${replacement.length === 0 ? 'muted' : ''}`}
            disabled={totalMatches === 0 || search.state === 'replacing'}
            onClick={handleReplaceAllClick}
          >
            Replace All
          </button>
        )}
      </div>

      {confirmOpen && (
        <div className="search-confirm-overlay" onClick={() => setConfirmOpen(false)}>
          <div className="search-confirm-dialog" onClick={e => e.stopPropagation()}>
            <p>About to replace {totalMatches} match{totalMatches === 1 ? '' : 'es'} in {totalFiles} file{totalFiles === 1 ? '' : 's'}. Continue?</p>
            <div className="search-confirm-buttons">
              <button onClick={() => setConfirmOpen(false)}>Cancel</button>
              <button className="primary" onClick={handleReplaceAllConfirm}>Replace All</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
