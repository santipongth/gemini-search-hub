import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { getItem, findSimilar, deleteItem } from "@/server/items.functions";
import { ItemCard, type ItemSummary, publicUrl } from "@/components/item-card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Sparkles, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/item/$id")({
  loader: ({ params }) => getItem({ data: { id: params.id } }),
  component: ItemPage,
  errorComponent: ({ error }) => (
    <div className="container mx-auto px-6 py-20 text-center">
      <p className="text-muted-foreground">{error.message}</p>
      <Link to="/library" className="text-primary underline mt-4 inline-block">Back to library</Link>
    </div>
  ),
});

function ItemPage() {
  const { item } = Route.useLoaderData() as { item: ItemSummary };
  const router = useRouter();
  const [similar, setSimilar] = useState<ItemSummary[] | null>(null);
  const [busy, setBusy] = useState(false);

  const url = publicUrl(item.storage_path);

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
      router.navigate({ to: "/library" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div className="container mx-auto px-6 py-10 max-w-4xl">
      <Link to="/library" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
        <ArrowLeft className="h-4 w-4" /> Back to library
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
            <p className="font-serif text-lg leading-relaxed whitespace-pre-wrap">{item.text_content}</p>
          </div>
        )}

        <div className="p-6 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">{item.modality}</span>
          </div>
          <h1 className="text-2xl font-semibold">{item.title ?? "Untitled"}</h1>
          {item.description && <p className="text-muted-foreground">{item.description}</p>}
          {item.modality !== "text" && item.text_content && (
            <details className="text-sm text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground">AI-generated description (used for matching)</summary>
              <p className="mt-2 whitespace-pre-wrap">{item.text_content}</p>
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
