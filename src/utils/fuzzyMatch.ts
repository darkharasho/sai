export interface FuzzyResult {
  path: string;
  score: number;
  matchIndices: number[]; // indices into the filename for highlight rendering
}

export function fuzzyMatch(query: string, candidates: string[], maxResults = 50): FuzzyResult[] {
  if (!query) return candidates.slice(0, maxResults).map(p => ({ path: p, score: 0, matchIndices: [] }));

  const lowerQuery = query.toLowerCase();
  const results: FuzzyResult[] = [];

  for (const candidate of candidates) {
    const filename = candidate.split('/').pop() || candidate;
    const lowerFilename = filename.toLowerCase();
    const lowerCandidate = candidate.toLowerCase();

    // Try matching against filename first, then full path
    const filenameMatch = matchChars(lowerQuery, lowerFilename);
    const pathMatch = filenameMatch ? null : matchChars(lowerQuery, lowerCandidate);

    if (!filenameMatch && !pathMatch) continue;

    const isFilename = !!filenameMatch;
    const { indices } = (filenameMatch || pathMatch)!;
    let score = 0;

    // Bonus: filename match vs path match
    if (isFilename) score += 100;

    // Bonus: consecutive matches
    for (let i = 1; i < indices.length; i++) {
      if (indices[i] === indices[i - 1] + 1) score += 10;
    }

    // Bonus: match at start of filename
    if (isFilename && indices[0] === 0) score += 50;

    // Bonus: match after separator (/, ., -, _)
    const target = isFilename ? lowerFilename : lowerCandidate;
    for (const idx of indices) {
      if (idx > 0 && '/.-_'.includes(target[idx - 1])) score += 20;
    }

    // Penalty: longer paths
    score -= candidate.length * 0.5;

    // Penalty: spread between matches
    if (indices.length > 1) {
      score -= (indices[indices.length - 1] - indices[0] - indices.length + 1) * 2;
    }

    results.push({ path: candidate, score, matchIndices: isFilename ? indices : [] });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

function matchChars(query: string, target: string): { indices: number[] } | null {
  const indices: number[] = [];
  let ti = 0;
  for (let qi = 0; qi < query.length; qi++) {
    const found = target.indexOf(query[qi], ti);
    if (found === -1) return null;
    indices.push(found);
    ti = found + 1;
  }
  return { indices };
}
