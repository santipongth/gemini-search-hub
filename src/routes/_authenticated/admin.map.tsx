import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { getSimilarityMap, type MapNode, type MapEdge } from "@/server/map.functions";
import { Loader2, Network, Search as SearchIcon, Crosshair, X } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin/map")({
  head: () => ({ meta: [{ title: "Similarity map — Admin" }] }),
  component: MapPage,
});

const MODALITY_COLOR: Record<string, string> = {
  text: "var(--primary)",
  image: "var(--accent)",
  audio: "hsl(142, 70%, 45%)",
};

const W = 900;
const H = 560;
const PAD = 40;

function MapPage() {
  const navigate = useNavigate();
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [nodes, setNodes] = useState<MapNode[]>([]);
  const [edges, setEdges] = useState<MapEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<MapNode | null>(null);
  const [query, setQuery] = useState("");
  const [viewBox, setViewBox] = useState<{ x: number; y: number; w: number; h: number }>({
    x: 0,
    y: 0,
    w: W,
    h: H,
  });
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    setLoading(true);
    getSimilarityMap({ data: { scope, limit: 200 } })
      .then((res) => {
        setNodes(res.nodes);
        setEdges(res.edges);
        setViewBox({ x: 0, y: 0, w: W, h: H });
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, [scope]);

  const nodeById = useMemo(() => {
    const m = new Map<string, MapNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  // Adjacency for connected-component traversal.
  const adjacency = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of edges) {
      if (!m.has(e.source)) m.set(e.source, []);
      if (!m.has(e.target)) m.set(e.target, []);
      m.get(e.source)!.push(e.target);
      m.get(e.target)!.push(e.source);
    }
    return m;
  }, [edges]);

  const px = (n: MapNode) => PAD + n.x * (W - PAD * 2);
  const py = (n: MapNode) => PAD + n.y * (H - PAD * 2);

  // Search matches (title contains query, case-insensitive).
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return [] as MapNode[];
    return nodes.filter((n) => (n.title ?? "").toLowerCase().includes(q));
  }, [nodes, q]);

  const matchedIds = useMemo(() => new Set(matches.map((n) => n.id)), [matches]);

  // Highlighted connected component (cluster) around the first match.
  const focusedClusterIds = useMemo(() => {
    if (matches.length === 0) return new Set<string>();
    const seen = new Set<string>();
    const stack = [matches[0].id];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const nb of adjacency.get(id) ?? []) {
        if (!seen.has(nb)) stack.push(nb);
      }
    }
    return seen;
  }, [matches, adjacency]);

  // Edges fully contained within the focused cluster.
  const focusedEdgeCount = useMemo(() => {
    if (focusedClusterIds.size === 0) return 0;
    let n = 0;
    for (const e of edges) {
      if (focusedClusterIds.has(e.source) && focusedClusterIds.has(e.target)) n++;
    }
    return n;
  }, [edges, focusedClusterIds]);

  const focusCluster = () => {
    if (focusedClusterIds.size === 0) {
      toast.error("No matching node to focus");
      return;
    }
    const ids = Array.from(focusedClusterIds);
    const xs = ids.map((id) => px(nodeById.get(id)!)).filter((v) => Number.isFinite(v));
    const ys = ids.map((id) => py(nodeById.get(id)!)).filter((v) => Number.isFinite(v));
    if (xs.length === 0) return;
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = 40;
    const w = Math.max(120, maxX - minX + pad * 2);
    const h = Math.max(120, maxY - minY + pad * 2);
    setViewBox({ x: minX - pad, y: minY - pad, w, h });
  };

  const resetView = () => setViewBox({ x: 0, y: 0, w: W, h: H });

  const openMatchingResults = (n: MapNode) => {
    const queryText = (n.title ?? "").trim();
    if (queryText.length >= 2) {
      navigate({ to: "/results", search: { q: queryText, qt: "text" } });
    } else {
      // Fallback: open the item page directly when there's no useful title.
      navigate({ to: "/item/$id", params: { id: n.id } });
    }
  };

  const dimNode = (n: MapNode): boolean =>
    q.length > 0 && !matchedIds.has(n.id) && !focusedClusterIds.has(n.id);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Browse by similarity</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {nodes.length} items · {edges.length} similarity links
            {q && ` · ${matches.length} match${matches.length === 1 ? "" : "es"}`}
            {focusedClusterIds.size > 0 && ` · cluster of ${focusedClusterIds.size}`}
          </p>
        </div>
        <Select value={scope} onValueChange={(v) => setScope(v as "mine" | "all")}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mine">My items</SelectItem>
            <SelectItem value="all">All items (admin)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Search & focus toolbar */}
      <div className="rounded-xl border border-border bg-card p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") focusCluster();
            }}
            placeholder="Search items by title… (Enter to focus the matching cluster)"
            className="pl-9 pr-9"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={focusCluster}
          disabled={matches.length === 0}
          className="gap-2"
        >
          <Crosshair className="h-4 w-4" />
          Focus cluster
        </Button>
        <Button variant="ghost" size="sm" onClick={resetView}>
          Reset view
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card p-3 relative">
        {loading ? (
          <div className="h-[560px] flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Computing layout…
          </div>
        ) : nodes.length === 0 ? (
          <div className="h-[560px] flex flex-col items-center justify-center text-muted-foreground">
            <Network className="h-10 w-10 mb-2 opacity-40" />
            <p className="text-sm">No items to map yet — add some to your library.</p>
          </div>
        ) : (
          <>
            <svg
              ref={svgRef}
              viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
              className="w-full h-auto transition-[viewBox] duration-300"
              style={{ maxHeight: 560 }}
            >
              {/* Edges */}
              <g>
                {edges.map((e, i) => {
                  const a = nodeById.get(e.source);
                  const b = nodeById.get(e.target);
                  if (!a || !b) return null;
                  const inCluster =
                    focusedClusterIds.has(e.source) && focusedClusterIds.has(e.target);
                  const dimmed = q.length > 0 && !inCluster;
                  return (
                    <line
                      key={i}
                      x1={px(a)}
                      y1={py(a)}
                      x2={px(b)}
                      y2={py(b)}
                      stroke={inCluster ? "var(--primary)" : "var(--muted-foreground)"}
                      strokeOpacity={dimmed ? 0.05 : inCluster ? 0.55 : 0.25}
                      strokeWidth={Math.max(0.4, e.weight * 1.6)}
                    />
                  );
                })}
              </g>
              {/* Nodes */}
              <g>
                {nodes.map((n) => {
                  const r = 4 + Math.min(8, n.degree);
                  const isMatch = matchedIds.has(n.id);
                  const inCluster = focusedClusterIds.has(n.id);
                  const dim = dimNode(n);
                  return (
                    <g key={n.id} opacity={dim ? 0.18 : 1}>
                      {isMatch && (
                        <circle
                          cx={px(n)}
                          cy={py(n)}
                          r={r + 6}
                          fill="none"
                          stroke="var(--primary)"
                          strokeWidth={2}
                          opacity={0.7}
                        />
                      )}
                      <circle
                        cx={px(n)}
                        cy={py(n)}
                        r={r}
                        fill={MODALITY_COLOR[n.modality] ?? "var(--muted-foreground)"}
                        stroke={inCluster ? "var(--primary)" : "var(--background)"}
                        strokeWidth={inCluster ? 2 : 1.5}
                        className="cursor-pointer transition-opacity hover:opacity-80"
                        onMouseEnter={() => setHover(n)}
                        onMouseLeave={() => setHover(null)}
                        onClick={() => openMatchingResults(n)}
                      />
                    </g>
                  );
                })}
              </g>
            </svg>

            {/* Legend */}
            <div className="absolute top-4 left-4 flex flex-col gap-1.5 rounded-lg border border-border bg-background/85 backdrop-blur p-2 text-xs">
              {(["text", "image", "audio"] as const).map((m) => (
                <div key={m} className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ background: MODALITY_COLOR[m] }}
                  />
                  <span className="capitalize">{m}</span>
                </div>
              ))}
            </div>

            {/* Hover tooltip */}
            {hover && (
              <div className="absolute bottom-4 right-4 max-w-xs rounded-lg border border-border bg-background/95 backdrop-blur p-3 text-sm shadow-lg pointer-events-none">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {hover.modality}
                </div>
                <div className="font-medium line-clamp-2">{hover.title ?? "Untitled"}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {hover.degree} similar items · click to open matching results
                </div>
              </div>
            )}

            {/* Match list (when search active) */}
            {q && matches.length > 0 && (
              <div className="absolute top-4 right-4 max-w-xs w-72 rounded-lg border border-border bg-background/95 backdrop-blur shadow-lg overflow-hidden">
                <div className="px-3 py-2 border-b border-border text-xs text-muted-foreground">
                  {matches.length} match{matches.length === 1 ? "" : "es"}
                </div>
                <ul className="max-h-56 overflow-auto divide-y divide-border">
                  {matches.slice(0, 25).map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => openMatchingResults(n)}
                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted/60 truncate"
                        title={n.title ?? "Untitled"}
                      >
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-2">
                          {n.modality}
                        </span>
                        {n.title ?? "Untitled"}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Layout uses IDF-weighted token co-occurrence projected to 2D. Items with overlapping
        vocabulary cluster together. Click any node to open matching search results.
      </p>
    </div>
  );
}
