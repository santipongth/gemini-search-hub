import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { searchItems } from "@/server/items.functions";
import { logSearch } from "@/server/analytics.functions";
import { ItemCard, type ItemSummary } from "@/components/item-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search as SearchIcon, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { extractTerms } from "@/lib/highlight";

const ResultsSearch = z.object({
  q: z.string().min(1).max(2000),
  qt: z.enum(["text", "image", "audio"]).default("text"),
});

export const Route = createFileRoute("/results")({
  validateSearch: (s) => ResultsSearch.parse(s),
  head: ({ match }) => ({
    meta: [
      { title: `${match.search.q.slice(0, 50)} — Lumen search` },
      { name: "description", content: `Search results for "${match.search.q}".` },
      // Don't index search result pages.
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResultsPage,
});

function ResultsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [text, setText] = useState(search.q);
  const [results, setResults] = useState<ItemSummary[] | null>(null);
  const [interpreted, setInterpreted] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const searchEventIdRef = useRef<string | null>(null);

  useEffect(() => {
    setText(search.q);
    runSearch(search.q, search.qt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.q, search.qt]);

  const runSearch = async (q: string, qt: "text" | "image" | "audio") => {
    setBusy(true);
    try {
      const res = await searchItems({
        data: {
          query_type: qt === "text" ? "text" : "text",
          text: q,
          modality_filter: "all",
          min_similarity: 0,
          limit: 24,
        },
      });
      setResults(res.results as ItemSummary[]);
      setInterpreted(res.interpreted_query);

      // Fire-and-forget analytics log (with latency + vector flag).
      logSearch({
        data: {
          query_text: q,
          query_type: "text",
          modality_filter: "all",
          result_count: res.results.length,
          latency_ms: res.latency_ms,
          used_vector: res.used_vector,
          top_similarity: res.top_similarity ?? null,
        },
      })
        .then((r) => {
          searchEventIdRef.current = r.id;
        })
        .catch(() => {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Search failed");
      setResults([]);
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    if (!q) return;
    navigate({ to: "/results", search: { q, qt: "text" } });
  };

  const queryTerms = extractTerms(interpreted ?? search.q);

  return (
    <div className="container mx-auto px-6 py-8 max-w-5xl">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-4 w-4" /> New search
      </Link>

      <form onSubmit={onSubmit} className="flex gap-2 mb-6">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search the library..."
            className="pl-9 h-11 text-base"
            disabled={busy}
          />
        </div>
        <Button type="submit" disabled={busy || !text.trim()} size="lg" className="gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchIcon className="h-4 w-4" />}
          Search
        </Button>
      </form>

      <div className="mb-4 text-sm text-muted-foreground">
        Results for <span className="font-medium text-foreground">"{search.q}"</span>
        {results && <> · {results.length} match{results.length === 1 ? "" : "es"}</>}
      </div>

      {busy ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card aspect-[4/3] animate-pulse" />
          ))}
        </div>
      ) : results && results.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-border rounded-xl">
          <p className="text-muted-foreground">No matches. Try broadening your query.</p>
        </div>
      ) : results ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {results.map((r, idx) => (
            <ItemCard
              key={r.id}
              item={r}
              queryTerms={queryTerms}
              queryType="text"
              rawQuery={search.q}
              onClick={() => {
                import("@/server/analytics.functions").then(({ logResultClick }) => {
                  logResultClick({
                    data: {
                      search_event_id: searchEventIdRef.current,
                      item_id: r.id,
                      position: idx,
                    },
                  }).catch(() => {});
                });
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
