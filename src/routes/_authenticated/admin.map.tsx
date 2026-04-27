import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { getSimilarityMap, type MapNode, type MapEdge } from "@/server/map.functions";
import { Loader2, Network } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/admin/map")({
  head: () => ({ meta: [{ title: "Similarity map — Admin" }] }),
  component: MapPage,
});

const MODALITY_COLOR: Record<string, string> = {
  text: "var(--primary)",
  image: "var(--accent)",
  audio: "hsl(142, 70%, 45%)",
};

function MapPage() {
  const navigate = useNavigate();
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [nodes, setNodes] = useState<MapNode[]>([]);
  const [edges, setEdges] = useState<MapEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<MapNode | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    setLoading(true);
    getSimilarityMap({ data: { scope, limit: 200 } })
      .then((res) => {
        setNodes(res.nodes);
        setEdges(res.edges);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  }, [scope]);

  const nodeById = useMemo(() => {
    const m = new Map<string, MapNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const W = 900;
  const H = 560;
  const PAD = 40;
  const px = (n: MapNode) => PAD + n.x * (W - PAD * 2);
  const py = (n: MapNode) => PAD + n.y * (H - PAD * 2);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Browse by similarity</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {nodes.length} items · {edges.length} similarity links
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
              viewBox={`0 0 ${W} ${H}`}
              className="w-full h-auto"
              style={{ maxHeight: 560 }}
            >
              {/* Edges */}
              <g opacity={0.25}>
                {edges.map((e, i) => {
                  const a = nodeById.get(e.source);
                  const b = nodeById.get(e.target);
                  if (!a || !b) return null;
                  return (
                    <line
                      key={i}
                      x1={px(a)}
                      y1={py(a)}
                      x2={px(b)}
                      y2={py(b)}
                      stroke="var(--muted-foreground)"
                      strokeWidth={Math.max(0.4, e.weight * 1.6)}
                    />
                  );
                })}
              </g>
              {/* Nodes */}
              <g>
                {nodes.map((n) => {
                  const r = 4 + Math.min(8, n.degree);
                  return (
                    <circle
                      key={n.id}
                      cx={px(n)}
                      cy={py(n)}
                      r={r}
                      fill={MODALITY_COLOR[n.modality] ?? "var(--muted-foreground)"}
                      stroke="var(--background)"
                      strokeWidth={1.5}
                      className="cursor-pointer transition-opacity hover:opacity-80"
                      onMouseEnter={() => setHover(n)}
                      onMouseLeave={() => setHover(null)}
                      onClick={() => navigate({ to: "/item/$id", params: { id: n.id } })}
                    />
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
                  {hover.degree} similar items · click to open
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Layout uses IDF-weighted token co-occurrence projected to 2D. Items with overlapping
        vocabulary cluster together. (Upgrade path: swap in pgvector embeddings later.)
      </p>
    </div>
  );
}
