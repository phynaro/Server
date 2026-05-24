# Production Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `timeline.html` page that renders all six production machines as horizontal SVG swimlanes, with one fixed-width bar per raw event, colored by product type using the same palette as the production charts.

**Architecture:** Single vanilla-JS HTML page that calls the existing `/api/raw` endpoint (no source filter), partitions rows client-side by `Source` into six named lanes, then builds an inline `<svg>` with lane backgrounds, an hourly time axis, and one `<rect>` per event. A single reused tooltip `<div>` shows event detail on hover. No backend changes required.

**Tech Stack:** Vanilla HTML/JS/CSS, SVG DOM API, existing `/api/raw` endpoint, `shared.css` + `shared.js`

---

## Files

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `public/timeline.html` | Full swimlane page: HTML, styles, all JS |
| Modify | `public/index.html` | Add nav link |
| Modify | `public/oee.html` | Add nav link |
| Modify | `public/reliability.html` | Add nav link |
| Modify | `public/quality.html` | Add nav link |
| Modify | `public/raw-data.html` | Add nav link |
| Modify | `public/settings.html` | Add nav link |

---

## Task 1: Add nav link to all existing pages

**Files:**
- Modify: `public/index.html`
- Modify: `public/oee.html`
- Modify: `public/reliability.html`
- Modify: `public/quality.html`
- Modify: `public/raw-data.html`
- Modify: `public/settings.html`

- [ ] **Step 1: Add link to index.html**

In `public/index.html`, locate the `<div class="nav-menu" id="navMenu">` block. Add the new link after the Reliability Trends entry:

```html
<a href="reliability.html" class="nav-link">Reliability Trends</a>
<a href="timeline.html" class="nav-link">Production Timeline</a>
<a href="quality.html" class="nav-link">Quality Data</a>
```

- [ ] **Step 2: Add link to oee.html**

Same location in `public/oee.html` — add after Reliability Trends, before Quality Data:

```html
<a href="reliability.html" class="nav-link">Reliability Trends</a>
<a href="timeline.html" class="nav-link">Production Timeline</a>
<a href="quality.html" class="nav-link">Quality Data</a>
```

- [ ] **Step 3: Add link to reliability.html**

Same pattern in `public/reliability.html`.

- [ ] **Step 4: Add link to quality.html**

Same pattern in `public/quality.html`.

- [ ] **Step 5: Add link to raw-data.html**

Same pattern in `public/raw-data.html`.

- [ ] **Step 6: Add link to settings.html**

Same pattern in `public/settings.html`.

- [ ] **Step 7: Verify nav links appear**

Start server (`npm run dev`) and open `http://localhost:3001`. Check that "Production Timeline" appears in the nav on all pages. The link will 404 until Task 2 is done — that is expected.

- [ ] **Step 8: Commit**

```bash
git add public/index.html public/oee.html public/reliability.html public/quality.html public/raw-data.html public/settings.html
git commit -m "feat: add Production Timeline nav link to all pages"
```

---

## Task 2: Create timeline.html — page shell and styles

**Files:**
- Create: `public/timeline.html`

- [ ] **Step 1: Create the file with static structure**

