# ICJS Import (Mock External Source)

Investigators don't have to upload files one by one: with one click they
can pull an entire case bundle from the (mock) ICJS system, and PRAMAAN's
normal pipeline takes it from there. The mock behaves like a real external
endpoint — separate container, HTTP only, no shared database — so swapping
it for a real ICJS system later is a URL change (`ICJS_MOCK_BASE_URL`), not
a rewrite. See [infra](../architecture/infra.md) and
[ai-pipeline](../architecture/ai-pipeline.md).

## How it flows

```
[ICJS picker] → POST /api/cases/{id}/icjs-import/ {external_case_id}
    → Django fetches each file from http://mock-icjs:9090
    → create_evidence() per file (hash → MinIO → row → ICJS_IMPORT custody)
    → process_evidence chain per file (classify → OCR → NER → relations → …)
    → entities land in the review queue → confirm → graph
```

- **Case matching rule:** the bundle imports into whatever case the URL
  names; `external_case_id` is stored on the `IcjsImportLog` for
  traceability. No auto-create, no auto-match.
- **Custody honesty:** imported files log `icjs_import` (not `uploaded`),
  with `external_case_id`, `source: "ICJS mock"`, and the download URL in
  details — the trail shows where evidence came from.
- **Progress:** transient WebSocket frames (`kind: "icjs_import_progress"`,
  phases connected → case_found → fetching/received per file → complete)
  on the caller's existing alerts socket. These are not persistent alerts;
  the bell ignores them. If the socket is absent, the POST response still
  reports final counts.
- **Failure semantics:** unknown external id → 404; unreachable service →
  502 with a `failed` log row; per-file errors → `partial` (or `failed` if
  nothing imported). Stages never raise, same as manual upload.

## The mock service (`mock-icjs/`)

GET-only file server, no database: `cases/{id}/manifest.json` + files read
off disk per request (folder listing is dynamic — delete a file and the
next `/files` response drops it, no restart needed), with a 200–500 ms
delay on downloads so progress UI feels real. Case IDs are state-wise
(`MH-2026-001`, `KA-2026-001`, `DL-2026-001`, …); manifests carry `state`
and `district`, which `/icjs/cases` returns so the picker can show them.
All content is synthetic (faker-style names/phones, disclaimer in every
PDF). Entities are deliberately reused across a case's files — and phone
`9876543210` spans MH-2026-001 (Maharashtra) and KA-2026-001 (Karnataka)
— so imports demo a rich graph plus interstate cross-case discovery.
Five cases across MH/KA/DL, five files each (FIR.pdf, CDR.csv,
financial_records.csv, forensic_report.pdf, witness_statement.pdf); PDFs
carry real text layers for the pypdf path.

## Supplying your own files

The mock doesn't care how a case folder got its content — generated or
hand-placed, it just serves what's on disk. To use your own files: drop
`manifest.json` (with at least `case_id`, `title`, `state`, `district`,
`station`, `fir_no`, `date_registered`) plus any evidence files into
`mock-icjs/cases/<YOUR-ID>/` and rebuild the image (`COPY . .` carries
your files in; `generate_cases.py` then fills only what's missing and
never overwrites). `generate_cases.py` also works standalone:
`python generate_cases.py --only KA-2026-001` regenerates one case's
synthetic gaps. (Note: `mock-icjs/cases/` is git-ignored — force-add any
hand-supplied files you want versioned.)

## UI

The evidence intake card hosts an **Import from ICJS** panel next to the
drag-and-drop uploader: case picker (from `GET /api/icjs/available-cases/`),
Import button, live checklist, and a link into the case's review queue
once files land (no separate "analyze" button — the pipeline auto-starts).
