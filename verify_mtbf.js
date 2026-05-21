const oeeHelper = require('./oee_helper.js');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('target_database.db');

const source = 'CaseForming';
const startSQL = '2026-05-19T23:00:00'; // Shift starts at 6AM Local, which is 23:00 UTC previous day (assuming +7 offset)

db.all("SELECT SourceTimestamp, StateCode, ReasonCode FROM ReceivedOEE WHERE Source = ? AND SourceTimestamp >= ? ORDER BY SourceTimestamp ASC", [source, startSQL], (err, rows) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    
    // Mimic server.js logic for timestamps
    // We need LocalTimestamp which is what oeeHelper uses
    const mappedRows = rows.map(r => ({
        ...r,
        LocalTimestamp: new Date(new Date(r.SourceTimestamp + 'Z').getTime() + (7 * 3600000)).toISOString().replace('Z', '').replace('T', ' ')
    }));

    const faultReasons = {};
    rows.filter(r => r.StateCode === 5).forEach(r => {
        faultReasons[r.ReasonCode] = (faultReasons[r.ReasonCode] || 0) + 1;
    });
    console.log('Fault Reasons Frequency:', faultReasons);

    const results = oeeHelper.calculateStateDurations(mappedRows, false, 10.0, 0, 0);
    console.log('MTBF (sec):', results.kpis.mtbf);
    console.log('MTBF (formatted):', results.kpis.mtbf ? (results.kpis.mtbf / 60).toFixed(1) + 'm' : 'N/A');
    console.log('Total Failures:', results.kpis.totalFailures);
    console.log('Tech Uptime (sec):', results.totalDuration - (results.summary.find(s => s.stateLabel === 'Planned Stop')?.duration || 0) - (results.summary.find(s => s.stateLabel === 'Faulted')?.duration || 0));
    // Actually techUptime in oee_helper is (runTime + starvedTime + blockedTime)
    
    console.log('Summary:', JSON.stringify(results.summary, null, 2));

    console.log('Top Losses:', JSON.stringify(results.topLosses, null, 2));

    db.close();
});
