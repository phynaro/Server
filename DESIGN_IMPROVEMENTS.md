# Dashboard Design Improvements

Management dashboard perspective — minimalist, data-first, typography-driven.
Color is used only when it carries meaning (e.g. a value is out of range). No decorative icons, no heavy chrome.
Think: clear numbers, good spacing, readable type. Not SCADA.

Update this file as items are completed.

---

## CRITICAL

- [x] **[A] Loading and error states** — Implemented across all 5 pages. KPI values start as "—" (not zero). Tables show "Loading…" on page load. On fetch failure: "Could not load data. Last successful: HH:MM. Retry" appears below the affected section. Tables show "No data for this period." when the response is empty. `showDataStatus` / `clearDataStatus` helpers added to `shared.js`. `.status-line` / `.status-line.is-error` styles in `shared.css`.

- [ ] **[B] KPI values carry no context** — A number without a reference means nothing. "Availability: 72.3%" is meaningless unless the reader knows the target. Add one line of context below each KPI value:
  - Target: show the target value in small muted text (e.g. "Target: 85%").
  - Delta: show change vs. previous period ("−4.2% vs yesterday") in small text. No color unless out of range.
  - Color only when below target: value turns `--error` red. Above target stays default dark text. Two states, not three — avoid amber ambiguity.

---

## HIGH

### Shared / All Pages

- [x] **[C] Extract shared CSS** — `/public/shared.css` created (156 lines). Each page's style block reduced to page-specific only: index 18 lines, oee 35, quality 42, settings 7, reliability 10. Down from ~150 duplicated lines per page.

- [x] **[D] Remove decorative card borders** — Replaced `border-top: 4px solid var(--primary)` on `.kpi-card` with `border: 1px solid #e5e5e5` in both index.html and oee.html.

- [x] **[E] KPI values: neutral color by default** — `.kpi-value` changed from `color: var(--primary)` to `color: #111` in both pages. OEE card keeps its green as the one intentional exception.

- [x] **[F] Active page indicator in nav** — `shared.js` created with `setActiveNav()`. Compares `window.location.pathname` to each nav link's href on DOMContentLoaded. `.nav-link.active` rule added to `shared.css` (bold + 2px underline). Replaces duplicated inline `toggleMenu` script across all 5 pages.

- [x] **[G] Remove emoji section icons** — 🦾 📦 ✅ 🚚 removed from index.html h2 headings.

- [x] **[H] Move inline styles to classes** — Added `.kpi-sub`, `.kpi-sub-error` to `shared.css`. Page-specific: `.ict-display`, `.chart-sm`, `.scroll-lg` (oee.html); `.stat-row`, `.mb-sm`, `.date-toggle`, `.date-opt` (index.html). Dead `border-top-color` on OEE card removed. Stray 📜 emoji removed from hidden raw events h2.

- [x] **[I] Machine staleness — readable, not alarming** — Changed "Last Event: HH:MM:SS" to "Last data: 14:32 (2m ago)" across all 5 pages (oee_client.js, index.html, quality.html, settings.html, reliability.html). "No Recent Events" → "No recent data". >10 min still turns red. Initial placeholder updated to "Last data: --".

### index.html — Production Dashboard

