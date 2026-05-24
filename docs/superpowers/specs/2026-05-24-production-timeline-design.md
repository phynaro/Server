# Production Timeline — Design Spec

**Date:** 2026-05-24  
**Status:** Approved

---

## Overview

A new dedicated page (`timeline.html`) that renders all six production machines as horizontal swimlanes on a shared time axis. Each raw production event is plotted as a small fixed-width bar at its exact timestamp, colored by product type using the same `colorPalette` already defined in `server.js`. Gaps between bars naturally reveal downtime or machine stops without any additional computation.

---

## Page Structure

**File:** `public/timeline.html`  
**Nav link:** Added to all existing pages as "Production Timeline" between Reliability Trends and Quality Data.

**Layout (top to bottom):**
1. Shared site header + nav (same markup as all other pages)
2. Filter bar — Today / Last 7 Days / Custom date-range toggles + From/To datetime inputs + Refresh button (identical pattern to `raw-data.html`)
3. Single card:
   - Title: "Production Timeline — All Machines"
   - Meta line: event count + date range
   - Product color legend grouped by family (60P / 50P / 30P), matching `colorPalette` in `server.js`
   - SVG swimlane chart
   - Footnote about Palletizer sparsity

---

## Swimlane Chart

**Rendering:** Inline `<svg>` element built entirely in vanilla JS. No libraries.

**Lanes (top to bottom):**
| Lane | Source filter |
|---|---|
| CaseForming | `Source = 'CaseForming'` |
| CasePacker1 | `Source = 'CasePacker1'` |
| CasePacker2 | `Source = 'CasePacker2'` |
| CasePacker3 | `Source = 'CasePacker3'` |
| CapCloser | `Source = 'CapCloser'` |
| Palletizer | `Source = 'Palletizer'` |

**Time axis:** X-axis spans `from` → `to` with hourly tick marks and labels.

**Event bars:**
- Each row in the API response = one `<rect>` in its machine's lane
- Width: fixed 5px regardless of time scale
- Height: fills lane minus 6px padding (top+bottom)
- X position: `chartLeft + (eventTime - fromTime) / totalDuration * chartWidth`
- Color: `colorPalette[TypeOfProduct]` from `server.js` — same values as production charts
- `rx="1"` for slight rounding

**Color palette** (sourced from `server.js:51`, used verbatim):
- 60P `rgba(46,125,50,0.7)` · 60PA `rgba(76,175,80,0.7)` · 60PB `rgba(129,199,132,0.7)`
- 50P `rgba(21,101,192,0.7)` · 50PA `rgba(33,150,243,0.7)` · 50PB `rgba(100,181,246,0.7)`
- 30P `rgba(106,27,154,0.7)` · 30PA `rgba(156,39,176,0.7)` · 30PB `rgba(186,104,200,0.7)`
- Other `rgba(158,158,158,0.7)`

**Hover tooltip:** A single floating `<div>` positioned absolutely over the SVG. On `mouseover` of any `<rect>`, the div becomes visible showing:
- Time (LocalDateTime)
- Source
- Product (TypeOfProduct)
- Qty

On `mouseleave` from SVG, tooltip hides. The tooltip div is created once and reused.

---

## Data

**Endpoint:** `GET /api/raw` — existing endpoint, no backend changes needed.

**Query:** Called without a `source` param to fetch all machines in one request:
```
/api/raw?from=<from>&to=<to>
```

**Row limit:** The existing 5 000-row cap applies across all machines. If hit, a warning is shown in the meta line ("limit reached — narrow your date range").

**Client-side grouping by lane:** After fetch, rows are partitioned by `Source` into six arrays (one per lane). Unrecognised sources are silently skipped.

---

## Navigation

Add `<a href="timeline.html" class="nav-link">Production Timeline</a>` to the `<div class="nav-menu">` in every HTML page:
- `index.html`
- `oee.html`
- `reliability.html`
- `quality.html`
- `raw-data.html`
- `settings.html`

Position: after "Reliability Trends", before "Quality Data".

---

## Date Range Defaults

Same logic as `raw-data.html`:
- Default on load: today's shift (06:00 local → now)
- "Today" button: shift start at 06:00 local
- "Last 7 Days": 7 days back at 06:00 → next 06:00
- Custom: user picks freely; switching from/to inputs auto-activates Custom

---

## Error & Empty States

- Loading: `showDataStatus()` from `shared.js` (pattern used by all pages)
- Error: `showDataStatus('error', ...)` with Retry link
- No data: lanes render empty (all grey backgrounds, no bars); meta shows "0 events"
- Row limit hit: append "(limit reached — narrow your date range)" to meta line

---

## Out of Scope

- Zoom or pan
- Grouping/merging consecutive events into blocks
- Exporting the chart
- Clicking bars (tooltip on hover only)
- Per-machine filtering
