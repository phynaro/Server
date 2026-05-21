const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'target_database.db');
const db = new sqlite3.Database(dbPath);

async function calculateReliabilityTrends() {
    console.log('Calculating Reliability Trends (30-day Rolling)...');

    const machinesQuery = `SELECT DISTINCT Machine FROM DailyKpiSummary`;
    const machines = await new Promise(res => db.all(machinesQuery, (err, rows) => res(rows.map(r => r.Machine))));

    const datesQuery = `SELECT DISTINCT ProdDate FROM DailyKpiSummary ORDER BY ProdDate ASC`;
    const dates = await new Promise(res => db.all(datesQuery, (err, rows) => res(rows.map(r => r.ProdDate))));

    for (const machine of machines) {
        for (const date of dates) {
            // Get last 30 days of data for this machine ending at 'date'
            const rollingQuery = `
                SELECT SUM(TechUptime) as TotalUptime, SUM(FaultTime) as TotalFaultTime, SUM(FaultCount) as TotalFaults
                FROM DailyKpiSummary
                WHERE Machine = ? AND ProdDate <= ? AND ProdDate > date(?, '-30 days')
            `;
            const stats = await new Promise(res => db.get(rollingQuery, [machine, date, date], (err, row) => res(row)));

            if (stats && stats.TotalUptime !== null) {
                const rollingMtbf = stats.TotalFaults > 0 ? (stats.TotalUptime / stats.TotalFaults) : stats.TotalUptime;
                const rollingMttr = stats.TotalFaults > 0 ? (stats.TotalFaultTime / stats.TotalFaults) : 0;

                const upsertQuery = `
                    INSERT INTO ReliabilityHistory (Date, Machine, RollingMtbf, RollingMttr)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(Date, Machine) DO UPDATE SET
                        RollingMtbf = excluded.RollingMtbf,
                        RollingMttr = excluded.RollingMttr
                `;
                await new Promise(res => db.run(upsertQuery, [date, machine, rollingMtbf, rollingMttr], res));
            }
        }
    }

    console.log('Reliability trends updated.');
    db.close();
}

calculateReliabilityTrends();
