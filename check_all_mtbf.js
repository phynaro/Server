const oeeHelper = require('./oee_helper.js');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('target_database.db');

const startSQL = '2026-05-19T23:00:00';

const checkMachine = (source) => {
    return new Promise((resolve, reject) => {
        db.all("SELECT SourceTimestamp, StateCode, ReasonCode FROM ReceivedOEE WHERE Source = ? AND SourceTimestamp >= ? ORDER BY SourceTimestamp ASC", [source, startSQL], (err, rows) => {
            if (err) return reject(err);
            const mappedRows = rows.map(r => ({
                ...r,
                LocalTimestamp: new Date(new Date(r.SourceTimestamp + 'Z').getTime() + (7 * 3600000)).toISOString().replace('Z', '').replace('T', ' ')
            }));
            const results = oeeHelper.calculateStateDurations(mappedRows, false, 10.0, 0, 0);
            resolve({
                source,
                rowCount: rows.length,
                mtbf: results.kpis.mtbf,
                failures: results.kpis.totalFailures
            });
        });
    });
};

async function main() {
    const machines = ['CasePacker1_A', 'CasePacker1_B', 'CasePacker2_A', 'CasePacker2_B', 'CasePacker3_A', 'CasePacker3_B', 'CaseForming'];
    for (const m of machines) {
        const res = await checkMachine(m);
        const mtbfStr = res.mtbf ? (res.mtbf/60).toFixed(1) + 'm' : 'N/A';
        console.log(`${m}: Rows=${res.rowCount}, MTBF=${mtbfStr}, Failures=${res.failures}`);
    }
    db.close();
}

main();