- [x] **[J] Default date range** — Default changed to current shift (6AM today → now; pre-6AM loads yesterday's shift). Added "Today · Last 7 Days · Custom" text toggle row in the filter bar. Active option is bold with 2px underline. Manual date edits auto-select Custom.

### reliability.html — Reliability Trends

- [x] **[K] Chart axis date format** — Both `renderOeeChart` and `renderReliabilityCharts` in reliability.html now use `toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })` → "28 Apr, 01 May". Added `T00:00:00` suffix to avoid timezone off-by-one.

### quality.html — Quality Management

- [x] **[L] Delete confirmation** — Replaced `confirm()` with `confirmDeleteRow()`. Clicking Delete rewrites the actions cell to "Confirm delete · Cancel" links inline. Cancel restores the original cell via `td.dataset.original`. Actual DELETE only fires on Confirm.

### settings.html — Cycle Time Management

- [x] **[M] ICT input validation** — `min="0.5" max="600"` on inputs. `validateICT()` shows inline error below input, adds `input.invalid` red border, disables Save until valid. `onICTInput()` drives all state. Server rejects out-of-range on both single and bulk POST endpoints.

---

## MEDIUM

### Shared / All Pages

- [~~N~~] ~~Data timestamp on charts~~ — Removed from scope.

- [x] **[O] Touch target sizing** — `min-height: 44px` added to `th` in shared.css. Mobile nav link padding changed from `12px 0` to `12px 16px` in the responsive block.

### oee.html — OEE Dashboard

- [~~P~~] ~~KPI card grouping~~ — Removed from scope, current layout considered sufficient.

- [x] **[Q] Active ICT display** — Replaced fake-input `<div>` with `<span id="ictDisplay">` + `<a class="ict-edit-link">change →</a>` pointing to settings.html. `.ict-display` CSS removed; replaced with `.ict-value` (bold) and `.ict-edit-link` (muted small link).

- [x] **[R] Timeline row readability** — Added `#timelineTable tbody tr:nth-child(odd) { background: #fafafa; }` and `font-size: 0.9rem` to oee.html style block.

- [x] **[S] Pareto cumulative line** — Added cumulative % line (blue, `xAxisID: 'cumPct'`) and dashed 80% reference (grey) to `renderParetoChart`. Secondary x-axis on top (0–100%). Cumulative % calculated from sorted losses array. Legend shows bar + line labels; 80% reference filtered out of legend.

- [x] **[T] Shift-aware default date** — oee_client.js DOMContentLoaded: if `hours < 6`, subtract 86400000ms to get yesterday's date. Three lines.

### quality.html — Quality Management

- [x] **[U] Save success feedback** — Added `.save-confirm` div between filter bar and card. After POST, shows "Saved — CasePacker1_A, 12 bad, 14:32", fades in via CSS opacity transition, clears after 4s via `setTimeout`.

- [x] **[V] Pagination record count** — Changed to "Records 1–20 of 94 · Page 1 of 5" in quality.html. Uses existing `filteredData`, `startIndex`, `endIndex` already in scope.

### settings.html — Cycle Time Management

- [x] **[W] Bulk save** — "Save all changes" button at table footer. Edited rows get `row-dirty` class (`border-left: 3px solid #ccc` on first td). `dirtyRows` Set tracks changes. `saveAll()` fires one POST to `/api/settings/cycle-times/bulk`. Individual Save buttons still work per-row. Button disabled when no dirty rows or any row is invalid.

### reliability.html — Reliability Trends

- [x] **[X] Heatmap cell size and tooltip** — Cells increased to 16×16px, gap 4→2px. `title` attribute replaced with `.cell-tip` span inside each `.heatmap-cell` — CSS opacity transition on hover. Mon / Wed / Fri day labels added via `.heatmap-day-labels` grid to the left of the scrollable heatmap area. Legend swatch sizes updated to match.

- [~~Y~~] ~~MTBF/MTTR reference line~~ — Removed from scope, targets not yet agreed with factory team.

- [x] **[Z] Synchronized chart hover** — Added `interaction: { mode: 'index', intersect: false }` to OEE, MTBF, and MTTR charts in reliability.html. (Loss chart excluded — it has different labels/axis.)

---

## LOW

### index.html — Production Dashboard

- [x] **[AA] Hidden raw events table** — Removed the hidden card and its `/api/raw` fetch from index.html entirely.

### quality.html — Quality Management

- [x] **[BB] Product type label in form** — `updateProductTypes()` in quality.html now renders "60P — Type 1" format. Value stored is still the raw type code.

### settings.html — Cycle Time Management

- [x] **[CC] ICT explanation** — Added `<details><summary>What is Ideal Cycle Time?</summary>...</details>` above the settings table. Explains the formula and warns about zero values. Native HTML, no JS.

### reliability.html — Reliability Trends

- [x] **[DD] Empty month cell contrast** — Changed `color: #ccc` → `#aaa` and `-` → `—` for empty month rows in reliability.html.

---

## Progress Summary

| Priority | Total | Done | Remaining |
|----------|-------|------|-----------|
| Critical | 2 | 1 | 1 |
| High | 7 | 7 | 0 |
| Medium | 12 | 11 | 0 |
| Low | 4 | 3 | 1 |
| **Total** | **22** | **22** | **1** |

---

*Revised: 2026-05-21 — Reframed from HMI/SCADA to management dashboard. Minimalist approach: typography and spacing drive hierarchy, color reserved for out-of-range values only.*
