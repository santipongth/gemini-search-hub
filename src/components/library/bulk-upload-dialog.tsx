import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { addItem } from "@/server/items.functions";
import { Upload, Loader2, CheckCircle2, AlertCircle, X, FileText, ImageIcon, AudioLines } from "lucide-react";
import { toast } from "sonner";
import { isValidationErrorPayload } from "@/lib/file-validation";

type QueueItem = {
  id: string;
  file: File;
  kind: "image" | "audio";
  status: "pending" | "uploading" | "success" | "error" | "duplicate";
  error?: string;
  duplicateExistingId?: string;
};

const CONCURRENCY = 3;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function detectKind(file: File): "image" | "audio" | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  return null;
}

export function BulkUploadDialog({ onAdded }: { onAdded?: () => void }) {
  const [open, setOpen] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset when reopening.
  useEffect(() => {
    if (!open) {
      setQueue([]);
      setRunning(false);
    }
  }, [open]);

  const onPick = (files: FileList | null) => {
    if (!files) return;
    const items: QueueItem[] = [];
    for (const f of Array.from(files)) {
      const kind = detectKind(f);
      if (!kind) {
        toast.error(`${f.name}: unsupported type`);
        continue;
      }
      items.push({
        id: crypto.randomUUID(),
        file: f,
        kind,
        status: "pending",
      });
    }
    setQueue((prev) => [...prev, ...items]);
  };

  const updateItemState = (id: string, patch: Partial<QueueItem>) => {
    setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  };

  const uploadOne = async (q: QueueItem, allowDuplicate = false) => {
    updateItemState(q.id, { status: "uploading", error: undefined });
    try {
      const dataUrl = await fileToDataUrl(q.file);
      await addItem({
        data: {
          modality: q.kind,
          title: q.file.name.replace(/\.[^.]+$/, "").slice(0, 200),
          visibility,
          data_url: dataUrl,
          mime_type: q.file.type,
          filename: q.file.name,
          allow_duplicate: allowDuplicate,
        },
      });
      updateItemState(q.id, { status: "success" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      try {
        const obj: unknown = JSON.parse(msg);
        if (isValidationErrorPayload(obj)) {
          updateItemState(q.id, {
            status: "error",
            error: obj.failures.map((f) => f.message).join("; "),
          });
          return;
        }
        if (obj && typeof obj === "object" && "code" in obj &&
            (obj as { code: string }).code === "DUPLICATE_ITEM") {
          updateItemState(q.id, {
            status: "duplicate",
            error: "An identical item already exists.",
            duplicateExistingId: (obj as unknown as { existing_id: string }).existing_id,
          });
          return;
        }
      } catch {
        // not JSON
      }
      updateItemState(q.id, { status: "error", error: msg });
    }
  };

  const runQueue = async () => {
    setRunning(true);
    // Snapshot pending list at start.
    const pending = queue.filter((q) => q.status === "pending" || q.status === "error");
    let cursor = 0;
    const workers: Promise<void>[] = [];
    const next = async () => {
      while (cursor < pending.length) {
        const q = pending[cursor++];
        await uploadOne(q);
      }
    };
    for (let i = 0; i < CONCURRENCY; i++) workers.push(next());
    await Promise.all(workers);
    setRunning(false);
    onAdded?.();
  };

  const retry = (q: QueueItem) => uploadOne(q);
  const force = (q: QueueItem) => uploadOne(q, true);
  const remove = (id: string) =>
    setQueue((prev) => prev.filter((q) => q.id !== id));

  const counts = queue.reduce(
    (acc, q) => {
      acc[q.status]++;
      return acc;
    },
    { pending: 0, uploading: 0, success: 0, error: 0, duplicate: 0 } as Record<QueueItem["status"], number>,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Upload className="h-4 w-4" /> Bulk upload
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk upload</DialogTitle>
        </DialogHeader>

        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onPick(e.dataTransfer.files);
          }}
          className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/40 transition"
        >
          <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm font-medium">Drop files here or click to choose</p>
          <p className="text-xs text-muted-foreground mt-1">
            Images and audio · processed {CONCURRENCY} at a time
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,audio/*"
            className="hidden"
            onChange={(e) => onPick(e.target.files)}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Visibility:</span>
            <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
              <button
                onClick={() => setVisibility("public")}
                className={`px-2.5 py-1 rounded ${visibility === "public" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >Public</button>
              <button
                onClick={() => setVisibility("private")}
                className={`px-2.5 py-1 rounded ${visibility === "private" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >Private</button>
            </div>
          </div>
          {queue.length > 0 && (
            <div className="text-xs text-muted-foreground tabular-nums">
              ✓ {counts.success} · ✗ {counts.error} · ⚠ {counts.duplicate} · ⏳ {counts.pending + counts.uploading}
            </div>
          )}
        </div>

        {queue.length > 0 && (
          <div className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border">
            {queue.map((q) => (
              <QueueRow
                key={q.id}
                q={q}
                onRetry={() => retry(q)}
                onForce={() => force(q)}
                onRemove={() => remove(q.id)}
              />
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setQueue([])} disabled={running || queue.length === 0}>
            Clear
          </Button>
          <Button
            onClick={runQueue}
            disabled={running || queue.length === 0 || counts.pending + counts.error === 0}
            className="gap-2"
          >
            {running && <Loader2 className="h-4 w-4 animate-spin" />}
            Upload {counts.pending + counts.error || ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function QueueRow({
  q,
  onRetry,
  onForce,
  onRemove,
}: {
  q: QueueItem;
  onRetry: () => void;
  onForce: () => void;
  onRemove: () => void;
}) {
  const Icon = q.kind === "image" ? ImageIcon : q.kind === "audio" ? AudioLines : FileText;
  return (
    <div className="flex items-center gap-3 px-3 py-2 text-sm">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="truncate" title={q.file.name}>{q.file.name}</div>
        {q.error && (
          <div className="text-xs text-destructive truncate" title={q.error}>{q.error}</div>
        )}
      </div>
      <div className="shrink-0">
        {q.status === "pending" && <span className="text-xs text-muted-foreground">Queued</span>}
        {q.status === "uploading" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
        {q.status === "success" && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
        {q.status === "error" && (
          <Button size="sm" variant="ghost" onClick={onRetry} className="h-7 px-2">
            <AlertCircle className="h-3.5 w-3.5 text-destructive mr-1" /> Retry
          </Button>
        )}
        {q.status === "duplicate" && (
          <Button size="sm" variant="ghost" onClick={onForce} className="h-7 px-2 text-amber-600">
            Upload anyway
          </Button>
        )}
      </div>
      {(q.status === "pending" || q.status === "error" || q.status === "duplicate") && (
        <button onClick={onRemove} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
