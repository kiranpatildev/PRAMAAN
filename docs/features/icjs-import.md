# ICJS Import (Mock External Source)

Importing from ICJS is how a new case gets created — an SHO-only action,
sitting on the `/cases` list next to manual Create Case. The SHO picks an
external bundle, PRAMAAN creates the case from its manifest and imports
the evidence through the normal pipeline. Investigators never see this
flow: no import panel in evidence intake, and the endpoints 403
non-SHO tokens.

## How it flows

```
[SHO: Cases → Import case → pick MH-2026-002] → POST /api/cases/icjs-import/
    → manifest populates the new Case (title/FIR/station/district/state)
    → file loop via create_evidence() (hash → MinIO → row → ICJS_IMPORT custody)
    → process_evidence chain per file → review queue → land in the new workspace
```

- **Case matching rule:** no auto-matching — the manifest populates a brand-new
  Case and `external_case_id` is stored on the `IcjsImportLog` for
  traceability. Duplicate FIR → 409; manifest without `fir_no` → 422.
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
