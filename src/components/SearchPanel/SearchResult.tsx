import type { FileMatches } from '../../types';

export interface SearchResultProps {
  file: FileMatches;
  replacement: string;
  onReplaceMatch: (matchIndex: number) => void;
  onReplaceFile: () => void;
}

export default function SearchResult({ file }: SearchResultProps) {
  return (
    <div className="search-result-stub" data-path={file.path}>
      {file.path} ({file.matches.length})
    </div>
  );
}
