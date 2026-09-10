# Offline & PWA

## Installable (no service worker)

`public/manifest.webmanifest` (name, standalone display, theme colors) +
`icon-192.svg` / `icon-512.svg`, referenced from root metadata. That is
the whole PWA story: ⚠️ **there is no service worker**, so no offline
page caching — "installable", not "offline-first".

## What actually works offline

- `OnlineBanner` watches `navigator.onLine` and shows a top strip when
  the browser reports no connectivity.
- **Evidence outbox** (`lib/outbox.ts`): IndexedDB database
  `pramaan-outbox`, store `uploads` (`queueUpload` / `listQueued` /
  `dropQueued`). When an upload fails with an offline-type error
  (`!navigator.onLine` or fetch `TypeError`), `EvidenceManager` stashes
  `{caseId, name, type, blob}` and shows a "queued offline" banner with a
  **Retry upload** button that replays the queue and drops successes.
- Everything else (graph, copilot, WS alerts) needs the backend and fails
  with inline per-panel errors — there is no queued-mutations system
  beyond evidence bytes.
