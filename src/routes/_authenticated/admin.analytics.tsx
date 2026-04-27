import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getSearchAnalytics, type SearchAnalytics } from "@/server/analytics.functions";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { Loader2, Search, Eye, MousePointerClick, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/admin/analytics")({
  head: () => ({ meta: [{ title: "Analytics — Admin" }] }),
  component: AnalyticsPage,
});

const MODALITY_COLORS = ["var(--primary)", "var(--accent)", "hsl(142, 70%, 45%)"];

function AnalyticsPage() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<SearchAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getSearchAnalytics({ data: { days_back: days } })
      .then((res) => setData(res.analytics))
      .catch((e) => {
        const msg = e instanceof Error ? e.message : "Failed";
        setError(msg);
        toast.error(msg);
      })
      .finally(() => setLoading(false));
  }, [days]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading analytics…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm flex gap-2">
        <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
        <div>
          <div className="font-medium text-destructive">Could not load analytics</div>
          <div className="text-muted-foreground mt-1">{error ?? "Unknown error"}</div>
          <div className="text-muted-foreground mt-1 text-xs">
            Only admins can view analytics.
          </div>
        </div>
      </div>
    );
  }

  const ctr =
    data.total_searches > 0 ? (data.total_clicks / data.total_searches) * 100 : 0;
  const zeroPct =
    data.total_searches > 0
      ? (data.zero_result_count / data.total_searches) * 100
      : 0;

  const modalityData = Object.entries(data.modality_breakdown).map(([name, value]) => ({
    name,
    value: value as number,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Search analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">Last {days} days</p>
        </div>
        <Select value={String(days)} onValueChange={(v) => setDays(parseInt(v, 10))}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Total searches" value={data.total_searches.toLocaleString()} icon={Search} />
        <Kpi label="Unique queries" value={data.unique_queries.toLocaleString()} icon={Eye} />
        <Kpi
          label="Zero-result %"
          value={`${zeroPct.toFixed(1)}%`}
          icon={AlertCircle}
          tone={zeroPct > 30 ? "warn" : undefined}
        />
        <Kpi label="Click-through" value={`${ctr.toFixed(1)}%`} icon={MousePointerClick} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-medium mb-3">Searches over time</h3>
          {data.searches_by_day.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data.searches_by_day}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="day"
                  tickFormatter={(d: string) => d.slice(5)}
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                />
                <YAxis stroke="var(--muted-foreground)" fontSize={11} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    fontSize: 12,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="cnt"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-medium mb-3">Modality breakdown</h3>
          {modalityData.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={modalityData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={45}
                  outerRadius={75}
                  paddingAngle={2}
                >
                  {modalityData.map((_, i) => (
                    <Cell key={i} fill={MODALITY_COLORS[i % MODALITY_COLORS.length]} />
                  ))}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    fontSize: 12,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-medium">Top queries</h3>
          </div>
          {data.top_queries.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No searches yet.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground bg-muted/30">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Query</th>
                  <th className="text-right px-3 py-2 font-medium">Searches</th>
                  <th className="text-right px-3 py-2 font-medium">Avg results</th>
                  <th className="text-right px-4 py-2 font-medium">Clicks</th>
                </tr>
              </thead>
              <tbody>
                {data.top_queries.map((q, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-4 py-2 truncate max-w-[200px]" title={q.query}>
                      {q.query}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{q.search_count}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {q.avg_results?.toFixed(1) ?? "0.0"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{q.clicks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-medium">Zero-result queries</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Opportunities to add new content
            </p>
          </div>
          {data.zero_result_queries.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No zero-result searches — great coverage!
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {data.zero_result_queries.map((q, i) => (
                <li key={i} className="px-4 py-2 flex items-center justify-between text-sm">
                  <span className="truncate" title={q.query}>{q.query}</span>
                  <span className="text-xs tabular-nums text-muted-foreground ml-2">
                    {q.cnt}×
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "warn";
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-xs uppercase tracking-wide">{label}</span>
        <Icon className={`h-4 w-4 ${tone === "warn" ? "text-amber-500" : ""}`} />
      </div>
      <div className={`text-2xl font-semibold mt-2 tabular-nums ${tone === "warn" ? "text-amber-600" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">
      No data yet
    </div>
  );
}
