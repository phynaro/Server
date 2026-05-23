# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start with nodemon (auto-restart on JS/JSON changes)
npm start        # Start without auto-restart
```

No test suite exists. The `check_*.js` and `analyze_*.js` scripts in the root are one-off debug/analysis tools, not tests — run them with `node <script>.js` directly.

Docker: `docker-compose up` (uses `npm run dev` inside the container).

## Architecture

This is a **single-file Express server** (`server.js`) backed by a SQLite database, serving a vanilla HTML/JS/CSS factory production monitoring dashboard.

### Backend

- **`server.js`** — monolithic: DB schema initialization, all route handlers, and helper functions (`shiftDate`, `currentShiftDate`, `updateHeartbeat`) all live here. Port 3001.
- **`oee_helper.js`** — pure OEE calculation logic. Owns `stateMap` / `reasonMap` (state and fault reason code → label), and `calculateStateDurations()` which computes A/P/Q/OEE KPIs, state timelines, and a Pareto of loss reasons.
- **`scheduler_helper.js`** — background KPI aggregation. `updateMachineDay(db, date, machine)` recalculates and upserts a row in `DailyKpiSummary`; `updateReliabilityTrends()` updates rolling MTBF/MTTR in `ReliabilityHistory`. Called reactively on quality data mutations; the periodic `setInterval` call in `server.js` is commented out.
- **`public/`** — static files served by Express. No build step. `shared.js` and `shared.css` are loaded by all pages.

### Database tables

| Table | Purpose |
|---|---|
| `ReceivedData` | Production events (case counts) from machines |
| `ReceivedOEE` | Machine state-change events for Availability tracking |
| `QualityData` | Manually entered bad-count records (with optional image) |
| `CycleTimes` | Per-machine Ideal Cycle Time (seconds) for Performance calculation |
| `SourceStatus` | Last-seen heartbeat timestamp per source |
| `MachineQualityEvents` | Machine-reported quality/reject events with optional fault image |
| `DailyKpiSummary` | Pre-aggregated daily OEE KPIs — written by `scheduler_helper` |
| `ReliabilityHistory` | Rolling 30-day MTBF/MTTR — written by `scheduler_helper` |

### Key domain concepts

**Shift day**: 06:00–06:00 local time (+7 UTC offset hardcoded throughout). A record at 03:00 belongs to the *previous* calendar day's shift. `shiftDate()` and `currentShiftDate()` in `server.js` encapsulate this.

**Timestamps**: `SourceTimestamp` is UTC (used for all SQL range queries); `LocalTimestamp` is UTC+7 (used for display and `QualityData` filtering). The server converts between them by adding/subtracting 7 hours (3600000 × 7 ms).

**Timestamp format in `MachineQualityEvents`**: The `Timestamp` column stores ISO 8601 strings from the machine in the form `2026-05-23T06:02:03.8810000Z` (with `T` separator and `Z` suffix). **Never compare this column with a plain `'YYYY-MM-DD HH:MM:SS'` string directly** — because `'T'` (ASCII 84) sorts after `' '` (ASCII 32), all same-day rows appear to be *after* any space-separated cutoff, silently producing wrong results. Always wrap the column in `datetime()`: `WHERE datetime(Timestamp) < '2026-05-23 06:00:00'`.

**Product codes** (`TypeOfProduct`):
- `1`/`2` = 60PA/60PB (CasePacker1 lines A/B) — 51 units/box, 8 cases/pallet
- `3`/`4` = 50PA/50PB (CasePacker2)
- `5`/`6` = 30PA/30PB (CasePacker3) — 49 units/box, 6 cases/pallet
- `10`/`20`/`30` = 60P/50P/30P aggregate (CaseForming)
- `901`–`906` = reject variants of 1–6

**Machine source names**: `CasePacker1`, `CasePacker2`, `CasePacker3`, `CaseForming`, `CapCloser`, `Palletizer`. OEE machine IDs append `_A` / `_B` for packer sub-lines (e.g. `CasePacker1_A`).

**OEE formula**: `OEE = A × P × Q`
- A = `RunTime / AvailableTime` (AvailableTime excludes Planned Stop)
- P = `(ICT × TotalCount) / RunTime` (capped at 100%)
- Q = `(TotalCount − BadCount) / TotalCount`

Bad count combines manual `QualityData` entries plus CapCloser reject signals for packer machines.

### Frontend pages

| File | Dashboard |
|---|---|
| `index.html` | Production summary (counts by machine/product, date range) |
| `oee.html` + `oee_client.js` | OEE dashboard — live A/P/Q/OEE, state timeline, Pareto |
| `quality.html` | Manual quality entry CRUD with image upload |
| `reliability.html` | MTBF/MTTR trends and OEE heatmap |
| `settings.html` | ICT (Ideal Cycle Time) management per machine |

`shared.js` provides `toggleMenu()`, `setActiveNav()`, `showDataStatus()`, `clearDataStatus()`.  
Design direction: management dashboard style — minimalist, typography-driven, color only for out-of-range values. See `DESIGN_IMPROVEMENTS.md` for the full backlog and completion status.
