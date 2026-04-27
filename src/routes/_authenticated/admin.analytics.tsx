import { createFileRoute } from "@tanstack/react-router";
import { BarChart3 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/analytics")({
  head: () => ({ meta: [{ title: "Analytics — Admin" }] }),
  component: AnalyticsPage,
});

function AnalyticsPage() {
  return (
    <div className="text-center py-20 border border-dashed border-border rounded-xl">
      <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
      <h2 className="text-lg font-semibold">Search analytics</h2>
      <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
        Top queries, zero-result queries, and click-through rates will appear here in Phase 4.
      </p>
    </div>
  );
}
