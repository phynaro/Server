const sqlite3 = require('sqlite3').verbose();
const oeeHelper = require('./oee_helper');
const path = require('path');

const dbPath = path.join(__dirname, 'target_database.db');

async function runDailyUpdate() {
    console.log('[Scheduler] Starting background KPI update...');
    const db = new sqlite3.Database(dbPath);
    
    try {
        console.log('[Scheduler] DB connection opened.');
        // 1. Determine the current and previous production dates
        const nowUTC = new Date();
        const nowLocal = new Date(nowUTC.getTime() + (7 * 3600000));
        
        const currentProdDateObj = new Date(nowLocal);
        if (nowLocal.getHours() < 6) {
            currentProdDateObj.setDate(currentProdDateObj.getDate() - 1);
        }
        const currentProdDate = currentProdDateObj.toISOString().split('T')[0];

        const prevProdDateObj = new Date(currentProdDateObj);
        prevProdDateObj.setDate(prevProdDateObj.getDate() - 1);
        const prevProdDate = prevProdDateObj.toISOString().split('T')[0];

        const datesToProcess = [prevProdDate, currentProdDate];
        const machines = ['CasePacker1_A', 'CasePacker1_B', 'CasePacker2_A', 'CasePacker2_B', 'CasePacker3_A', 'CasePacker3_B', 'CaseForming'];

        console.log(`[Scheduler] Processing dates: ${datesToProcess.join(', ')}`);

        for (const date of datesToProcess) {
            for (const machine of machines) {
                console.log(`[Scheduler] Updating machine ${machine} for date ${date}...`);
                await updateMachineDay(db, date, machine);
            }
        }

        // 2. Update Rolling Reliability
        console.log('[Scheduler] Updating reliability trends...');
        await updateReliabilityTrends(db, machines, currentProdDate);

        console.log('[Scheduler] Background update completed successfully.');
    } catch (err) {
        console.error('[Scheduler] Error during background update:', err);
    } finally {
        console.log('[Scheduler] Closing DB connection.');
        db.close();
    }
}


