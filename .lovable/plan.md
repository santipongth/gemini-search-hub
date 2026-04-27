# Plan: Production-ready multimodal search platform

This is a large set of features. To stay shippable, we'll execute in **5 phases**. Each phase is independently usable. You can stop after any phase.

---

## Phase 1 — Auth, ownership & permissions (foundation)

Everything else depends on this. Without it we can't safely add bulk delete, edit, or analytics.

**Database changes (migration):**

- `profiles` table (id → auth.users, display_name, created_at)
- `user_roles` table + `app_role` enum (`admin`, `user`) + `has_role()` security-definer function
- Add columns to `items`: `owner_id uuid`, `visibility text` (`public`|`private`, default `public`)
- Trigger: auto-create profile on signup; first signup → `admin`
- **Replace open RLS on `items**` with:
  - SELECT: `visibility='public' OR owner_id=auth.uid() OR has_role(auth.uid(),'admin')`
  - INSERT: `auth.uid() IS NOT NULL AND owner_id = auth.uid()`
  - UPDATE/DELETE: `owner_id = auth.uid() OR has_role(auth.uid(),'admin')`
- Storage RLS for `library` bucket (read public files, owner/admin write/delete)

**Auth UI:**

- `/auth` page — email/password
- Header shows Sign in / user menu (Sign out, Admin link if admin)
- `_authenticated` layout for protected routes
- `_authenticated/_admin` layout (role guard via `has_role`)

**Server functions updated:**

- `addItem` → uses authenticated client, sets `owner_id = userId`, accepts `visibility`
- `deleteItem`/`updateItem` → permission-checked (owner or admin)
- `listItems` → respects RLS (public + own items)

---

## Phase 2 — Route restructure: public search vs admin library

**New routing structure:**

```text
/                           → Search input page (public)
/results?q=...&qt=text      → NEW: dedicated public search results page
/item/$id                   → Item detail (public if item public)
/auth                       → Sign in / sign up
/admin                      → Admin home (redirect to /admin/library)
/admin/library              → Library management (moved from /library, admin only)
/admin/analytics            → Search analytics dashboard
/admin/map                  → 2D similarity map
```

- Remove top-level `/library` link from header for non-admins
- `/results` reads query from URL → server-renders results (shareable link)
- Search box on `/` navigates to `/results?...` instead of inline rendering

---

## Phase 3 — Library management (admin)

**Tags & collections:**

- `tags` table (id, name, owner_id) and `item_tags` join table
- Tag chips on item cards; multi-select tag filter in admin library
- Create-on-the-fly tag input in item edit dialog

**Edit metadata:**

- "Edit" action on each item card → dialog to edit title/description/visibility/tags
- New `updateItem` server function (owner/admin only)
- Re-derives `search_text` if title/description change

**Bulk operations:**

- Checkbox per card, "Select all on page" header
- Bulk action bar: Delete · Add tag · Remove tag · Set visibility · Export CSV
- New `bulkDeleteItems`, `bulkUpdateItems` server functions

**Bulk upload:**

- New `BulkUploadDialog`: drop multiple files, queue with per-file status (pending/uploading/success/error)
- Concurrency limit (3 at a time), per-file progress + retry button
- Each file goes through existing `addItem` validation

**Duplicate detection:**

- Add `content_hash text` column to `items` (SHA-256 of file bytes for media; of normalized text for text)
- Compute hash server-side in `addItem` before insert
- Soft-warn on exact hash match: "An identical file already exists — upload anyway?"
- (Embedding-similarity dedupe deferred — would need pgvector; trigram-based near-match warning shown instead using existing `match_items` with threshold 0.9)

**Pagination / infinite scroll:**

- `listItems` accepts `cursor` (created_at + id) and `limit` (default 24)
- Replace 200-row limit with cursor-based pagination
- Library page uses IntersectionObserver + TanStack Query `useInfiniteQuery`
- Filter UI: modality, tags, visibility, search-within-library

---

## Phase 4 — Search analytics dashboard

**Tracking (migration):**

- `search_events` table: id, user_id (nullable), query_text, query_type (text/image/audio), result_count, created_at
- `result_clicks` table: id, search_event_id, item_id, position, created_at
- RLS: insert allowed for everyone (incl. anon for public search); SELECT admin-only

**Server functions:**

- `logSearch` — called after every search, returns `search_event_id` to client
- `logResultClick` — called when user opens a result
- `getSearchAnalytics({ from, to })` — aggregates: top queries, zero-result queries, CTR per query, total searches, modality breakdown

**Admin dashboard `/admin/analytics`:**

- Date range picker (last 7 / 30 / 90 days)
- KPI cards: total searches, unique queries, zero-result %, overall CTR
- Top 20 queries table (count, avg results, CTR)
- Zero-result queries list (opportunities to add content)
- Searches over time line chart (recharts)
- Modality breakdown pie chart

---

## Phase 5 — 2D similarity map

**Approach:** UMAP/t-SNE in JS would need embeddings. We don't have embeddings yet (current search is trigram + ts_rank). To keep this practical without adding pgvector now:

- Build a **co-occurrence map** from token overlap of `search_text` (cheap, runs in server function)
- Project to 2D using a simple force-directed layout (`d3-force`) computed client-side
- Color by modality, size by # of incoming similarity edges
- Click node → opens item detail
- Pan/zoom canvas with `react-zoom-pan-pinch` or basic SVG transforms

Located at `/admin/map`. Honest tradeoff: not true UMAP, but visualizes clusters from the same signals search uses today. (Upgrade path: add `pgvector` + Gemini embeddings later → swap data source, keep UI.)

---

## Technical details

**New files (high level):**

- `src/routes/auth.tsx`, `src/routes/_authenticated.tsx`, `src/routes/_authenticated/_admin.tsx`
- `src/routes/_authenticated/_admin/library.tsx`, `analytics.tsx`, `map.tsx`
- `src/routes/results.tsx`
- `src/components/auth/{sign-in-form,user-menu}.tsx`
- `src/components/library/{bulk-upload-dialog,edit-item-dialog,bulk-action-bar,tag-filter,tag-input}.tsx`
- `src/components/analytics/{kpi-card,top-queries-table,searches-chart}.tsx`
- `src/components/similarity-map.tsx`
- `src/server/{auth,tags,analytics,bulk}.functions.ts`
- `src/hooks/use-auth.tsx`, `use-current-user.tsx`

**Migrations:**

1. profiles + user_roles + role enum + has_role + auto-profile trigger
2. items: add owner_id, visibility, content_hash; replace RLS
3. tags + item_tags + RLS
4. search_events + result_clicks + RLS
5. Storage RLS policies for library bucket

**Auth:** Email/password + Google via Lovable Cloud (`lovable.auth.signInWithOAuth`). No email confirmation by default.

**State management:** TanStack Query for cached lists; auth state via context (`useAuth()` hook reading `supabase.auth.onAuthStateChange`).

**Backwards compatibility:** Existing items will get `owner_id = NULL` and `visibility = 'public'`. NULL-owned items only deletable by admins.

---

## Recommended execution order

1. **Phase 1 + 2** first (auth + route restructure) — unblocks everything else, ~1 large change
2. **Phase 3** (library management) — biggest UX win
3. **Phase 4** (analytics) — needs Phase 1 user_id tracking
4. **Phase 5** (similarity map) — nice-to-have, smallest impact

Confirm and I'll start with **Phase 1 + 2** as the first implementation pass. Phases 3–5 will follow as separate messages so each stays reviewable.