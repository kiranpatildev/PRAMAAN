# Frontend — Next.js Route by Route

Stack: Next.js 14.2.5 (App Router) + React 18 + TypeScript, Tailwind,
Cytoscape 3.30 (graph), MapLibre GL 6.9 (maps). No global store, no data
library: each client component fetches with `fetch` via `lib/api.ts` and
holds state in `useState`/`useEffect`. Auth = JWT in `localStorage`
(`pramaan_access` / `pramaan_refresh`); `theme` and `lang` also persist
there (`pramaan_theme`, `pramaan_lang`).

## Routes (7 pages)

| Route | What it does | Key components / calls |
|---|---|---|
| `/` | Redirects to `/dashboard` | — |
| `/login` | Username+password; second step appears when the API returns `two_factor_required` (code → `login/2fa/`) | `api.login`, `api.login2fa` |
| `/dashboard` | Session header, 3 stat cards, cross-case flags, district overview, 2FA security card, case list | `CrossCasePanel`, `DistrictPanel`, `SecurityCard`, `api.me/cases` |
| `/cases` | Read-only case list (links into case pages) | `api.cases()` |
| `/cases/[id]` | **The workbench**: graph explorer + toolbar + evidence panel + review queue + snapshots/timeline + analytics + copilot + geo + reports + workflow | everything below |
| `/search` | Global search page (`?q=`) with grouped results | `GlobalSearch`, `api.globalSearch` |
| `/alerts` | Tabs: case feed, my notifications, routing rules, mock digests | `AlertsCenter` |

Layout (`app/layout.tsx`): dark-first shell, pre-hydration theme script
(sets `data-theme` from localStorage before paint), `LangProvider`,
header nav (`HeaderNav`, translated), `LangToggle`, `ThemeToggle`,
`AlertsBell`, `OnlineBanner`, PWA manifest + theme-color viewport.

## The case workbench (`/cases/[id]`)

Renders (in order): `GraphToolbar` (type toggles, confidence slider,
date range; debounced refetch) → Cytoscape canvas (cose layout,
~480 px, 320 px on mobile) + `EvidencePanel` side column →
`SnapshotManager` + `TimelineList` → `AnalyticsPanel` (risk overlay
paints node borders red/amber/green) → `CopilotPanel` →
`GeoMap` + `ReportsCard` → `ReviewQueue` (5 s polling while items are
pending) → `EvidenceManager` → `WorkflowPanel`.

- **Graph rendering**: API `{nodes, edges}` mapped to Cytoscape elements;
  node color by entity type, edge arrows + labels. Tap handler builds the
  `EvidenceRef` (edge: source→target label + snippet + provenance;
  node: type + confidence).
- **Expand**: `EvidencePanel` "Expand node" (1–3 degrees) calls
  `graph/expand/`, merges new elements into the live canvas, re-runs an
  animated cose layout.
- **Replay** (`replay.tsx`): fetches full graph once, slider walks sorted
  `valid_from` dates, `show()/hide()` batch per step; undated edges toggle
  separately; exit restores everything.
- **Loading/errors**: skeleton block until first graph payload; failed
  fetches render empty states, never crash the page.

## API client (`lib/api.ts`, 394 lines)

- `authHeaders()` (JSON + Bearer) vs `authOnlyHeaders()` (Bearer only —
  used for multipart `FormData` uploads and blob downloads so the browser
  sets boundaries).
- `handle()`: throws `API {status}` with the first 300 chars of the body;
  components catch per-call and render inline errors.
- ~70 helpers, one per endpoint (see [endpoints](../api/endpoints.md));
  token refresh is **not** automated — expired access tokens surface as
  errors until re-login. ⚠️ Known gap, not a bug report: no silent refresh.

## State, polling, offline

- No Redux/Zustand/React-Query. Evidence list polls every 5 s while any
  item is `pending/processing`; the bell polls notifications every 60 s
  and also holds a WebSocket.
- `lib/outbox.ts`: IndexedDB database `pramaan-outbox`, store `uploads`
  (`queueUpload`/`listQueued`/`dropQueued`). `EvidenceManager` catches
  network-type upload failures, stashes `{caseId, name, type, blob}`,
  shows a "queued offline" banner with a Retry button that replays the
  queue. `OnlineBanner` shows a top strip while `navigator.onLine` is false.
- ⚠️ No service worker: "installable" comes from the manifest + icons
  only; there is no offline page caching.

## Honest UI gaps (API exists, no button yet)

Verified by searching all callers: **case create/assign/close** (the
client has no helpers at all — use `/api/` directly or Django admin),
**comment delete**, **geo-nearby query**, and **manual entity locate**
(`PATCH …/locate/`). The cases list is read-only.
