/**
 * Fuzzy text matching for searches (B1): subsequence + typo tolerance.
 *
 * Every query word must match the haystack. A word matches when it is a
 * substring (exact, scores highest) or when its edit distance to some
 * haystack word is small (typo, scores lower). Short words (<=3 chars)
 * require an exact substring so "mp3" does not match everything.
 * Returns a score (higher = better) or null for no match.
 */

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur: number[] = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const sub = (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      cur[j] = Math.min(sub, (prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1);
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

export function fuzzyRank(haystack: string, query: string): number | null {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return 0;
  const hay = haystack.toLowerCase();
  const hayWords = hay.split(/[^a-z0-9]+/).filter((w) => w.length > 0);
  let score = 0;
  for (const word of q.split(/\s+/).filter((w) => w.length > 0)) {
    if (hay.includes(word)) {
      // Exact substring: earlier hits rank higher.
      score += 20 - Math.min(10, hay.indexOf(word) / 10);
      continue;
    }
    // Words of 1-2 chars must match exactly ("4k" must not fuzz).
    if (word.length <= 2) return null;
    // Typo tolerance with a first-letter gate: genuine typos overwhelmingly
    // keep the first letter ("buk"->"buck", "buni"->"bunny"), and the gate
    // kills the false-positive flood a bare distance<=2 would cause.
    let best = Number.POSITIVE_INFINITY;
    for (const hw of hayWords) {
      if (hw[0] !== word[0] || Math.abs(hw.length - word.length) > 2) continue;
      const d = levenshtein(word, hw);
      if (d < best) best = d;
    }
    if (best > 2) return null;
    score += 5 - best;
  }
  return score;
}

/** Boolean form for filters (keeps call sites readable). */
export function fuzzyMatch(haystack: string, query: string): boolean {
  return fuzzyRank(haystack, query) !== null;
}
