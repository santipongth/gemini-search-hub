import { AlertCircle } from "lucide-react";
import type { ValidationFailure, ValidationRule } from "@/lib/file-validation";

const RULE_LABELS: Record<ValidationRule, string> = {
  mime_type: "File type",
  file_size: "File size",
  audio_duration: "Audio duration",
  data_url_format: "File encoding",
  missing_data: "Missing data",
};

/**
 * Inline alert shown directly below the input that produced the failure.
 * Filters the failure list to the rules requested via `rules`.
 *
 * Renders nothing when no matching failures are present, so it is safe to
 * mount unconditionally next to every relevant field.
 */
export function InlineRuleFailures({
  failures,
  rules,
  className = "",
}: {
  failures: ValidationFailure[] | null;
  rules: ValidationRule[];
  className?: string;
}) {
  if (!failures || failures.length === 0) return null;
  const matched = failures.filter((f) => rules.includes(f.rule));
  if (matched.length === 0) return null;

  return (
    <div className={`mt-2 space-y-1.5 ${className}`}>
      {matched.map((f, i) => (
        <div
          key={i}
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive"
        >
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="font-semibold">{RULE_LABELS[f.rule] ?? f.rule}: </span>
            <span className="text-foreground/90">{f.message}</span>
            {f.details?.actual !== undefined && f.details?.limit !== undefined && (
              <span className="ml-1 font-mono text-[11px] text-muted-foreground">
                (got {f.details.actual} · limit {f.details.limit})
              </span>
            )}
            {f.details?.filename && (
              <div className="mt-0.5 text-[11px] text-muted-foreground truncate">
                File: <span className="font-mono">{f.details.filename}</span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export { RULE_LABELS };
