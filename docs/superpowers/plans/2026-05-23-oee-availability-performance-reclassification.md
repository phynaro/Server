# OEE Availability / Performance Reclassification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reclassify Starved (state 2) and Blocked (state 3) as Performance losses (minor stops) per ISO 22400-2, so Availability only reflects machine-side downtime (Faulted + Idle/Wait Operator).

**Architecture:** Two files change. `oee_helper.js` owns all calculation logic — introduce an `uptime` variable (Run + Starved + Blocked) and redefine Technical Availability as `(uptime + idleTime) / AvailableTime`. `oee.html` gets tooltip text updates only — no layout or JS changes. `oee_client.js` is untouched (reads KPI fields by name).

**Tech Stack:** Node.js, vanilla JS, no test framework (project uses one-off `check_*.js` scripts for verification).

---

## Files

| Action | File | What changes |
|---|---|---|
| Modify | `oee_helper.js:138–182` | KPI calculation block — uptime, A, TA, P, totalLoss |
| Create | `check_oee_reclassification.js` | One-off verification script (delete after use) |
| Modify | `public/oee.html:113–202` | Four tooltip text blocks |

---

## Task 1: Write Verification Script (Defines Expected Behavior)

**Files:**
- Create: `check_oee_reclassification.js`

- [ ] **Step 1: Create the verification script**

```javascript
// check_oee_reclassification.js
// Run with: node check_oee_reclassification.js
// Expected: FAIL before code change, PASS after.
const { calculateStateDurations } = require('./oee_helper');

function makeRow(stateCode, reasonCode, localTimestamp) {
    return { StateCode: stateCode, ReasonCode: reasonCode, LocalTimestamp: localTimestamp };
}

// Fixed timeline with known durations:
// 08:00–08:10  Running         600s  state 1
// 08:10–08:13  Starved         180s  state 2
// 08:13–08:15  Blocked         120s  state 3
// 08:15–08:16  Idle/Wait Op.    60s  state 4
// 08:16–08:20  Faulted         240s  state 5
// 08:20–08:25  Planned Stop    300s  state 6
// totalTime = 1500s, AvailableTime = 1200s
// uptime = 900s, techUptime = 960s
const rows = [
    makeRow(1, 0,   '2026-01-01 08:00:00'),
    makeRow(2, 200, '2026-01-01 08:10:00'),
    makeRow(3, 300, '2026-01-01 08:13:00'),
    makeRow(4, 401, '2026-01-01 08:15:00'),
    makeRow(5, 501, '2026-01-01 08:16:00'),
    makeRow(6, 0,   '2026-01-01 08:20:00'),
    makeRow(6, 0,   '2026-01-01 08:25:00'), // end marker
];

// ICT = 1s, count = 800 → P = 800/900 = 88.9%
// No bad count → Q = 100%
// OEE = (1 * 800 * 1.0) / 1200 = 66.7%
const { kpis } = calculateStateDurations(rows, false, 1, 800, 0);

const expected = {
    operationalAvailability: '75.0',  // 900 / 1200
    technicalAvailability:   '80.0',  // 960 / 1200
    performance:             '88.9',  // 800 / 900
    quality:                 '100.0',
    oee:                     '66.7',  // 0.75 * 0.889 * 1.0
    totalLoss:               300,     // 1200 - 900 (seconds)
};

let passed = true;
for (const [key, value] of Object.entries(expected)) {
    const actual = kpis[key];
    const match = String(actual) === String(value);
    console.log(`${match ? '✓' : '✗'} ${key}: expected ${value}, got ${actual}`);
    if (!match) passed = false;
}
console.log('');
console.log(passed ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
process.exit(passed ? 0 : 1);
```

- [ ] **Step 2: Run it against current code to confirm it fails**

```bash
node check_oee_reclassification.js
```

Expected output (current code will fail because OA uses RunTime, P caps at 100%):
```
✗ operationalAvailability: expected 75.0, got 50.0
✗ technicalAvailability: expected 80.0, got 75.0
✗ performance: expected 88.9, got 100.0
✓ quality: expected 100.0, got 100.0
✗ oee: expected 66.7, got 50.0
✗ totalLoss: expected 300, got 600
SOME CHECKS FAILED
```

