// rerun_scheduler_history.js
// Re-runs updateMachineDay for all dates in DailyKpiSummary to fix TopLossesJson
// (Starved/Blocked were incorrectly stored as A-losses before the ISO 22400 fix)
//
// Run inside Docker: node rerun_scheduler_history.js
// Or via the server session: ! node rerun_scheduler_history.js

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { updateMachineDay } = require('./scheduler_helper');

const MACHINES = ['CasePacker1_A', 'CasePacker1_B', 'CasePacker2_A', 'CasePacker2_B', 'CasePacker3_A', 'CasePacker3_B', 'CaseForming'];

const dbPath = path.join(__dirname, 'target_database.db');
const db = new sqlite3.Database(dbPath);

db.all('SELECT DISTINCT ProdDate FROM DailyKpiSummary ORDER BY ProdDate', async (err, rows) => {
    if (err) { console.error('Failed to query dates:', err.message); db.close(); return; }

    const dates = rows.map(r => r.ProdDate);
    console.log(`Found ${dates.length} date(s): ${dates.join(', ')}`);
    console.log(`Re-running for ${MACHINES.length} machines each...\n`);

    let done = 0;
    const total = dates.length * MACHINES.length;

    for (const date of dates) {
        for (const machine of MACHINES) {
            try {
                await updateMachineDay(db, date, machine);
                done++;
                process.stdout.write(`\r[${done}/${total}] ${date} / ${machine}      `);
            } catch (e) {
                console.error(`\nFailed ${date} / ${machine}: ${e.message}`);
            }
        }
    }

    console.log(`\n\nDone. ${done}/${total} machine-days updated.`);
    db.close();
});
