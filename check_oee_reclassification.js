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
