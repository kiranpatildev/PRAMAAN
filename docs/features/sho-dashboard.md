# SHO Dashboard

The SHO (Station House Officer / supervisor) sees everything; investigators
see only what they're assigned. `User.is_sho()` = role `sho`/`admin` or
superuser; `CaseViewSet.get_queryset` returns all cases for SHOs.

## What the SHO can do (and investigators can't)

| Capability | Code |
|---|---|
| See **all** cases, filter by status/risk/district/station, full-text search FIR/title/description | `CaseViewSet` + `filterset_fields`/`search_fields` |
| Onboard users (`POST /api/auth/register/`), list users | `RegisterView`, `UserListView` (both SHO-gated) |
| Create cases (`POST /api/cases/`) + **Import case from ICJS** (`POST /api/cases/icjs-import/ {external_case_id}` → manifest populates title/FIR/station/district/state, bundle imports, land in the new workspace) | `CaseViewSet.create` (SHO-only), `IcjsImportFlow` on `/cases` |
| Assign investigators with view/edit/admin permission | `POST /api/cases/{id}/assign/` (`IsSHO`), `{user_id, permission}` |
| Delete cases | `destroy()` — SHO-only (assignments CASCADE) |
| Close cases | `POST /api/cases/{id}/close/` — SHO-only, flips to `closed` (⚠️ no archival/approval chain despite the docstring) |
| Approve/reject entity **merges** | `POST /api/entities/review/merges/{id}/` (investigators get 403 on approve) |
| Read the immutable audit log | `GET /api/audit/` (SHO sees all; investigators see only their own actions, read-only) |
| District command view | `GET /api/analytics/districts/` + `district/?district=` → caseload/risk splits, investigator workload (active cases + pending reviews), weekly evidence growth, cross-case top (UI: `DistrictPanel`) |

## Risk & oversight loop

SHO-relevant automation lands as alerts: risk-threshold crossings and
anomalies fan out after every graph build; the bell + `/alerts` center
(feed/rules/digests) is shared, but merge approval and full audit reads stay
SHO-only. Reports (`ReportsCard` → court-ready PDF) are generated per case
by anyone with edit rights; the SHA-256 row makes them auditable later.
Hands-on evidentiary work (uploads, entity/relation verification) is
investigators-only — the SHO's verify buttons are hidden and the API 403s.

## Known gap: cross-case access approval

Cross-case connections are shown read-only today (shared-entity flags,
`CrossCasePanel`, formal `CaseLink` records). There is **no
request/approve workflow** for Restricted cases outside a requester's
assignment — no `AccessRequest` model, no approve/deny endpoint. Tracked
here, not silently skipped; out of scope for this pass.

Demo: log in as `sho_demo` → dashboard stat cards → `FIR-2026-1000` graph →
`/alerts` rules tab → add a `risk`/`high` rule → confirm a relation → watch
the push arrive.
