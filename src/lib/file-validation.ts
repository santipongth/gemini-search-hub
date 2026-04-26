// Shared file validation rules. Used by client (live preview) and server.

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_AUDIO_SECONDS = 120; // 2 minutes

export const ALLOWED_IMAGE_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export const ALLOWED_AUDIO_MIME = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
] as const;

export type FileKind = "image" | "audio";

export type ValidationRule =
  | "mime_type"
  | "file_size"
  | "audio_duration"
  | "data_url_format"
  | "missing_data";

export type ValidationFailure = {
  rule: ValidationRule;
  message: string;
  // Helpful structured context for UI rendering
  details?: {
    actual?: string | number;
    limit?: string | number;
    allowed?: readonly string[];
  };
};

export class FileValidationError extends Error {
  failures: ValidationFailure[];
  constructor(failures: ValidationFailure[]) {
    super("FILE_VALIDATION_FAILED");
    this.name = "FileValidationError";
    this.failures = failures;
  }
}

// Wire-format payload returned to the client when a server function detects
// validation failures. Plain serializable shape — no Error instance.
export type ValidationErrorPayload = {
  code: "FILE_VALIDATION_FAILED";
  failures: ValidationFailure[];
};

export function isValidationErrorPayload(
  err: unknown,
): err is ValidationErrorPayload {
  if (typeof err !== "object" || err === null) return false;
  const e = err as Record<string, unknown>;
  return e.code === "FILE_VALIDATION_FAILED" && Array.isArray(e.failures);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// Decode the byte length of a base64 data URL without allocating the buffer.
export function dataUrlByteLength(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  if (i < 0) return 0;
  const b64 = dataUrl.slice(i + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

export type ServerFileInput = {
  data_url: string | undefined;
  mime_type: string | undefined;
  kind: FileKind;
};

// Run every applicable rule and collect ALL failures (not just the first).
export function validateUploadedFile(input: ServerFileInput): ValidationFailure[] {
  const failures: ValidationFailure[] = [];

  if (!input.data_url || !input.mime_type) {
    failures.push({
      rule: "missing_data",
      message: "File data and MIME type are required.",
    });
    return failures;
  }

  // MIME type check
  const allowed =
    input.kind === "image" ? ALLOWED_IMAGE_MIME : ALLOWED_AUDIO_MIME;
  if (!allowed.includes(input.mime_type as never)) {
    failures.push({
      rule: "mime_type",
      message: `Unsupported ${input.kind} type "${input.mime_type}".`,
      details: { actual: input.mime_type, allowed },
    });
  }

  // Data URL format check
  const match = input.data_url.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    failures.push({
      rule: "data_url_format",
      message: "File could not be decoded (invalid data URL).",
    });
    return failures; // can't size-check garbage
  }

  // File size check (decode length only — don't allocate full buffer here)
  const size = dataUrlByteLength(input.data_url);
  const maxBytes =
    input.kind === "image" ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;
  if (size > maxBytes) {
    failures.push({
      rule: "file_size",
      message: `${input.kind === "image" ? "Image" : "Audio"} is ${formatBytes(size)}, exceeds the ${formatBytes(maxBytes)} limit.`,
      details: { actual: formatBytes(size), limit: formatBytes(maxBytes) },
    });
  }

  return failures;
}
