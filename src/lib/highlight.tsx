import { Fragment, type ReactNode } from "react";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "in", "on", "at", "to", "for",
  "with", "by", "from", "is", "are", "was", "were", "be", "been", "being",
  "it", "this", "that", "these", "those", "as", "i", "me", "my", "you",
  "your", "we", "our", "they", "them", "their", "what", "which", "who",
  "whom", "where", "when", "why", "how", "all", "any", "both", "each",
  "few", "more", "most", "other", "some", "such", "no", "not", "only",
  "own", "same", "so", "than", "too", "very", "can", "will", "just",
  "don", "should", "now", "about",
]);

export function extractTerms(query: string | null | undefined): string[] {
  if (!query) return [];
  const tokens = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  // dedupe, keep order
  return Array.from(new Set(tokens));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildHighlightRegex(terms: string[]): RegExp | null {
  if (terms.length === 0) return null;
  const sorted = [...terms].sort((a, b) => b.length - a.length);
  return new RegExp(`(${sorted.map(escapeRegExp).join("|")})`, "gi");
}

export function highlightText(text: string, terms: string[]): ReactNode {
  const re = buildHighlightRegex(terms);
  if (!re) return text;
  const parts = text.split(re);
  return parts.map((part, i) =>
    re.test(part) ? (
      <mark
        key={i}
        className="bg-primary/20 text-foreground rounded px-0.5 font-medium"
      >
        {part}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/**
 * Find a windowed snippet around the first matching term.
 * Returns null if no terms match.
 */
export function findSnippet(
  text: string | null | undefined,
  terms: string[],
  window = 140,
): string | null {
  if (!text || terms.length === 0) return null;
  const lower = text.toLowerCase();
  let bestIdx = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (bestIdx < 0 || i < bestIdx)) bestIdx = i;
  }
  if (bestIdx < 0) return null;
  const half = Math.floor(window / 2);
  const start = Math.max(0, bestIdx - half);
  const end = Math.min(text.length, bestIdx + half);
  let snippet = text.slice(start, end).trim();
  if (start > 0) snippet = "…" + snippet;
  if (end < text.length) snippet = snippet + "…";
  return snippet;
}

/**
 * Count distinct matching terms across the candidate text fields.
 */
export function countMatchedTerms(
  fields: Array<string | null | undefined>,
  terms: string[],
): number {
  if (terms.length === 0) return 0;
  const blob = fields.filter(Boolean).join(" ").toLowerCase();
  let n = 0;
  for (const t of terms) if (blob.includes(t)) n++;
  return n;
}
