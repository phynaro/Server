const sqlite3 = require('sqlite3').verbose();
const oeeHelper = require('./oee_helper');
const path = require('path');

const dbPath = path.join(__dirname, 'target_database.db');
const db = new sqlite3.Database(dbPath);

async function backfill() {
    console.log('Starting backfill process...');

    // 1. Get all unique dates and machines from ReceivedOEE
    // Production day is 6AM-6AM, so we group by date(SourceTimestamp, '+1 hour')
    const datesQuery = `
        SELECT DISTINCT date(SourceTimestamp, '+1 hour') as ProdDate 
        FROM ReceivedOEE 
        WHERE SourceTimestamp IS NOT NULL
        ORDER BY ProdDate ASC
    `;

    const machinesQuery = `SELECT DISTINCT Source FROM ReceivedOEE`;

    const dates = await new Promise((resolve) => db.all(datesQuery, (err, rows) => resolve(rows.map(r => r.ProdDate))));
    const machines = await new Promise((resolve) => db.all(machinesQuery, (err, rows) => resolve(rows.map(r => r.Source))));

    console.log(`Found ${dates.length} dates and ${machines.length} machines.`);

    for (const date of dates) {
        for (const machine of machines) {
            console.log(`Processing ${date} for ${machine}...`);
            
            // Re-use existing logic from /api/oee but in a script
            const startObj = new Date(date + 'T06:00:00');
            const endObj = new Date(startObj);
            endObj.setDate(endObj.getDate() + 1);

            const startSQL = new Date(startObj.getTime() - (7 * 3600000)).toISOString().replace('Z', '');
            const endSQL = new Date(endObj.getTime() - (7 * 3600000)).toISOString().replace('Z', '');

            // Get ICT
            const ictRow = await new Promise(res => db.get(`SELECT ideal_cycle_time FROM CycleTimes WHERE machine_id = ?`, [machine], (err, row) => res(row)));
            const ict = ictRow ? ictRow.ideal_cycle_time : 10;

            // Get Counts
            // Note: This matches the mapping logic in server.js
            const prodMapping = {
                'CasePacker1_A': { source: 'CasePacker1', type: '1' },
                'CasePacker1_B': { source: 'CasePacker1', type: '2' },
                'CasePacker2_A': { source: 'CasePacker2', type: '3' },
                'CasePacker2_B': { source: 'CasePacker2', type: '4' },
                'CasePacker3_A': { source: 'CasePacker3', type: '5' },
                'CasePacker3_B': { source: 'CasePacker3', type: '6' },
                'CaseForming': { source: 'CaseForming', types: ['10', '20', '30'] },
                'Palletizer': { source: 'Palletizer', types: ['1', '2', '3', '4', '5', '6'] }
            };
            const mapping = prodMapping[machine];
            let totalCount = 0;
            if (machine === 'Palletizer') {
                const cQuery = `SELECT SUM(CASE WHEN TypeOfProduct IN ('1', '2') THEN 8 ELSE 6 END) as Count 
                                FROM ReceivedData 
                                WHERE Source = 'Palletizer' AND TypeOfProduct IN ('1','2','3','4','5','6') 
                                AND SourceTimestamp BETWEEN ? AND ?`;
                const cRow = await new Promise(res => db.get(cQuery, [startSQL, endSQL], (err, row) => res(row)));
                totalCount = cRow ? (cRow.Count || 0) : 0;
            } else if (mapping) {
                let cQuery = mapping.types 
                    ? `SELECT COUNT(*) as Count FROM ReceivedData WHERE Source = ? AND TypeOfProduct IN (${mapping.types.map(()=>'?').join(',')}) AND SourceTimestamp BETWEEN ? AND ?`
                    : `SELECT COUNT(*) as Count FROM ReceivedData WHERE Source = ? AND TypeOfProduct = ? AND SourceTimestamp BETWEEN ? AND ?`;
                let cParams = mapping.types ? [mapping.source, ...mapping.types, startSQL, endSQL] : [mapping.source, mapping.type, startSQL, endSQL];
                const cRow = await new Promise(res => db.get(cQuery, cParams, (err, row) => res(row)));
                totalCount = cRow ? cRow.Count : 0;
            }

            // Bad Count
            let badCount = 0;
            if (machine === 'Palletizer') {
                const bQuery = `SELECT SUM(CASE WHEN ProductType IN ('1', '2') THEN BadCount * 8 ELSE BadCount * 6 END) as TotalBad 
                                FROM QualityData 
                                WHERE Machine = 'Palletizer' AND ProductType IN ('1','2','3','4','5','6') 
                                AND date(LocalTimestamp) = ?`;
                const bRow = await new Promise(res => db.get(bQuery, [date], (err, row) => res(row)));
                badCount = bRow ? (bRow.TotalBad || 0) : 0;
            } else {
                let bQuery = "SELECT SUM(BadCount) as TotalBad FROM QualityData WHERE Machine = ? AND date(LocalTimestamp) = ?";
                let bParams = [machine, date];
                if (machine === 'CaseForming') {
                    bQuery = "SELECT SUM(BadCount) as TotalBad FROM QualityData WHERE Machine = 'CaseForming' AND ProductType IN ('10','20','30') AND date(LocalTimestamp) = ?";
                    bParams = [date];
                } else if (mapping) {
                    bQuery = "SELECT SUM(BadCount) as TotalBad FROM QualityData WHERE Machine = ? AND ProductType = ? AND date(LocalTimestamp) = ?";
                    bParams = [machine, mapping.type, date];
                }
                const bRow = await new Promise(res => db.get(bQuery, bParams, (err, row) => res(row)));
                badCount = bRow ? (bRow.TotalBad || 0) : 0;
            }

            // OEE Data
            const beforeRow = await new Promise(res => db.get(`SELECT * FROM ReceivedOEE WHERE Source = ? AND SourceTimestamp < ? ORDER BY SourceTimestamp DESC LIMIT 1`, [machine, startSQL], (err, row) => res(row)));
            const rangeRows = await new Promise(res => db.all(`SELECT * FROM ReceivedOEE WHERE Source = ? AND SourceTimestamp BETWEEN ? AND ? ORDER BY SourceTimestamp ASC`, [machine, startSQL, endSQL], (err, rows) => res(rows || [])));

            let finalRows = [];
            if (beforeRow) {
                beforeRow.LocalTimestamp = date + ' 06:00:00';
                finalRows.push(beforeRow);
            } else if (rangeRows.length > 0) {
                const first = { ...rangeRows[0] };
                first.LocalTimestamp = date + ' 06:00:00';
                finalRows.push(first);
            }
            finalRows = finalRows.concat(rangeRows);
            if (finalRows.length > 0) {
                const last = finalRows[finalRows.length - 1];
                finalRows.push({ ...last, LocalTimestamp: new Date(new Date(date + 'T06:00:00').getTime() + 86400000).toISOString().replace('T', ' ').split('.')[0], StateCode: last.StateCode });
            }

            if (finalRows.length >= 2) {
                const results = oeeHelper.calculateStateDurations(finalRows, false, ict, totalCount, badCount);
                
                // Aggregates for Summary Table
                const runTime = results.summary.find(s => s.stateLabel === 'Running')?.duration || 0;
                const starvedTime = results.summary.find(s => s.stateLabel === 'Starved')?.duration || 0;
                const blockedTime = results.summary.find(s => s.stateLabel === 'Blocked')?.duration || 0;
                const techUptime = runTime + starvedTime + blockedTime;
                const faultTime = results.summary.find(s => s.stateLabel === 'Faulted')?.duration || 0;
                const faultCount = results.kpis.totalFailures;

                // Upsert into DailyKpiSummary
                const upsertQuery = `
                    INSERT INTO DailyKpiSummary (ProdDate, Machine, TechUptime, FaultTime, FaultCount, TotalCount, BadCount, Availability, Performance, Quality, Oee, SummaryJson, TopLossesJson)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(ProdDate, Machine) DO UPDATE SET
                        TechUptime = excluded.TechUptime,
                        FaultTime = excluded.FaultTime,
                        FaultCount = excluded.FaultCount,
                        TotalCount = excluded.TotalCount,
                        BadCount = excluded.BadCount,
                        Availability = excluded.Availability,
                        Performance = excluded.Performance,
                        Quality = excluded.Quality,
                        Oee = excluded.Oee,
                        SummaryJson = excluded.SummaryJson,
                        TopLossesJson = excluded.TopLossesJson
                `;
                await new Promise(res => db.run(upsertQuery, [
                    date, machine, techUptime, faultTime, faultCount, totalCount, badCount,
                    results.kpis.operationalAvailability, results.kpis.performance, results.kpis.quality, results.kpis.oee,
                    JSON.stringify(results.summary), JSON.stringify(results.topLosses)
                ], res));
            }
        }
    }
    console.log('Backfill completed.');
    db.close();
}

backfill();