Create `public/timeline.html` with the following content:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Production Timeline — Production Performance</title>
    <link rel="stylesheet" href="shared.css">
    <script src="shared.js"></script>
    <style>
        .card-meta { font-size: 0.78rem; color: #888; margin-bottom: 14px; }
        .legend { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; padding-bottom: 14px; border-bottom: 1px solid #f0f0f0; }
        .legend-group { display: flex; gap: 8px; align-items: center; }
        .legend-sep { width: 1px; background: #e0e0e0; height: 14px; }
        .legend-item { display: flex; align-items: center; gap: 4px; font-size: 0.75rem; color: #555; }
        .legend-dot { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }
        .chart-wrap { overflow-x: auto; }
        #swimlaneSvg { display: block; }
        #chartTooltip {
            display: none; position: fixed;
            background: #111; color: #fff;
            border-radius: 5px; padding: 8px 12px;
            font-size: 0.78rem; pointer-events: none;
            box-shadow: 0 2px 8px rgba(0,0,0,0.25);
            z-index: 100; white-space: nowrap; line-height: 1.6;
        }
        #chartTooltip .tl { color: #aaa; display: inline-block; min-width: 52px; }
        .date-toggle { display: flex; align-items: center; gap: 8px; }
        .date-toggle span { color: #ccc; }
        .date-opt { text-decoration: none; color: #888; font-size: 0.85rem; font-weight: 600; }
        .date-opt:hover { color: #333; }
        .date-opt.active { color: #111; font-weight: 700; border-bottom: 2px solid #111; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="brand-group">
                <img src="https://kinetix.co.th/wp-content/uploads/2023/02/cropped-Kinetix_Web_Logo2-1.png" alt="Kinetix Logo" class="logo">
                <div class="brand-text">
                    <div class="company-name">Thantawan Industry Vietnam</div>
                    <div class="dashboard-title">Production Performance</div>
                </div>
            </div>
            <button class="menu-toggle" onclick="toggleMenu()" aria-label="Toggle navigation">
                <span></span><span></span><span></span>
            </button>
            <div class="nav-menu" id="navMenu">
                <a href="index.html" class="nav-link">Production Dashboard</a>
                <a href="oee.html" class="nav-link">OEE Dashboard</a>
                <a href="reliability.html" class="nav-link">Reliability Trends</a>
                <a href="timeline.html" class="nav-link active">Production Timeline</a>
                <a href="quality.html" class="nav-link">Quality Data</a>
                <a href="settings.html" class="nav-link">Settings</a>
            </div>
        </header>

        <div class="filters">
            <div class="date-toggle">
                <a href="#" class="date-opt active" id="optToday" onclick="setRange('today'); return false;">Today</a>
                <span>·</span>
                <a href="#" class="date-opt" id="opt7days" onclick="setRange('7days'); return false;">Last 7 Days</a>
                <span>·</span>
                <a href="#" class="date-opt" id="optCustom" onclick="setRange('custom'); return false;">Custom</a>
            </div>
            <div class="filter-group"><label>From</label><input type="datetime-local" id="fromDate"></div>
            <div class="filter-group"><label>To</label><input type="datetime-local" id="toDate"></div>
            <button onclick="loadData()">Refresh</button>
        </div>

        <div class="card">
            <h2>Production Timeline — All Machines</h2>
            <div class="card-meta" id="chartMeta"></div>
            <div class="status-line" id="dataStatus"></div>
            <div class="legend" id="chartLegend"></div>
            <div class="chart-wrap">
                <svg id="swimlaneSvg"></svg>
            </div>
            <div style="font-size:0.72rem;color:#aaa;margin-top:6px;">
                Palletizer fires once per completed pallet — sparse bars are expected.
            </div>
        </div>
    </div>

    <div id="chartTooltip"></div>

    <script>
        // JS added in subsequent tasks
    </script>
</body>
</html>
```

- [ ] **Step 2: Open in browser and verify shell**

Open `http://localhost:3001/timeline.html`. Confirm:
- Header and nav render correctly, "Production Timeline" link is active (bold)
- Filter bar appears with Today/Last 7 Days/Custom toggles
- Card with heading "Production Timeline — All Machines" is visible
- No JS errors in the console

- [ ] **Step 3: Commit**

```bash
git add public/timeline.html
git commit -m "feat: add timeline.html page shell"
```

---

## Task 3: Color palette, lane config, and legend

**Files:**
- Modify: `public/timeline.html` (inside the `<script>` block)

- [ ] **Step 1: Add constants inside the `<script>` tag**

Replace the `// JS added in subsequent tasks` comment with:

```javascript
// ── Constants ────────────────────────────────────────────────
const SVG_NS  = 'http://www.w3.org/2000/svg';
const LABEL_W = 72;   // px: lane label column width
const LANE_H  = 50;   // px: total height per lane (bg = 34px + 6px gap)
const LANE_BG = 34;   // px: lane background rect height
const BAR_H   = 26;   // px: event bar height
const BAR_W   = 5;    // px: event bar fixed width
const AXIS_H  = 22;   // px: time axis row below lanes
const PAD_T   = 16;   // px: top padding before first lane
const PAD_R   = 8;    // px: right padding

const LANES = [
    'CaseForming', 'CasePacker1', 'CasePacker2',
    'CasePacker3', 'CapCloser',   'Palletizer'
];

// Matches colorPalette in server.js exactly
const COLOR_MAP = {
    '60P':  'rgba(46,125,50,0.7)',
    '60PA': 'rgba(76,175,80,0.7)',
    '60PB': 'rgba(129,199,132,0.7)',
    '50P':  'rgba(21,101,192,0.7)',
    '50PA': 'rgba(33,150,243,0.7)',
    '50PB': 'rgba(100,181,246,0.7)',
    '30P':  'rgba(106,27,154,0.7)',
    '30PA': 'rgba(156,39,176,0.7)',
    '30PB': 'rgba(186,104,200,0.7)',
};
const COLOR_OTHER = 'rgba(158,158,158,0.7)';

function getColor(product) {
    if (!product) return COLOR_OTHER;
    if (COLOR_MAP[product]) return COLOR_MAP[product];
    if (product.includes('60')) return COLOR_MAP['60P'];
    if (product.includes('50')) return COLOR_MAP['50P'];
    if (product.includes('30')) return COLOR_MAP['30P'];
    return COLOR_OTHER;
}

// Parse a local-time string (datetime-local input or LocalDateTime from API)
// to milliseconds, always treating as UTC+7.
function parseToMs(str) {
    const s = str.trim().replace(' ', 'T');
    const withTz = (s.includes('+') || s.endsWith('Z')) ? s : s + '+07:00';
    return new Date(withTz).getTime();
}

function toLocalISO(date) {
    const off = date.getTimezoneOffset() * 60000;
    return new Date(date - off).toISOString().slice(0, 16);
}
```

- [ ] **Step 2: Add legend builder after the constants**

```javascript
function buildLegend() {
    const container = document.getElementById('chartLegend');
    const groups = [
        { items: [['60P','rgba(46,125,50,0.7)'],['60PA','rgba(76,175,80,0.7)'],['60PB','rgba(129,199,132,0.7)']] },
        { items: [['50P','rgba(21,101,192,0.7)'],['50PA','rgba(33,150,243,0.7)'],['50PB','rgba(100,181,246,0.7)']] },
        { items: [['30P','rgba(106,27,154,0.7)'],['30PA','rgba(156,39,176,0.7)'],['30PB','rgba(186,104,200,0.7)']] },
        { items: [['Other','rgba(158,158,158,0.7)']] },
    ];
    container.innerHTML = groups.map((g, gi) =>
        (gi > 0 ? '<div class="legend-sep"></div>' : '') +
        '<div class="legend-group">' +
        g.items.map(([label, color]) =>
            `<div class="legend-item">` +
            `<div class="legend-dot" style="background:${color}"></div>${label}</div>`
        ).join('') +
        '</div>'
    ).join('');
}

buildLegend();
```

- [ ] **Step 3: Verify legend renders**

Reload `http://localhost:3001/timeline.html`. Confirm:
- Legend row shows three color groups (60P greens / 50P blues / 30P purples) plus Other grey
- Groups are separated by thin vertical lines

- [ ] **Step 4: Commit**

```bash
git add public/timeline.html
git commit -m "feat: add color palette, lane config, and legend to timeline"
```

---

## Task 4: Filter bar logic and default date range

**Files:**
- Modify: `public/timeline.html` (inside the `<script>` block, after previous JS)

- [ ] **Step 1: Add setRange() and input listeners**

```javascript
// ── Filter bar ───────────────────────────────────────────────
function setRange(mode) {
    document.querySelectorAll('.date-opt').forEach(a => a.classList.remove('active'));
    const now = new Date();
    if (mode === 'today') {
        document.getElementById('optToday').classList.add('active');
        const s = new Date(now);
        if (s.getHours() < 6) s.setDate(s.getDate() - 1);
        s.setHours(6, 0, 0, 0);
        document.getElementById('fromDate').value = toLocalISO(s);
        document.getElementById('toDate').value   = toLocalISO(now);
    } else if (mode === '7days') {
        document.getElementById('opt7days').classList.add('active');
        const s = new Date(now);
        s.setDate(s.getDate() - 7);
        s.setHours(6, 0, 0, 0);
        const e = new Date(now);
        if (e.getHours() >= 6) e.setDate(e.getDate() + 1);
        e.setHours(6, 0, 0, 0);
        document.getElementById('fromDate').value = toLocalISO(s);
        document.getElementById('toDate').value   = toLocalISO(e);
    } else {
        document.getElementById('optCustom').classList.add('active');
    }
    loadData();
}

document.getElementById('fromDate').addEventListener('change', () => {
    document.querySelectorAll('.date-opt').forEach(a => a.classList.remove('active'));
    document.getElementById('optCustom').classList.add('active');
});
document.getElementById('toDate').addEventListener('change', () => {
    document.querySelectorAll('.date-opt').forEach(a => a.classList.remove('active'));
    document.getElementById('optCustom').classList.add('active');
});
```

- [ ] **Step 2: Add loadData() stub and initial call**

```javascript
// ── Data loading (stub — chart added in Task 5) ──────────────
async function loadData() {
    const from = document.getElementById('fromDate').value;
    const to   = document.getElementById('toDate').value;
    showDataStatus('dataStatus', 'loading', 'Loading…');
    try {
        const res = await fetch(`/api/raw?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
        if (!res.ok) throw new Error('Server error ' + res.status);
        const data = await res.json();
        clearDataStatus('dataStatus');
        document.getElementById('chartMeta').textContent =
            `${data.length.toLocaleString()} event${data.length === 1 ? '' : 's'}` +
            (data.length === 5000 ? ' (limit reached — narrow your date range)' : '') +
            ` · ${from.replace('T', ' ')} → ${to.replace('T', ' ')}`;
        // renderChart called here in Task 5
        console.log('Loaded', data.length, 'events');
    } catch (e) {
        showDataStatus('dataStatus', 'error',
            'Failed to load data. <a href="#" onclick="loadData(); return false;">Retry</a>');
    }
}

// Initial load — default to today's shift
setRange('today');
```

- [ ] **Step 3: Verify data loading works**

Reload `http://localhost:3001/timeline.html`. Confirm:
- "Today" is active on load, From/To inputs are pre-filled with today's shift
- Console shows "Loaded N events" (N may be 0 if no data for today)
- "Last 7 Days" button updates the range and triggers a new fetch
- Changing From/To inputs switches to "Custom" mode

- [ ] **Step 4: Commit**

```bash
git add public/timeline.html
git commit -m "feat: add filter bar and data loading to timeline"
```

---

## Task 5: SVG chart — lanes, grid lines, and time axis

**Files:**
- Modify: `public/timeline.html` (inside the `<script>` block)

- [ ] **Step 1: Add SVG helper and renderChart() skeleton before loadData()**

Add the following before the `loadData` function:

```javascript
// ── SVG helpers ──────────────────────────────────────────────
function svgEl(tag, attrs) {
    const e = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    return e;
}

// ── Chart renderer ───────────────────────────────────────────
function renderChart(data, fromStr, toStr) {
    const svg     = document.getElementById('swimlaneSvg');
    const totalW  = Math.max(svg.parentElement.clientWidth || 900, 500);
    const chartX  = LABEL_W;
    const chartW  = totalW - LABEL_W - PAD_R;
    const axisY   = PAD_T + LANES.length * LANE_H;
    const totalH  = axisY + AXIS_H;
    const fromMs  = parseToMs(fromStr);
    const toMs    = parseToMs(toStr);
    const rangeMs = toMs - fromMs;

    svg.setAttribute('width', totalW);
    svg.setAttribute('height', totalH);
    svg.innerHTML = '';

    if (rangeMs <= 0) return;

    // ── Lane backgrounds and labels ──
    LANES.forEach((source, i) => {
        const laneY = PAD_T + i * LANE_H;

        svg.appendChild(svgEl('rect', {
            x: chartX, y: laneY, width: chartW, height: LANE_BG,
            rx: 3, fill: '#f9f9f9', stroke: '#ececec', 'stroke-width': 1
        }));

        const lbl = svgEl('text', {
            x: chartX - 6,
            y: laneY + Math.round(LANE_BG / 2) + 4,
            'text-anchor': 'end', 'font-size': 10,
            fill: '#555', 'font-family': 'sans-serif'
        });
        lbl.textContent = source;
        svg.appendChild(lbl);
    });

    // ── Vertical grid lines and time-axis labels (hourly) ──
    const t0 = new Date(fromMs);
    t0.setMinutes(0, 0, 0);
    if (t0.getTime() < fromMs) t0.setHours(t0.getHours() + 1);

    for (let t = t0.getTime(); t <= toMs; t += 3600000) {
        const x = chartX + ((t - fromMs) / rangeMs) * chartW;

        svg.appendChild(svgEl('line', {
            x1: x, y1: PAD_T - 4, x2: x, y2: axisY,
            stroke: '#e8e8e8', 'stroke-width': 0.5, 'stroke-dasharray': '3,3'
        }));

        const d   = new Date(t);
        const lbl = svgEl('text', {
            x, y: axisY + 14,
            'text-anchor': 'middle', 'font-size': 9,
            fill: '#bbb', 'font-family': 'sans-serif'
        });
        lbl.textContent = d.getHours().toString().padStart(2, '0') + ':00';
        svg.appendChild(lbl);
    }

    // bars added in Task 6
}
```

- [ ] **Step 2: Call renderChart() from loadData() with empty data**

Inside `loadData()`, replace the `console.log(...)` line with:

```javascript
renderChart(data, from, to);
```

- [ ] **Step 3: Verify lane structure renders**

Reload `http://localhost:3001/timeline.html`. Confirm:
- Six grey lane backgrounds appear with labels on the left (CaseForming through Palletizer)
- Hourly tick marks and time labels appear along the bottom axis
- No bars yet — lanes are empty grey boxes

- [ ] **Step 4: Commit**

```bash
git add public/timeline.html
git commit -m "feat: add SVG lane layout and time axis to timeline chart"
```

---

## Task 6: Event bar rendering

**Files:**
- Modify: `public/timeline.html` (inside `renderChart()`)

- [ ] **Step 1: Add event bar rendering at the end of renderChart(), replacing the `// bars added in Task 6` comment**

```javascript
    // ── Partition data by source ──
    const byLane = {};
    LANES.forEach(s => { byLane[s] = []; });
    data.forEach(row => {
        if (byLane[row.Source] !== undefined) byLane[row.Source].push(row);
    });

    // ── Render bars ──
    const tip = document.getElementById('chartTooltip');

    LANES.forEach((source, i) => {
        const laneY = PAD_T + i * LANE_H;
        const barY  = laneY + Math.round((LANE_BG - BAR_H) / 2);

        byLane[source].forEach(row => {
            const evMs = parseToMs(row.LocalDateTime);
            const x    = chartX + ((evMs - fromMs) / rangeMs) * chartW;

            // skip bars outside visible range
            if (x + BAR_W < chartX || x > chartX + chartW) return;

            const rect = svgEl('rect', {
                x: Math.round(x), y: barY,
                width: BAR_W, height: BAR_H,
                rx: 1, fill: getColor(row.TypeOfProduct)
            });

            rect.addEventListener('mouseover', (e) => {
                tip.style.display = 'block';
                tip.style.left    = (e.clientX + 14) + 'px';
                tip.style.top     = (e.clientY - 10) + 'px';
                tip.innerHTML =
                    `<div><span class="tl">Time</span> ${row.LocalDateTime}</div>` +
                    `<div><span class="tl">Source</span> ${row.Source}</div>` +
                    `<div><span class="tl">Product</span> ${row.TypeOfProduct || '—'}</div>` +
                    `<div><span class="tl">Qty</span> ${row.Qty ?? '—'}</div>`;
            });

            svg.appendChild(rect);
        });
    });

    svg.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
```

- [ ] **Step 2: Verify bars render**

Reload `http://localhost:3001/timeline.html`. Confirm:
- Colored bars appear inside each lane at their correct time positions
- Colors match the production charts: 60P greens, 50P blues, 30P purples, Palletizer grey
- Gaps in a lane (no bars) correspond to periods with no production events
- Palletizer lane is sparse (one bar per pallet)

- [ ] **Step 3: Commit**

```bash
git add public/timeline.html
git commit -m "feat: render event bars on timeline swimlane chart"
```

---

## Task 7: Hover tooltip polish and edge-case handling

**Files:**
- Modify: `public/timeline.html`

- [ ] **Step 1: Keep tooltip inside the viewport**

The current tooltip uses `e.clientX + 14`. When the bar is near the right edge the tooltip clips off-screen. Add viewport clamping by replacing the tooltip `mouseover` handler body with:

```javascript
rect.addEventListener('mouseover', (e) => {
    tip.style.display = 'block';
    tip.innerHTML =
        `<div><span class="tl">Time</span> ${row.LocalDateTime}</div>` +
        `<div><span class="tl">Source</span> ${row.Source}</div>` +
        `<div><span class="tl">Product</span> ${row.TypeOfProduct || '—'}</div>` +
        `<div><span class="tl">Qty</span> ${row.Qty ?? '—'}</div>`;
    const tipW = tip.offsetWidth  || 190;
    const tipH = tip.offsetHeight || 80;
    const left = Math.min(e.clientX + 14, window.innerWidth  - tipW - 8);
    const top  = Math.min(e.clientY - 10, window.innerHeight - tipH - 8);
    tip.style.left = left + 'px';
    tip.style.top  = top  + 'px';
});
```

- [ ] **Step 2: Handle zero-event state**

In `loadData()`, after `clearDataStatus('dataStatus')`, add a guard before `renderChart()`:

```javascript
if (data.length === 0) {
    document.getElementById('chartMeta').textContent = 'No events for this period.';
    document.getElementById('swimlaneSvg').innerHTML = '';
    document.getElementById('swimlaneSvg').setAttribute('height', 0);
    return;
}
```

- [ ] **Step 3: Verify tooltip and zero-state**

1. Hover over bars near the right edge — tooltip should stay inside the viewport.
2. Set a date range with no data (e.g. a date in the past) — "No events for this period." should appear and the SVG should be empty.

- [ ] **Step 4: Commit**

```bash
git add public/timeline.html
git commit -m "feat: polish tooltip clamping and zero-event state on timeline"
```

---

## Task 8: Responsive resize

**Files:**
- Modify: `public/timeline.html`

The SVG width is calculated from `svg.parentElement.clientWidth` at render time, but the chart doesn't update if the window is resized.

- [ ] **Step 1: Add resize handler**

Add this after `buildLegend()` and before `setRange('today')`:

```javascript
let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        const from = document.getElementById('fromDate').value;
        const to   = document.getElementById('toDate').value;
        if (from && to && window._lastTimelineData) {
            renderChart(window._lastTimelineData, from, to);
        }
    }, 150);
});
```

- [ ] **Step 2: Cache the last dataset**

In `loadData()`, after `const data = await res.json();`, add:

```javascript
window._lastTimelineData = data;
```

- [ ] **Step 3: Verify resize**

Load the page, then drag the browser window narrower and wider. The chart should re-render to fill the new width within ~150ms.

- [ ] **Step 4: Commit**

```bash
git add public/timeline.html
git commit -m "feat: re-render timeline chart on window resize"
```

---

## Task 9: Final browser verification

No code changes — this is the acceptance check.

- [ ] **Step 1: Verify Today range**

Load `http://localhost:3001/timeline.html`. Confirm:
- "Today" is pre-selected, showing today's shift (06:00 → now)
- Event count is shown in the meta line
- All six lanes are labeled and have bars at appropriate positions
- CaseForming shows mixed colors (60P/50P/30P cycling)
- CasePacker1/2/3 each show their respective product family colors
- CapCloser shows mixed product colors
- Palletizer shows sparse grey bars

- [ ] **Step 2: Verify Last 7 Days**

Click "Last 7 Days". Confirm:
- Date range updates to 7 days back → next 06:00
- Chart re-renders with a wider time window and more bars

- [ ] **Step 3: Verify hover tooltip**

Hover over any bar. Confirm tooltip shows Time, Source, Product, Qty correctly. Move to chart edge — tooltip stays inside viewport.

- [ ] **Step 4: Verify nav consistency**

Navigate from Production Dashboard → Production Timeline → OEE Dashboard → back to Production Timeline. Confirm "Production Timeline" is highlighted (active) only on `timeline.html`.

- [ ] **Step 5: Verify 5 000-row limit message**

If row count equals 5 000, the meta line should end with "(limit reached — narrow your date range)".

- [ ] **Step 6: Final commit**

```bash
git add public/timeline.html
git commit -m "feat: production timeline swimlane page complete"
```
