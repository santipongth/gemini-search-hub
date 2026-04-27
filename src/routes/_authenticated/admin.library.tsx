import { createFileRoute, useRouter, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { listItems, deleteItem, updateItem, bulkDeleteItems } from "@/server/items.functions";
import { ItemCard, type ItemSummary } from "@/components/item-card";
import { UploadDialog } from "@/components/upload-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Trash2, Pencil, Eye, EyeOff, Search as SearchIcon, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";

type AdminItem = ItemSummary & {
  visibility?: string;
  owner_id?: string | null;
  content_hash?: string | null;
};

export const Route = createFileRoute("/_authenticated/admin/library")({
  head: () => ({ meta: [{ title: "Library — Admin" }] }),
  component: AdminLibraryPage,
});

function AdminLibraryPage() {
  const router = useRouter();
  const { isAdmin } = useAuth();
  const [items, setItems] = useState<AdminItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [modality, setModality] = useState<"all" | "text" | "image" | "audio">("all");
  const [visibility, setVisibility] = useState<"all" | "public" | "private">("all");
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<AdminItem | null>(null);

  const reload = async () => {
    setLoading(true);
    setSelected(new Set());
    try {
      const res = await listItems({
        data: { cursor: null, limit: 24, modality, visibility, search, scope },
      });
      setItems(res.items as AdminItem[]);
      setCursor(res.nextCursor);
      setHasMore(!!res.nextCursor);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await listItems({
        data: { cursor, limit: 24, modality, visibility, search, scope },
      });
      setItems((prev) => [...prev, ...(res.items as AdminItem[])]);
      setCursor(res.nextCursor);
      setHasMore(!!res.nextCursor);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modality, visibility, scope]);

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    reload();
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i) => i.id)));
  };

  const onBulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} item${selected.size === 1 ? "" : "s"}?`)) return;
    try {
      const res = await bulkDeleteItems({ data: { ids: Array.from(selected) } });
      toast.success(`Deleted ${res.deleted} item${res.deleted === 1 ? "" : "s"}`);
      if (res.errors.length) toast.error(`${res.errors.length} failed`);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Library management</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {items.length} loaded · {scope === "mine" ? "your items" : "all items"}
          </p>
        </div>
        <UploadDialog onAdded={reload} />
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-border bg-card p-4 mb-4 space-y-3">
        <form onSubmit={onSearchSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, description, content..."
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="outline">Search</Button>
        </form>
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Type</Label>
            <Select value={modality} onValueChange={(v) => setModality(v as typeof modality)}>
              <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="image">Image</SelectItem>
                <SelectItem value="audio">Audio</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Visibility</Label>
            <Select value={visibility} onValueChange={(v) => setVisibility(v as typeof visibility)}>
              <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="public">Public</SelectItem>
                <SelectItem value="private">Private</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Scope</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
                <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mine">My items</SelectItem>
                  <SelectItem value="all">All users</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="sticky top-16 z-20 mb-4 rounded-xl border border-primary/40 bg-primary/5 backdrop-blur p-3 flex items-center gap-3">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>Clear</Button>
          <Button size="sm" variant="destructive" onClick={onBulkDelete} className="gap-2">
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card aspect-[4/3] animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-border rounded-xl">
          <p className="text-muted-foreground">No items match these filters.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-3">
            <Checkbox
              checked={selected.size === items.length && items.length > 0}
              onCheckedChange={selectAllVisible}
              id="select-all"
            />
            <label htmlFor="select-all" className="text-xs text-muted-foreground cursor-pointer">
              Select all loaded ({items.length})
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {items.map((item) => (
              <AdminItemTile
                key={item.id}
                item={item}
                selected={selected.has(item.id)}
                onToggle={() => toggleSelect(item.id)}
                onEdit={() => setEditing(item)}
                onDelete={async () => {
                  if (!confirm("Delete this item?")) return;
                  try {
                    await deleteItem({ data: { id: item.id } });
                    toast.success("Deleted");
                    reload();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Failed");
                  }
                }}
              />
            ))}
          </div>
          {hasMore && (
            <div className="flex justify-center mt-8">
              <Button onClick={loadMore} disabled={loadingMore} variant="outline" className="gap-2">
                {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                Load more
              </Button>
            </div>
          )}
        </>
      )}

      {editing && (
        <EditItemDialog
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); router.invalidate(); }}
        />
      )}
    </div>
  );
}

function AdminItemTile({
  item,
  selected,
  onToggle,
  onEdit,
  onDelete,
}: {
  item: AdminItem;
  selected: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isPrivate = item.visibility === "private";
  return (
    <div className={`relative rounded-xl border bg-card overflow-hidden transition ${selected ? "border-primary ring-2 ring-primary/30" : "border-border"}`}>
      <div className="absolute top-2 left-2 z-10">
        <Checkbox checked={selected} onCheckedChange={onToggle} className="bg-background/90" />
      </div>
      {isPrivate && (
        <div className="absolute top-2 right-2 z-10 inline-flex items-center gap-1 rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-medium text-white">
          <EyeOff className="h-3 w-3" /> Private
        </div>
      )}
      {!item.owner_id && (
        <div className="absolute bottom-14 left-2 z-10 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground" title="Legacy item without an owner">
          <ShieldAlert className="h-3 w-3" /> No owner
        </div>
      )}
      <Link to="/item/$id" params={{ id: item.id }} className="block">
        <div className="aspect-[4/3] bg-muted/40 flex items-center justify-center overflow-hidden">
          {item.modality === "image" && item.storage_path ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/library/${item.storage_path}`}
              alt={item.title ?? ""}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="p-4 text-xs text-muted-foreground line-clamp-6">
              {item.title ?? item.text_content ?? item.modality}
            </div>
          )}
        </div>
      </Link>
      <div className="p-3 space-y-1">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{item.modality}</div>
        <div className="font-medium text-sm line-clamp-1">{item.title ?? "Untitled"}</div>
        <div className="flex gap-1.5 pt-2">
          <Button size="sm" variant="outline" onClick={onEdit} className="h-8 px-2 gap-1 flex-1">
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
          <Button size="sm" variant="outline" onClick={onDelete} className="h-8 px-2 text-destructive hover:bg-destructive/10">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function EditItemDialog({
  item,
  onClose,
  onSaved,
}: {
  item: AdminItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(item.title ?? "");
  const [description, setDescription] = useState(item.description ?? "");
  const [visibility, setVisibility] = useState<"public" | "private">(
    (item.visibility as "public" | "private") ?? "public",
  );
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await updateItem({
        data: {
          id: item.id,
          title: title.trim() || null,
          description: description.trim() || null,
          visibility,
        },
      });
      toast.success("Saved");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit item</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={1000}
            />
          </div>
          <div>
            <Label>Visibility</Label>
            <Select value={visibility} onValueChange={(v) => setVisibility(v as typeof visibility)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="public">
                  <span className="inline-flex items-center gap-2"><Eye className="h-3.5 w-3.5" /> Public — anyone can find</span>
                </SelectItem>
                <SelectItem value="private">
                  <span className="inline-flex items-center gap-2"><EyeOff className="h-3.5 w-3.5" /> Private — only you</span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy} className="gap-2">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