---

## Task 2: Update `calculateStateDurations()` in `oee_helper.js`

**Files:**
- Modify: `oee_helper.js:138–182`

- [ ] **Step 1: Replace the KPI Calculations block**

Find this block (starts at line 138):

```javascript
    // KPI Calculations
    const runTime = totalsByState['Running'] || totalsByState['Running/Starved'] || 0;
    const starvedTime = totalsByState['Starved'] || 0;
    const blockedTime = totalsByState['Blocked'] || 0;
    const faultTime = totalsByState['Faulted'] || 0;
    const plannedStop = totalsByState['Planned Stop'] || 0;
    
    const availableTime = totalTime - plannedStop;
    const techUptime = (totalsByState['Running/Starved'] || (runTime + starvedTime + blockedTime));

    // A = Operational Availability
    const availability = availableTime > 0 ? (runTime / availableTime) : 0;

    // P = (IdealCycleTimeSec x TotalCount) / RunningTime
    let performance = 0;
    if (runTime > 0 && idealCycleTime > 0) {
        performance = (idealCycleTime * totalCount) / runTime;
        if (performance > 1) performance = 1; // Cap at 100%
    }
```

Replace with:

```javascript
    // KPI Calculations
    const runTime = totalsByState['Running'] || totalsByState['Running/Starved'] || 0;
    const starvedTime = totalsByState['Starved'] || 0;
    const blockedTime = totalsByState['Blocked'] || 0;
    const idleTime = totalsByState['Idle/Wait Operator'] || 0;
    const faultTime = totalsByState['Faulted'] || 0;
    const plannedStop = totalsByState['Planned Stop'] || 0;

    // ISO 22400: Uptime = machine-ready states (line-constrained minor stops included)
    const uptime = runTime + starvedTime + blockedTime;
    const availableTime = totalTime - plannedStop;
    // TA numerator: only Faulted reduces it; Idle/Wait Operator is human-response loss
    const techUptime = uptime + idleTime;

    // A = Operational Availability: downtime = Faulted + Idle/Wait Operator
    const availability = availableTime > 0 ? (uptime / availableTime) : 0;

    // P = (IdealCycleTimeSec x TotalCount) / Uptime (Starved + Blocked are minor stops)
    let performance = 0;
    if (uptime > 0 && idealCycleTime > 0) {
        performance = (idealCycleTime * totalCount) / uptime;
        if (performance > 1) performance = 1;
    }
```

- [ ] **Step 2: Update `totalLoss` in the `kpis` object**

Find:
```javascript
        totalLoss: availableTime - runTime
```

Replace with:
```javascript
        totalLoss: availableTime - uptime
```

- [ ] **Step 3: Run the verification script — expect PASS**

```bash
node check_oee_reclassification.js
```

Expected output:
```
✓ operationalAvailability: expected 75.0, got 75.0
✓ technicalAvailability: expected 80.0, got 80.0
✓ performance: expected 88.9, got 88.9
✓ quality: expected 100.0, got 100.0
✓ oee: expected 66.7, got 66.7
✓ totalLoss: expected 300, got 300
ALL CHECKS PASSED
```

- [ ] **Step 4: Commit**

```bash
git add oee_helper.js
git commit -m "feat: reclassify Starved/Blocked as Performance losses (ISO 22400)"
```

---

## Task 3: Update Tooltip Text in `oee.html`

**Files:**
- Modify: `public/oee.html:115–201`

- [ ] **Step 1: Update Availability (A) tooltip (lines ~115–119)**

Find:
```html
                    <span class="tooltiptext">
                        <b>Availability (A)</b><br>
                        Formula: <i>Running Time / (Total Time - Planned Stops)</i><br><br>
                        Measures pure production time. Only State 1 (Running) is considered "Up". Everything else is downtime.
                    </span>
```