async function updateMachineDay(db, date, machine) {
    console.log(`[Scheduler Debug] Starting updateMachineDay for ${machine} on ${date}`);
    const startObj = new Date(date + 'T06:00:00');
    const endObj = new Date(startObj);
    endObj.setDate(endObj.getDate() + 1);

    const startSQL = new Date(startObj.getTime() - (7 * 3600000)).toISOString().replace('Z', '');
    const endSQL = new Date(endObj.getTime() - (7 * 3600000)).toISOString().replace('Z', '');

    console.log(`[Scheduler Debug] Time range: ${startSQL} to ${endSQL}`);

    // Get ICT helper
    const getICT = (m) => new Promise((resolve, reject) => {
        console.log(`[Scheduler Debug] Fetching ICT for ${m}...`);
        db.get(`SELECT ideal_cycle_time FROM CycleTimes WHERE machine_id = ?`, [m], (err, row) => {
            if (err) {
                console.error(`[Scheduler Debug] ICT Error: ${err.message}`);
                return reject(err);
            }
            console.log(`[Scheduler Debug] ICT Row: ${JSON.stringify(row)}`);
            resolve(row ? row.ideal_cycle_time : 10);
        });
    });

    const ict = await getICT(machine);
    console.log(`[Scheduler Debug] ICT: ${ict}`);

    // Production Count Mapping
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
        const cRow = await new Promise((resolve, reject) => db.get(cQuery, [startSQL, endSQL], (err, row) => err ? reject(err) : resolve(row)));
        totalCount = cRow ? (cRow.Count || 0) : 0;
    } else if (mapping) {
        let cQuery = mapping.types 
            ? `SELECT COUNT(*) as Count FROM ReceivedData WHERE Source = ? AND TypeOfProduct IN (${mapping.types.map(()=>'?').join(',')}) AND SourceTimestamp BETWEEN ? AND ?`
            : `SELECT COUNT(*) as Count FROM ReceivedData WHERE Source = ? AND TypeOfProduct = ? AND SourceTimestamp BETWEEN ? AND ?`;
        let cParams = mapping.types ? [mapping.source, ...mapping.types, startSQL, endSQL] : [mapping.source, mapping.type, startSQL, endSQL];
        const cRow = await new Promise((resolve, reject) => db.get(cQuery, cParams, (err, row) => err ? reject(err) : resolve(row)));
        totalCount = cRow ? (cRow.Count || 0) : 0;
    }

    // Bad Count
    let badCount = 0;
    if (machine === 'Palletizer') {
        const bQuery = `SELECT SUM(CASE WHEN ProductType IN ('1', '2') THEN BadCount * 8 ELSE BadCount * 6 END) as TotalBad 
                        FROM QualityData 
                        WHERE Machine = 'Palletizer' AND ProductType IN ('1','2','3','4','5','6') 
                        AND date(LocalTimestamp) = ?`;
        const bRow = await new Promise((resolve, reject) => db.get(bQuery, [date], (err, row) => err ? reject(err) : resolve(row)));
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
        const bRow = await new Promise((resolve, reject) => db.get(bQuery, bParams, (err, row) => err ? reject(err) : resolve(row)));
        badCount = bRow ? (bRow.TotalBad || 0) : 0;
    }

    // OEE Data
    const beforeRow = await new Promise((resolve, reject) => db.get(`SELECT * FROM ReceivedOEE WHERE Source = ? AND SourceTimestamp < ? ORDER BY SourceTimestamp DESC LIMIT 1`, [machine, startSQL], (err, row) => err ? reject(err) : resolve(row)));
    const rangeRows = await new Promise((resolve, reject) => db.all(`SELECT * FROM ReceivedOEE WHERE Source = ? AND SourceTimestamp BETWEEN ? AND ? ORDER BY SourceTimestamp ASC`, [machine, startSQL, endSQL], (err, rows) => err ? reject(err) : resolve(rows || [])));

    let finalRows = [];
    if (beforeRow) {
        beforeRow.LocalTimestamp = date + ' 06:00:00';
        finalRows.push(beforeRow);
    } else if (rangeRows && rangeRows.length > 0) {
        const first = { ...rangeRows[0] };
        first.LocalTimestamp = date + ' 06:00:00';
        finalRows.push(first);
    }
    if (rangeRows) finalRows = finalRows.concat(rangeRows);
    
    if (finalRows.length > 0) {
        const last = finalRows[finalRows.length - 1];
        const nowUTC = new Date();
        const nowLocal = new Date(nowUTC.getTime() + (7 * 3600000));
        let effectiveEnd = endObj;
        if (nowLocal < endObj) effectiveEnd = nowLocal;

        finalRows.push({ 
            ...last, 
            LocalTimestamp: effectiveEnd.toISOString().replace('T', ' ').split('.')[0], 
            StateCode: last.StateCode 
        });
    }

    if (finalRows.length >= 2) {
        const results = oeeHelper.calculateStateDurations(finalRows, false, ict, totalCount, badCount);
        
        const runTime = results.summary.find(s => s.stateLabel === 'Running')?.duration || 0;
        const starvedTime = results.summary.find(s => s.stateLabel === 'Starved')?.duration || 0;
        const blockedTime = results.summary.find(s => s.stateLabel === 'Blocked')?.duration || 0;
        const techUptime = runTime + starvedTime + blockedTime;
        const faultTime = results.summary.find(s => s.stateLabel === 'Faulted')?.duration || 0;
        const faultCount = results.kpis.totalFailures;

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
        await new Promise((resolve, reject) => db.run(upsertQuery, [
            date, machine, techUptime, faultTime, faultCount, totalCount, badCount,
            results.kpis.operationalAvailability, results.kpis.performance, results.kpis.quality, results.kpis.oee,
            JSON.stringify(results.summary), JSON.stringify(results.topLosses)
        ], (err) => err ? reject(err) : resolve()));
    }
}

async function updateReliabilityTrends(db, machines, currentDate) {
    const datesQuery = `SELECT DISTINCT ProdDate FROM DailyKpiSummary WHERE ProdDate >= date(?, '-7 days') ORDER BY ProdDate ASC`;
    const rows = await new Promise((resolve, reject) => db.all(datesQuery, [currentDate], (err, rows) => err ? reject(err) : resolve(rows || [])));
    const dates = rows.map(r => r.ProdDate);

    for (const machine of machines) {
        for (const date of dates) {
            const rollingQuery = `
                SELECT SUM(TechUptime) as TotalUptime, SUM(FaultTime) as TotalFaultTime, SUM(FaultCount) as TotalFaults
                FROM DailyKpiSummary
                WHERE Machine = ? AND ProdDate <= ? AND ProdDate > date(?, '-30 days')
            `;
            const stats = await new Promise((resolve, reject) => db.get(rollingQuery, [machine, date, date], (err, row) => err ? reject(err) : resolve(row)));

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
                await new Promise((resolve, reject) => db.run(upsertQuery, [date, machine, rollingMtbf, rollingMttr], (err) => err ? reject(err) : resolve()));
            }
        }
    }
}


module.exports = { runDailyUpdate, updateMachineDay };
