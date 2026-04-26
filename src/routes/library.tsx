import { createFileRoute, useRouter } from "@tanstack/react-router";
import { listItems } from "@/server/items.functions";
import { ItemCard, type ItemSummary } from "@/components/item-card";
import { UploadDialog } from "@/components/upload-dialog";

export const Route = createFileRoute("/library")({
  head: () => ({
    meta: [
      { title: "Library — Lumen" },
      { name: "description", content: "Browse the shared multimodal library." },
    ],
  }),
  loader: () => listItems(),
  component: LibraryPage,
});

function LibraryPage() {
  const data = Route.useLoaderData() as { items: ItemSummary[] };
  const router = useRouter();
  return (
    <div className="container mx-auto px-6 py-10 max-w-6xl">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Library</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {data.items.length} item{data.items.length === 1 ? "" : "s"} · shared and searchable
          </p>
        </div>
        <UploadDialog onAdded={() => router.invalidate()} />
      </div>

      {data.items.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-border rounded-xl">
          <p className="text-muted-foreground">The library is empty. Add the first item to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {data.items.map((item) => <ItemCard key={item.id} item={item} />)}
        </div>
      )}
    </div>
  );
}
