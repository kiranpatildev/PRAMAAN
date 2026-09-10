# i18n & Accessibility

## EN/हिं toggle (`frontend/lib/i18n.tsx`, ~52 Hindi strings)

`LangProvider` (mounted in the root layout) holds `lang` from
`localStorage` (`pramaan_lang`), and `t(key, fallback)` renders the Hindi
string or — crucially — the **English fallback when a key is missing**.
Adoption is therefore progressive and can never render blank: header nav,
login, dashboard, case headers, review queue, evidence intake, and copilot
use `t()` (~20 call sites); everything else stays English until keyed.
`LangToggle` flips `EN · हिं` ↔ `हिं · EN` in the header. Entity data
(names, FIRs, snippets) is never translated — only UI chrome.

## Theming

CSS-variable tokens (`--bg/--surface/--border/--text/--muted/--accent`)
with `[data-theme="dark"]` default and a `[data-theme="light"]` block that
remaps the shared dark utilities, so the whole app flips. `ThemeToggle`
(☀/☾) persists to `pramaan_theme`; an inline pre-hydration script in
`<head>` applies it before first paint (no dark-flash).

## Responsive & a11y baseline

Wrapping header, stacked grids on small screens, shorter graph/map
canvases on mobile (`h-[320px]`/`h-[300px]` → full height on `md:`),
viewport-safe dropdowns, horizontal scroll on wide tables, `device-width`
viewport. No component library: focus states come from Tailwind defaults;
a full a11y audit (roles, contrast ratios, keyboard graph traversal) has
not been done — flagged as future work, not claimed.
