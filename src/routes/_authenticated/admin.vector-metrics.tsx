import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  getVectorMetrics,
  evaluateGroundTruth,
  addGroundTruth,
  listGroundTruth,
  deleteGroundTruth,
  type VectorMetrics,
} from "@/server/analytics.functions";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Loader2, Gauge, Activity, Target, Plus, Trash2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/vector-metrics")({
  head: () => ({ meta: [{ title: "Vector Metrics — Admin" }] }),
  component: VectorMetricsPage,
});

type GtRow = { id: string; query_text: string; item_id: string; is_relevant: boolean; created_at: string };
type EvalResult = {
  k: number;
  queries_evaluated: number;
  mean_precision_at_k: number;
  mean_recall_at_k: number;
  per_query: Array<{ query: string; relevant_total: number; hits_at_k: number; precision_at_k: number; recall_at_k: number }>;
};

function StatCard({ label, value, hint, icon: Icon }: { label: string; value: string; hint?: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

function VectorMetricsPage() {
  const [days, setDays] = useState(7);
  const [metrics, setMetrics] = useState<VectorMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  const [gt, setGt] = useState<GtRow[]>([]);
  const [newQuery, setNewQuery] = useState("");
  const [newItemId, setNewItemId] = useState("");

  const [evalK, setEvalK] = useState(10);
  const [evalRes, setEvalRes] = useState<EvalResult | null>(null);
  const [evalBusy, setEvalBusy] = useState(false);

  const refresh = () => {
    setLoading(true);
    Promise.all([
      getVectorMetrics({ data: { days_back: days } }),
      listGroundTruth(),
    ])
      .then(([m, g]) => {
        setMetrics(m.metrics);
        setGt(g.rows);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const onAddGt = async () => {
    if (!newQuery.trim() || !newItemId.trim()) return;
    try {
      await addGroundTruth({
        data: { query_text: newQuery.trim(), item_id: newItemId.trim(), is_relevant: true },
      });
      setNewQuery("");
      setNewItemId("");
      toast.success("Ground-truth pair saved");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    }
  };

  const onDeleteGt = async (id: string) => {
    try {
      await deleteGroundTruth({ data: { id } });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  const onRunEval = async () => {
    setEvalBusy(true);
    try {
      const res = await evaluateGroundTruth({ data: { k: evalK } });
      setEvalRes(res);
      toast.success(`Evaluated ${res.queries_evaluated} queries`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Eval failed");
    } finally {
      setEvalBusy(false);
    }
  };

  if (loading && !metrics) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading vector metrics…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Vector Search Monitoring</h2>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Last 24 h</SelectItem>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {metrics && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total searches" value={metrics.total.toLocaleString()} icon={Activity} />
            <StatCard
              label="Vector pipeline"
              value={metrics.total > 0 ? `${Math.round((metrics.vector_count / metrics.total) * 100)}%` : "—"}
              hint={`${metrics.vector_count} of ${metrics.total} used embeddings`}
              icon={Target}
            />
            <StatCard
              label="Zero-result rate"
              value={`${(metrics.zero_result_rate * 100).toFixed(1)}%`}
              hint="Queries returning no matches"
              icon={Activity}
            />
            <StatCard
              label="Avg top similarity"
              value={metrics.avg_top_similarity.toFixed(3)}
              hint="Cosine of top-1 result"
              icon={Target}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <StatCard label="Avg latency" value={`${metrics.avg_latency_ms} ms`} icon={Gauge} />
            <StatCard label="p50 latency" value={`${metrics.p50_latency_ms} ms`} icon={Gauge} />
            <StatCard label="p95 latency" value={`${metrics.p95_latency_ms} ms`} icon={Gauge} />
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-medium mb-2">Avg latency per day</h3>
            <div className="h-64">
              <ResponsiveContainer>
                <LineChart data={metrics.latency_by_day}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="avg_ms" stroke="var(--primary)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium">Ground-truth relevance ({gt.length})</h3>
          <div className="flex items-center gap-2">
            <Select value={String(evalK)} onValueChange={(v) => setEvalK(Number(v))}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="5">k=5</SelectItem>
                <SelectItem value="10">k=10</SelectItem>
                <SelectItem value="20">k=20</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={onRunEval} disabled={evalBusy || gt.length === 0} size="sm" className="gap-1.5">
              {evalBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Run eval
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground mb-3">
          Mark which item IDs should be returned for which query. The evaluator runs the live vector
          search against each unique query and reports precision/recall@k vs. ground truth.
        </p>

        <div className="flex gap-2 mb-4">
          <Input
            placeholder="Query text"
            value={newQuery}
            onChange={(e) => setNewQuery(e.target.value)}
            className="flex-1"
          />
          <Input
            placeholder="Item UUID"
            value={newItemId}
            onChange={(e) => setNewItemId(e.target.value)}
            className="flex-1 font-mono text-xs"
          />
          <Button onClick={onAddGt} size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Add</Button>
        </div>

        {gt.length > 0 && (
          <div className="border border-border rounded-md divide-y divide-border max-h-72 overflow-y-auto">
            {gt.map((row) => (
              <div key={row.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="flex-1 truncate">{row.query_text}</span>
                <span className="font-mono text-xs text-muted-foreground truncate max-w-[220px]">{row.item_id}</span>
                <button
                  onClick={() => onDeleteGt(row.id)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {evalRes && (
          <div className="mt-4 rounded-lg border border-border p-3 bg-muted/20">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Queries evaluated</div>
                <div className="font-semibold">{evalRes.queries_evaluated}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Mean precision@{evalRes.k}</div>
                <div className="font-semibold">{(evalRes.mean_precision_at_k * 100).toFixed(1)}%</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Mean recall@{evalRes.k}</div>
                <div className="font-semibold">{(evalRes.mean_recall_at_k * 100).toFixed(1)}%</div>
              </div>
            </div>
            {evalRes.per_query.length > 0 && (
              <div className="mt-3 max-h-56 overflow-y-auto border-t border-border pt-2 space-y-1">
                {evalRes.per_query.map((q) => (
                  <div key={q.query} className="flex items-center gap-2 text-xs">
                    <span className="flex-1 truncate">{q.query}</span>
                    <span className="text-muted-foreground">hits {q.hits_at_k}/{q.relevant_total}</span>
                    <span className="font-mono">P {(q.precision_at_k * 100).toFixed(0)}%</span>
                    <span className="font-mono">R {(q.recall_at_k * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
