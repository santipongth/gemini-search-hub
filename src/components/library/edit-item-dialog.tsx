import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TagInput } from "@/components/library/tag-input";
import { updateItem } from "@/server/items.functions";
import { getItemTags, setItemTags } from "@/server/tags.functions";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import type { ItemSummary } from "@/components/item-card";

type EditableItem = ItemSummary & { visibility?: string; owner_id?: string | null };

export function EditItemDialog({
  item,
  onClose,
  onSaved,
}: {
  item: EditableItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(item.title ?? "");
  const [description, setDescription] = useState(item.description ?? "");
  const [visibility, setVisibility] = useState<"public" | "private">(
    (item.visibility as "public" | "private") ?? "public",
  );
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingTags, setLoadingTags] = useState(true);

  useEffect(() => {
    getItemTags({ data: { item_id: item.id } })
      .then((res) => setTags(res.tags.map((t) => t.name)))
      .catch(() => {})
      .finally(() => setLoadingTags(false));
  }, [item.id]);

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
      await setItemTags({ data: { item_id: item.id, tag_names: tags } });
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
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">
                  <span className="inline-flex items-center gap-2">
                    <Eye className="h-3.5 w-3.5" /> Public — anyone can find
                  </span>
                </SelectItem>
                <SelectItem value="private">
                  <span className="inline-flex items-center gap-2">
                    <EyeOff className="h-3.5 w-3.5" /> Private — only you
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Tags</Label>
            <TagInput value={tags} onChange={setTags} disabled={loadingTags} />
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