Replace with:
```html
                    <span class="tooltiptext">
                        <b>Availability (A)</b><br>
                        Formula: <i>(Running + Starved + Blocked) / (Total Time - Planned Stops)</i><br><br>
                        Machine is Available when Running, Starved, or Blocked — these are line-constraint states where the machine is mechanically ready. Downtime is Faulted + Idle/Wait Operator (both require intervention to restore production).
                    </span>
```

- [ ] **Step 2: Update Performance (P) tooltip (lines ~128–132)**

Find:
```html
                    <span class="tooltiptext">
                        <b>Performance (P)</b><br>
                        Formula: <i>(Ideal Cycle Time × Total Produced) / Actual Running Time</i><br><br>
                        Measures machine speed capability. It only looks at the time the machine was strictly in State 1 (Running).
                    </span>
```

Replace with:
```html
                    <span class="tooltiptext">
                        <b>Performance (P)</b><br>
                        Formula: <i>(Ideal Cycle Time × Total Produced) / (Running + Starved + Blocked)</i><br><br>
                        Measures speed efficiency against available machine time. Starved and Blocked are line-constraint minor stops — the machine was available but not cycling, reducing Performance.
                    </span>
```

- [ ] **Step 3: Update Technical Availability tooltip (lines ~167–171)**

Find:
```html
                    <span class="tooltiptext">
                        <b>Technical Availability</b><br>
                        Formula: <i>(Running + Starved + Blocked) / (Total Time - Planned Stops)</i><br><br>
                        Focuses on machine reliability by ignoring external bottlenecks (missing infeed or full outfeed).
                    </span>
```

Replace with:
```html
                    <span class="tooltiptext">
                        <b>Technical Availability</b><br>
                        Formula: <i>(Running + Starved + Blocked + Idle) / (Total Time - Planned Stops)</i><br><br>
                        Measures pure mechanical reliability — only Faulted (State 5) reduces this. Idle/Wait Operator is excluded since it reflects operator response speed, not machine health. The gap between TA and OA shows operator-intervention loss.
                    </span>
```

- [ ] **Step 4: Update MTTR tooltip and sub-label (lines ~193–201)**

Find:
```html
                    <span class="tooltiptext">
                        <b>MTTR</b><br>
                        Formula: <i>Total Fault Duration / Number of Faults</i><br><br>
                        Mean Time To Repair. Measures the average response and repair speed of the maintenance team.
                    </span>
                </div>
                <div class="kpi-label">MTTR</div>
                <div class="kpi-value" id="kpiMttr">—</div>
                <div class="kpi-sub">Mean Time To Repair</div>
```

Replace with:
```html
                    <span class="tooltiptext">
                        <b>MTTR</b><br>
                        Formula: <i>Total Fault Duration / Number of Faults</i><br><br>
                        Avg Fault Recovery Time. Measures maintenance team response speed for mechanical failures (State 5 only). Operator-intervention loss (State 4) is visible as the gap between Technical and Operational Availability.
                    </span>
                </div>
                <div class="kpi-label">MTTR</div>
                <div class="kpi-value" id="kpiMttr">—</div>
                <div class="kpi-sub">Avg Fault Recovery Time</div>
```

- [ ] **Step 5: Commit**

```bash
git add public/oee.html
git commit -m "docs: update OEE tooltip formulas for A/P reclassification"
```

---

## Task 4: Cleanup

- [ ] **Step 1: Delete the verification script**

```bash
rm check_oee_reclassification.js
git add check_oee_reclassification.js
git commit -m "chore: remove one-off OEE reclassification verification script"
```

---

## Notes

- **OEE number may differ from historical values** if the old P formula was being capped at 100% (i.e., `ICT × Count > RunTime`). In that case the old formula was hiding real performance loss by overcounting A loss. The new numbers are more correct.
- `oee_client.js` — no changes needed. Reads KPIs by field name.
- `scheduler_helper.js` / `reliability.html` — no changes needed. `updateMachineDay()` calls `calculateStateDurations()` and will pick up new values automatically.
- `reliability.html` — no changes needed.
