import { createFileRoute } from "@tanstack/react-router";
import { Network } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/map")({
  head: () => ({ meta: [{ title: "Similarity map — Admin" }] }),
  component: MapPage,
});

function MapPage() {
  return (
    <div className="text-center py-20 border border-dashed border-border rounded-xl">
      <Network className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
      <h2 className="text-lg font-semibold">Browse by similarity</h2>
      <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
        A 2D similarity map of your library will appear here in Phase 5.
      </p>
    </div>
  );
}
