# Investigator Dashboard

Investigators live in their assigned cases: dashboard stat cards (active /
high-risk / pending-review over **visible** cases), cross-case flags,
district panel, 2FA security card, and the case list. Everything else
happens inside a case workbench (`/cases/[id]`).

## Feeding a case

- **Bulk upload** (`EvidenceManager`): drag-and-drop multipart to
  `POST /api/cases/{id}/evidence/` → SHA-256 + MinIO + custody row, then
  the Celery chain runs async (list polls every 5 s while items are
  pending). Offline/network failure stashes bytes in the IndexedDB outbox
  with a Retry button. Each row shows classification + confidence, OCR
  status/engine/pages, processing errors, and custody/download/reprocess
  actions.
- **Review queue** (`ReviewQueue`): pending entities/relations/merges with
  confirm/reject; merge approve is SHO-only (403 otherwise). Confirming a
  ≥0.60 relation fires a CONNECTION alert; every confirm re-queues a graph
  rebuild (best-effort — a down broker never breaks the click).
- **Copilot** (`CopilotPanel`): suggested questions + free text; answers
  cite evidence or say what's missing first.
- **Workflow** (`WorkflowPanel` tabs): tasks (assignee must see the case;
  assignees can advance their own), comments (author-or-SHO delete —
  ⚠️ the delete button has no UI; use the API), formal case links
  (no self/reverse dups), and a unified activity feed (audit trail +
  tasks + comments).

## Permissions, concretely

View = owner or assignee (any level). Edit = SHO, owner, or edit/admin
assignment — required for uploads, confirms, tasks, comments, reports,
rebuilds, geo-pinning. Outsider requests get 403 (covered by tests).

## Field realities

Uploads degrade gracefully: MinIO down → metadata + hash kept, byte-stages
defer to `/reprocess/`; scanned images without PaddleOCR → `unavailable`,
not failure; no Gemini key → keyword retrieval + extractive answers.
The UI never shows a spinner of death — errors render inline per panel.
