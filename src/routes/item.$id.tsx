import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { getItem, findSimilar, deleteItem } from "@/server/items.functions";
import { ItemCard, type ItemSummary, publicUrl } from "@/components/item-card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Sparkles,
  Trash2,
  Loader2,
  Info,
  FileText,
  ImageIcon,
  AudioLines,
} from "lucide-react";
import { toast } from "sonner";
import { extractTerms, highlightText } from "@/lib/highlight";
import { WhyItMatched } from "@/components/why-it-matched";
import { useAuth } from "@/hooks/use-auth";

const ItemSearch = z.object({
  q: z.string().optional(),
  qt: z.enum(["text", "image", "audio"]).optional(),
  sim: z.number().min(0).max(1).optional(),
});

export const Route = createFileRoute("/item/$id")({
  validateSearch: (s) => ItemSearch.parse(s),
  loader: ({ params }) => getItem({ data: { id: params.id } }),
  component: ItemPage,
  errorComponent: ({ error }) => (
    <div className="container mx-auto px-6 py-20 text-center">
      <p className="text-muted-foreground">{error.message}</p>
      <Link to="/" className="text-primary underline mt-4 inline-block">Back to library</Link>
    </div>
  ),
});

function ItemPage() {
  const { item } = Route.useLoaderData() as { item: ItemSummary };
  const search = Route.useSearch();
  const router = useRouter();
  const { isAdmin } = useAuth();
  const [similar, setSimilar] = useState<ItemSummary[] | null>(null);
  const [busy, setBusy] = useState(false);

  const hasSearchQuery = !!(search.q && search.q.trim().length > 0);
  const backTo = hasSearchQuery ? "/results" : "/";
  const backLabel = hasSearchQuery ? "Back to search results" : "Back to library";
  const backSearch = hasSearchQuery
    ? { q: search.q!, qt: search.qt ?? "text" }
    : undefined;

  const url = publicUrl(item.storage_path);
  const queryTerms = extractTerms(search.q);
  const hasSearchContext = queryTerms.length > 0 || typeof search.sim === "number";

  const onSimilar = async () => {
    setBusy(true);
    try {
      const r = await findSimilar({ data: { id: item.id, limit: 8 } });
      setSimilar(r.results as ItemSummary[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!confirm("Delete this item?")) return;
    try {
      await deleteItem({ data: { id: item.id } });
      toast.success("Deleted");
      router.navigate({ to: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div className="container mx-auto px-6 py-10 max-w-4xl">
      <Link
        to={backTo}
        search={backSearch as never}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ArrowLeft className="h-4 w-4" /> {backLabel}
      </Link>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {item.modality === "image" && url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={item.title ?? ""} className="w-full max-h-[60vh] object-contain bg-muted" />
        )}
        {item.modality === "audio" && url && (
          <div className="p-8 bg-muted/30 flex justify-center">
            <audio controls src={url} className="w-full max-w-lg" />
          </div>
        )}
        {item.modality === "text" && (
          <div className="p-8 bg-muted/30">
            <p className="font-serif text-lg leading-relaxed whitespace-pre-wrap">
              {queryTerms.length > 0 && item.text_content
                ? highlightText(item.text_content, queryTerms)
                : item.text_content}
            </p>
          </div>
        )}

        <div className="p-6 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">{item.modality}</span>
          </div>
          <h1 className="text-2xl font-semibold">
            {queryTerms.length > 0 && item.title
              ? highlightText(item.title, queryTerms)
              : item.title ?? "Untitled"}
          </h1>
          {item.description && (
            <p className="text-muted-foreground">
              {queryTerms.length > 0
                ? highlightText(item.description, queryTerms)
                : item.description}
            </p>
          )}
          {item.modality !== "text" && item.text_content && (
            <details
              className="text-sm text-muted-foreground"
              open={
                queryTerms.length > 0 &&
                queryTerms.some((t) =>
                  item.text_content!.toLowerCase().includes(t),
                )
              }
            >
              <summary className="cursor-pointer hover:text-foreground">
                AI-generated {item.modality === "audio" ? "transcript" : "description"} (used for matching)
              </summary>
              <p className="mt-2 whitespace-pre-wrap">
                {queryTerms.length > 0
                  ? highlightText(item.text_content, queryTerms)
                  : item.text_content}
              </p>
            </details>
          )}

          <div className="flex gap-2 pt-2">
            <Button onClick={onSimilar} disabled={busy} className="gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Find similar
            </Button>
            <Button onClick={onDelete} variant="outline" className="gap-2">
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </div>
        </div>
      </div>

      {hasSearchContext && (
        <SimilarityDetailsPanel
          similarity={search.sim}
          queryType={search.qt}
          query={search.q}
          itemModality={item.modality}
        />
      )}

      {search.q && search.q.trim().length > 0 && (
        <WhyItMatched
          itemId={item.id}
          itemModality={item.modality}
          queryText={search.q}
          queryType={search.qt}
        />
      )}

      {similar && (
        <div className="mt-10">
          <h2 className="text-xl font-semibold mb-4">Similar items</h2>
          {similar.length === 0 ? (
            <p className="text-muted-foreground text-sm">No similar items found yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {similar.map((s) => <ItemCard key={s.id} item={s} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SimilarityDetailsPanel({
  similarity,
  queryType,
  query,
  itemModality,
}: {
  similarity?: number;
  queryType?: "text" | "image" | "audio";
  query?: string;
  itemModality: string;
}) {
  const pct = typeof similarity === "number" ? similarity * 100 : null;
  const tier =
    pct === null
      ? null
      : pct >= 80
        ? { label: "Strong match", color: "text-emerald-600", bar: "bg-emerald-500" }
        : pct >= 60
          ? { label: "Good match", color: "text-primary", bar: "bg-primary" }
          : pct >= 40
            ? { label: "Loose match", color: "text-amber-600", bar: "bg-amber-500" }
            : { label: "Weak match", color: "text-muted-foreground", bar: "bg-muted-foreground" };

  const QueryIcon =
    queryType === "image" ? ImageIcon : queryType === "audio" ? AudioLines : FileText;
  const ItemIcon =
    itemModality === "image" ? ImageIcon : itemModality === "audio" ? AudioLines : FileText;

  const explanation =
    queryType === "text"
      ? "Your text query was embedded with Gemini, then compared against the text representation of every item."
      : queryType === "image"
        ? "Your image was first described by Gemini, then that description was embedded and compared against every item."
        : queryType === "audio"
          ? "Your audio was transcribed by Gemini, then that transcript was embedded and compared against every item."
          : "Items are compared using Gemini text embeddings of their content.";

  const itemBasis =
    itemModality === "text"
      ? "the item's own text"
      : itemModality === "image"
        ? "an AI-generated description of the image"
        : "an AI-generated transcript of the audio";

  return (
    <div className="mt-8 rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Info className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold uppercase tracking-wide">Similarity details</h2>
      </div>

      {pct !== null && tier && (
        <div className="mb-5">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className={`text-3xl font-semibold font-mono ${tier.color}`}>
              {pct.toFixed(1)}%
            </span>
            <span className={`text-sm font-medium ${tier.color}`}>{tier.label}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full ${tier.bar} transition-all`}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Cosine similarity between your query embedding and this item's embedding.
            Higher means more semantically related.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <div className="text-xs text-muted-foreground mb-1">Your query</div>
          <div className="flex items-center gap-2 text-sm font-medium capitalize">
            <QueryIcon className="h-4 w-4" />
            {queryType ?? "—"}
          </div>
          {query && (
            <div className="mt-2 text-xs text-muted-foreground line-clamp-3 italic">
              "{query}"
            </div>
          )}
        </div>
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <div className="text-xs text-muted-foreground mb-1">This item</div>
          <div className="flex items-center gap-2 text-sm font-medium capitalize">
            <ItemIcon className="h-4 w-4" />
            {itemModality}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Matched against {itemBasis}.
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{explanation}</p>
    </div>
  );
}
