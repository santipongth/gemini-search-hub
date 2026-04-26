# Multimodal Search App

A web app where anyone can search a shared library of text snippets, images, and audio clips. Queries can be typed text, an uploaded image, or an uploaded/recorded audio clip. Matches are ranked by semantic similarity using Gemini embeddings or Lovable AI.

## Core experience

**Home / Search page**

- Big unified search bar with three input modes (tabs): Text, Image, Audio
  - Text: textarea + Search button
  - Image: drag-and-drop or file picker (jpg/png/webp), shows thumbnail preview
  - Audio: file upload (mp3/wav/m4a) + in-browser microphone recorder
- Results panel below with:
  - Ranked list of matches (mixed modalities) with similarity score
  - Filter chips: All / Text / Image / Audio
  - Slider: minimum similarity threshold
  - Each result card: modality icon, preview (text excerpt / image thumbnail / audio player), score, and "View details" link

**Library page**

- Browse the shared collection (paginated grid)
- Each item shows preview + modality badge
- "Add to library" button (open to anyone since no auth) → upload modal supporting text, image, or audio with optional title/description
- Delete button per item (open since no auth — acceptable for a demo)

**Item detail page**

- Full preview of the item
- "Find similar" button → runs a similarity search using this item's embedding

## How matching works

- Every library item is embedded once on upload using Gemini's embedding model and stored alongside the asset
- Queries are embedded the same way at search time
- Cosine similarity is computed between the query embedding and all stored embeddings; top N returned, filtered by modality + threshold
- Audio is transcribed first (Gemini multimodal) then embedded as text; images are embedded directly via Gemini's multimodal embedding capability — this keeps everything in one shared vector space so cross-modal search works (e.g., text query → image result)

## Seed content

On first load, the library is seeded with ~15 sample items (a mix of text snippets, royalty-free images, and short audio clips) so search works immediately without anyone uploading anything.

## Visual design

- Clean, modern, minimal — generous whitespace
- Light theme with a single accent color
- Result cards in a responsive grid; modality icons (text / image / waveform) for instant scannability
- Loading skeletons while embeddings are computed; toast notifications for upload success / errors / rate limits

## Technical notes

- **Frontend**: TanStack Start routes — `/` (search), `/library`, `/item/$id`
- **Backend**: TanStack server functions for embed/search/upload; uses Lovable AI Gateway with Gemini for embeddings, transcription, and image understanding
- **Storage**: Lovable Cloud (Supabase)
  - `items` table: id, modality, title, description, storage_path (for image/audio), text_content, embedding (vector), created_at
  - Storage bucket `library` (public) for image and audio files
  - pgvector extension enabled for similarity search via SQL
- **Search**: server function takes query (text/image/audio) → produces embedding → runs `<=>` cosine distance query in Postgres → returns ranked results
- **Audio recording**: MediaRecorder API in browser, uploaded as webm/wav blob
- **Rate-limit handling**: 429/402 responses from AI gateway surfaced as toasts