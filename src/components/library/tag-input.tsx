import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";

export function TagInput({
  value,
  onChange,
  placeholder = "Add a tag and press Enter…",
  disabled,
  max = 20,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  max?: number;
}) {
  const [input, setInput] = useState("");

  const add = (raw: string) => {
    const t = raw.trim().replace(/[,]/g, "");
    if (!t) return;
    if (value.includes(t)) {
      setInput("");
      return;
    }
    if (value.length >= max) return;
    onChange([...value, t]);
    setInput("");
  };

  const remove = (t: string) => onChange(value.filter((x) => x !== t));

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(input);
    } else if (e.key === "Backspace" && !input && value.length > 0) {
      remove(value[value.length - 1]);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 min-h-9">
      {value.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs"
        >
          {t}
          <button
            type="button"
            onClick={() => remove(t)}
            disabled={disabled}
            className="hover:text-destructive"
            aria-label={`Remove tag ${t}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => add(input)}
        placeholder={value.length === 0 ? placeholder : ""}
        disabled={disabled}
        className="flex-1 min-w-[120px] bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

export function TagChips({
  tags,
  onClick,
  selected,
}: {
  tags: Array<{ id: string; name: string }>;
  onClick?: (tag: { id: string; name: string }) => void;
  selected?: Set<string>;
}) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => {
        const isSel = selected?.has(t.id);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onClick?.(t)}
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] transition ${
              isSel
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
            }`}
          >
            {t.name}
          </button>
        );
      })}
    </div>
  );
}
