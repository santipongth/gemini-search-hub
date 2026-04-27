import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { getEmbeddingStats, backfillEmbeddings } from "@/server/items.functions";

export function EmbeddingsBackfillPanel() {
  const [stats, setStats] = useState<{ total: number; missing: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  const refresh = async () => {
    setLoading(true);
    try {
      const s = await getEmbeddingStats();
      setStats(s);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load embedding stats");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const runBackfill = async () => {
    if (!stats || stats.missing === 0) return;
    setRunning(true);
    setProgress(0);
    let totalProcessed = 0;
    let totalErrors = 0;
    try {
      while (true) {
        const res = await backfillEmbeddings({ data: { batch_size: 10 } });
        totalProcessed += res.processed;
        totalErrors += res.errors.length;
        setProgress(totalProcessed);
        if (res.attempted === 0) break;
        // Refresh stats periodically so user sees progress
        const s = await getEmbeddingStats();
        setStats(s);
        if (s.missing === 0) break;
        // Small delay between batches to avoid rate limits
        await new Promise((r) => setTimeout(r, 800));
      }
      toast.success(`Backfill complete — ${totalProcessed} embedded${totalErrors ? `, ${totalErrors} failed` : ""}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Backfill failed");
    } finally {
      setRunning(false);
      void refresh();
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 mb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div>
            <div className="text-sm font-medium">Vector embeddings</div>
            <div className="text-xs text-muted-foreground">
              {loading && !stats ? (
                "Loading…"
              ) : stats ? (
                <>
                  {stats.total - stats.missing} / {stats.total} items embedded
                  {stats.missing > 0 && ` · ${stats.missing} missing`}
                  {running && ` · processed ${progress}`}
                </>
              ) : (
                "Stats unavailable"
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading || running}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            size="sm"
            onClick={runBackfill}
            disabled={running || !stats || stats.missing === 0}
          >
            {running ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                Backfilling…
              </>
            ) : stats?.missing === 0 ? (
              "All embedded"
            ) : (
              `Backfill ${stats?.missing ?? 0}`
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
