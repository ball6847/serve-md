/**
 * Pure fuzzy subsequence match (fzf-style).
 *
 * `score(query, target)` returns a non-negative score; `0` means no match.
 * Higher scores indicate better matches (e.g. consecutive matches, leading
 * matches, matches at word boundaries).
 *
 * Designed to be importable from Deno tests and from the browser bundle
 * (no DOM, no Node APIs).
 */

const MAX_SCORE = 1_000_000;

export function score(query: string, target: string): number {
  if (query.length === 0) return 1;
  if (target.length === 0) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  let qi = 0;
  let ti = 0;
  let total = 0;
  let lastMatchTi = -2;
  let consecutive = 0;

  while (qi < q.length && ti < t.length) {
    if (q[qi] === t[ti]) {
      const isBoundary = ti === 0 || isSeparator(t[ti - 1]);
      const isLeading = ti === 0;
      const isAfterSep = lastMatchTi === ti - 1;
      if (isAfterSep) {
        consecutive++;
        total += 10 + consecutive * 5;
      } else {
        consecutive = 0;
        total += 10;
        if (isLeading) total += 50;
        if (isBoundary) total += 30;
      }
      lastMatchTi = ti;
      qi++;
    }
    ti++;
  }
  if (qi < q.length) return 0;
  // Shorter targets with same matches win
  total += Math.max(0, MAX_SCORE - target.length * 100);
  return total;
}

function isSeparator(ch: string): boolean {
  return ch === "/" || ch === "-" || ch === "_" || ch === " " || ch === ".";
}

/**
 * Filter and rank entries by fuzzy match. Returns items with score > 0,
 * sorted by descending score.
 */
export interface FuzzyItem {
  path: string;
  label: string;
}

export function filter(items: FuzzyItem[], query: string, limit = 100): FuzzyItem[] {
  if (query.length === 0) {
    return items.slice(0, limit);
  }
  const out: Array<{ item: FuzzyItem; s: number }> = [];
  for (const item of items) {
    // Score against both path and label, take max
    const s = Math.max(score(query, item.path), score(query, item.label));
    if (s > 0) out.push({ item, s });
  }
  out.sort((a, b) => b.s - a.s);
  return out.slice(0, limit).map((x) => x.item);
}
