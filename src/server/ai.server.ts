// Server-only helpers for Lovable AI Gateway calls.
const GATEWAY_BASE = "https://ai.gateway.lovable.dev/v1";

function getKey() {
  const k = process.env.LOVABLE_API_KEY;
  if (!k) throw new Error("LOVABLE_API_KEY is not configured");
  return k;
}

/**
 * Embed text using Gemini's text embedding model. Returns 768-dim vector.
 */
export async function embedText(text: string): Promise<number[]> {
  const cleaned = text.trim().slice(0, 8000);
  if (!cleaned) throw new Error("Cannot embed empty text");

  const res = await fetch(`${GATEWAY_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/text-embedding-004",
      input: cleaned,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) throw new Error("Rate limited. Please try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add credits in workspace settings.");
    throw new Error(`Embedding failed [${res.status}]: ${body.slice(0, 200)}`);
  }

  const json = await res.json();
  const vec = json?.data?.[0]?.embedding;
  if (!Array.isArray(vec)) throw new Error("Embedding response malformed");
  return vec;
}

/**
 * Use a multimodal Gemini model to caption / describe an image so we can embed it
 * in the same shared text-embedding space.
 */
export async function describeImage(dataUrl: string): Promise<string> {
  const res = await fetch(`${GATEWAY_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content:
            "You produce concise, search-friendly descriptions of images. Output 2-4 sentences describing the subject, setting, colors, mood, and any visible text. No preamble.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image for semantic search." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) throw new Error("Rate limited. Please try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted.");
    throw new Error(`Image description failed [${res.status}]: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error("No description generated");
  return text.trim();
}

/**
 * Transcribe / summarize audio so it embeds into the shared text space.
 * Accepts a data URL with a supported audio mime type.
 */
export async function transcribeAudio(dataUrl: string, mimeType: string): Promise<string> {
  const res = await fetch(`${GATEWAY_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content:
            "You transcribe and briefly summarize audio for semantic search. Output the transcript followed by a one-sentence summary of the topic, mood, and any notable sounds. No preamble.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Transcribe and describe this audio (${mimeType}).` },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) throw new Error("Rate limited. Please try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted.");
    throw new Error(`Audio analysis failed [${res.status}]: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error("No transcription generated");
  return text.trim();
}
