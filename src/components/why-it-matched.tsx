import { useEffect, useState } from "react";
import {
  FileText,
  ImageIcon,
  AudioLines,
  Sparkles,
  Loader2,
  Type,
  AlignLeft,
  Wand2,
} from "lucide-react";
import { explainMatch } from "@/server/items.functions";
import { findSnippet, highlightText, extractTerms } from "@/lib/highlight";

type FieldKey = "title" | "description" | "ai_text";

type FieldRow = {
  field: string;
  source_text: string;
  trigram_similarity: number;
  lexical_rank: number;
  combined_score: number;
};

type ContribToken = { token: string; weight: number; fields: string[] };

type ExplainResult = {
  overall_score: number | null;
  breakdown: FieldRow[];
  contributing_tokens: ContribToken[];
  query_tokens: string[];
};

const FIELD_META: Record<
  FieldKey,
  { label: string; icon: typeof Type; description: (mod: string) => string }
> = {
  title: {
    label: "Title",
    icon: Type,
    description: () => "The item's title text.",
  },
  description: {
    label: "Description",
    icon: AlignLeft,
    description: () => "The human-written description.",
  },
  ai_text: {
    label: "AI text",
    icon: Wand2,
    description: (mod) =>
      mod === "image"
        ? "Gemini's auto-generated description of the image."
        : mod === "audio"
          ? "Gemini's transcript and summary of the audio."
          : "The body text used as the search representation.",
  },
};

function modalityIcon(mod: string) {
  return mod === "image" ? ImageIcon : mod === "audio" ? AudioLines : FileText;
}

export function WhyItMatched({
  itemId,
  itemModality,
  queryText,
  queryType,
}: {
  itemId: string;
  itemModality: string;
  queryText: string;
  queryType?: "text" | "image" | "audio";
}) {
  const [data, setData] = useState<ExplainResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    explainMatch({ data: { id: itemId, query_text: queryText } })
      .then((r) => {
        if (cancelled) return;
        setData(r as ExplainResult);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to explain match");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId, queryText]);

  if (loading) {
    return (
      <div className="mt-8 rounded-2xl border border-border bg-card p-5 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Analyzing why this item matched…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mt-8 rounded-2xl border border-destructive/40 bg-destructive/5 p-5 text-sm text-destructive">
        {error ?? "Could not compute explanation."}
      </div>
    );
  }

  const QueryIcon = modalityIcon(queryType ?? "text");
  const ItemIcon = modalityIcon(itemModality);

  const breakdown = data.breakdown.filter((f) => f.source_text.trim().length > 0);
  const max = Math.max(0.0001, ...breakdown.map((f) => f.combined_score));
  const tokens = data.contributing_tokens;
  const allTerms = tokens.length > 0
    ? tokens.map((t) => t.token)
    : extractTerms(queryText);

  // Best matched snippet across the fields, weighted by which field
  // contributed most (so we surface the segment doing the heavy lifting).
  const sortedFields = [...breakdown].sort(
    (a, b) => b.combined_score - a.combined_score,
  );
  let topSnippet: { field: string; snippet: string } | null = null;
  for (const f of sortedFields) {
    const s = findSnippet(f.source_text, allTerms, 200);
    if (s) {
      topSnippet = { field: f.field, snippet: s };
      break;
    }
  }

  return (
    <div className="mt-8 rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-5 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wide">
            Why it matched
          </h2>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <QueryIcon className="h-3.5 w-3.5" />
            {queryType ?? "text"}
          </span>
          <span>→</span>
          <span className="inline-flex items-center gap-1">
            <ItemIcon className="h-3.5 w-3.5" />
            {itemModality}
          </span>
        </div>
      </div>

      <div className="p-5 space-y-6">
        {/* Top matched snippet */}
        {topSnippet && (
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              Top matched segment
              <span className="ml-2 inline-flex items-center rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-foreground">
                {FIELD_META[topSnippet.field as FieldKey]?.label ??
                  topSnippet.field}
              </span>
            </div>
            <p className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm leading-relaxed">
              {highlightText(topSnippet.snippet, allTerms)}
            </p>
          </div>
        )}

        {/* Top contributing tokens */}
        {tokens.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              Top contributing tokens
            </div>
            <div className="flex flex-wrap gap-1.5">
              {tokens.map((t) => {
                const intensity = Math.min(
                  1,
                  t.weight / (tokens[0]?.weight || 1),
                );
                return (
                  <span
                    key={t.token}
                    title={`Found in: ${t.fields.join(", ")} (weight ${t.weight})`}
                    className="inline-flex items-center gap-1 rounded-full border border-primary/30 px-2 py-0.5 text-xs font-medium text-foreground"
                    style={{
                      backgroundColor: `color-mix(in oklab, var(--primary) ${
                        10 + intensity * 25
                      }%, transparent)`,
                    }}
                  >
                    <span className="font-mono">{t.token}</span>
                    <span className="text-[10px] text-muted-foreground">
                      ×{t.weight}
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Per-field (modality source) breakdown */}
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-3">
            Field-by-field similarity
            <span className="normal-case font-normal ml-2 text-muted-foreground/80">
              — combined score per source the ranker actually saw
            </span>
          </div>

          {breakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This item has no indexable text fields.
            </p>
          ) : (
            <ul className="space-y-3">
              {sortedFields.map((f) => {
                const meta = FIELD_META[f.field as FieldKey];
                if (!meta) return null;
                const Icon = meta.icon;
                const pct = (f.combined_score / max) * 100;
                return (
                  <li
                    key={f.field}
                    className="rounded-lg border border-border p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium">
                          {meta.label}
                        </span>
                        <span className="text-xs text-muted-foreground truncate">
                          · {meta.description(itemModality)}
                        </span>
                      </div>
                      <span className="font-mono text-xs text-muted-foreground shrink-0">
                        {(f.combined_score * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-primary to-accent transition-all"
                        style={{ width: `${Math.max(2, pct)}%` }}
                      />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                      <span>
                        Trigram:{" "}
                        <span className="font-mono">
                          {f.trigram_similarity.toFixed(3)}
                        </span>
                      </span>
                      <span>
                        Lexical:{" "}
                        <span className="font-mono">
                          {f.lexical_rank.toFixed(3)}
                        </span>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground leading-relaxed border-t border-border pt-3">
          Note: every modality is normalized into text before ranking — images
          become Gemini-generated descriptions and audio becomes Gemini
          transcripts. The "AI text" row above is the source representation for
          this item's modality. The combined score is{" "}
          <span className="font-mono">
            max(trigram, lexical × 0.5)
          </span>{" "}
          — exactly what the database uses for ordering.
        </p>
      </div>
    </div>
  );
}
