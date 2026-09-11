# UI Audit & Redesign Plan (Step 1 — read before touching components)

> Implementation status (2026-09-10): all phases landed — tsc clean,
> `npm run build` green, smoke screenshots verified (`/login`, `/cases`).

Date: 2026-09-10. Source: reading every route/component listed below, plus
the reporter's screenshot description (no image files were attached, so all
findings below are code-grounded).

## Per-screen: what matters first vs. what's competing

**Login (`app/login/page.tsx`).** Needs: pick a door → credentials → submit,
in that visual order. Competing: two stacked cards (door picker, then a
separate "demo" text-button per door) plus placeholder-filled inputs with no
labels; the page is a bare centered card with no product identity, no
whitespace hierarchy, and the demo path (`requestSubmit` via rAF) is
fragile. Plan: one polished card, role doors as the hero, labeled fields,
single demo affordance per door.

**SHO dashboard (`app/dashboard/page.tsx`).** Needs: what needs attention
(high-risk cases, pending reviews) then jurisdiction list. Competing: stat
cards are fine, but the case list rows show only fir/title/risk/status —
no entity/evidence/alert counts (the API already returns them; the page
ignores them), so triage requires opening each case. Plan: reuse the
rich case-card pattern from Step 2 everywhere.

**Investigator `/my-cases`.** Needs: *my* cases, unmistakably, with my role
on each. Competing: nearly nothing — the page is already focused; it only
lacks assignment context (permission per case isn't shown) and a real empty
state (one plain line exists — good start, needs to explain *why* empty and
what happens next).

**Case workspace (`app/cases/[id]/page.tsx`).** Needs: *which case am I in*
at all times, then the section I'm using. Competing: `CaseOverview` shows
fir/title/stats but sits in the scroll flow — scrolling to Entities loses
all case context; the rail is a flat 9-item text list with no grouping and
no identity; Team/Overview/Audit items have no visual distinction. Plan:
sticky persistent case-context header (Step 2); grouped rail + identity
card (Step 4).

**Network graph.** Needs: structure at a glance, then detail on demand.
Competing: everything — see readability list below. Plan: Step 3 rebuild.

**Search (`app/search/page.tsx`), alerts (`app/alerts/page.tsx`).**
Functional, grouped results/tabs; need only the shared spacing/type pass,
not restructuring. Left alone except tokens.

## Case ownership: the minimum clearest answer

1. `/my-cases` rows state the assignment explicitly: risk badge + status +
   **"assigned to you · edit"** (permission comes from the assignment API;
   `CaseSerializer.assignments` already ships it — the page just doesn't
   read it).
2. Workspace gets a **sticky context header** under the top bar:
   `FIR-2026-1042 — Kothrud Jewellery Heist Ring` (largest/boldest) +
   risk/status badges + `assigned to you · edit` chip for investigators
   (owner name for SHO). Visible in every section, never scrolled away.
3. Zero cases → real empty state: *why* ("No cases assigned yet") + *what
   next* ("Your supervisor will assign you — it appears here automatically").

## Graph readability problems (complete list)

1. **Always-on labels at 10px on every node** (`label: "data(label)"` in the
   node stylesheet) — dense graphs become unreadable soup; no zoom-based
   disclosure, no hover fallback.
2. **No legend anywhere** — `TYPE_COLORS` (Person sky, Org violet, Location
   green, Vehicle amber, Phone pink, Event slate) exists only in code; the
   UI never explains it, and edge labels (`CALLED` etc.) are unexplained too.
3. **Color-only type encoding** — identical circles; fails colorblind users
   and fast scanning. No shape/icon per type.
4. **No cluster rendering** — GDS Louvain communities come back from
   `analyticsOverview` but are never drawn; dense graphs read as one tangle.
   (Compounds in Cytoscape would require restructuring the element model —
   rejected; use background-tint bounding boxes + labels instead, computed
   client-side from community membership.)
5. **Unstructured inspector** — `EvidencePanel` is a flat `<dl>`: label,
   confidence-as-text, conditional rows, raw snippet. No tabs, no visual
   confidence bar, no connected-entity count (derivable from degree), no
   case-association block.
6. **No canvas status bar** — node/edge counts live in the card header;
   no zoom % or selection readout under the canvas.
7. **No in-graph entity search** — filters exist (type pills, confidence
   slider, dates) but there is no "find X, focus it, expand/filter around
   it" control. Backend `expand/` + filters already support the
   focus/expand/filter/reset pattern — this is placement, not new API.
8. Minor: edge labels at 9px on every edge add to the soup (tie to the
   same label policy as nodes); tap-only selection has no keyboard path
   (noted, not fixed in this pass).

## Design system (applied everywhere after this — single source)

- **Spacing**: card `p-4`, section stack `space-y-4`, inner groups `mt-3`,
  dividers `divide-ink-700`, chips `px-2.5 py-0.5` / `px-2 py-0.5`.
- **Type**: page `text-xl font-bold`, section `font-semibold` (base),
  body `text-sm`, meta `text-xs text-slate-400`, micro `text-slate-500`.
- **Color semantics** (from `tailwind.config.ts`, never improvised):
  risk high `#ef4444` / medium `#f59e0b` / low `#22c55e`;
  role accents amber-400 SHO / teal-300 investigator (login doors,
  rail active, badges — never for data);
  entity types keep `TYPE_COLORS` exactly (legend documents them);
  confidence bands reuse risk colors (≥80 high-green? No — confidence is
  *not* risk: confidence bar uses accent sky + numeric %, risk colors stay
  reserved for risk. Decided here to avoid the obvious confusion.)
- **Shapes per entity type** (graph + legend share one map):
  Person ellipse, Organization round-rectangle, Location diamond,
  Vehicle hexagon, PhoneNumber triangle, Event star/polygon-5.
  Cytoscape supports all six natively (`shape` style property).
- **Cards/panels**: `.card` base; inspector/legend/status-bar are bordered
  `rounded-lg` sub-panels (`border-ink-700 bg-ink-950`); headers are
  `font-semibold` + count, never centered.
- **Buttons**: `.btn` primary; small actions `btn !px-3 !py-1 text-xs`;
  toggles are bordered pills with active = role-accent border+text;
  destructive = `text-risk-high hover:underline` (text buttons, never
  filled red except risk badges).
- **i18n**: every new user-facing string via `t(key, fallback)` with an
  `en` fallback inline and `hi` added to `lib/i18n.tsx` for header-level
  strings; data values (names, FIRs) never translated.
