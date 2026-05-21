const oeeHelper = require('./oee_helper.js');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('target_database.db');

const source = 'CaseForming';
const startSQL = '2026-05-19T23:00:00';

db.all("SELECT SourceTimestamp, StateCode, ReasonCode FROM ReceivedOEE WHERE Source = ? AND SourceTimestamp >= ? ORDER BY SourceTimestamp ASC", [source, startSQL], (err, rows) => {
    if (err) console.error(err);
    
    const mappedRows = rows.map(r => ({
        ...r,
        LocalTimestamp: new Date(new Date(r.SourceTimestamp + 'Z').getTime() + (7 * 3600000)).toISOString().replace('Z', '').replace('T', ' ')
    }));

    const results = oeeHelper.calculateStateDurations(mappedRows, false, 10.0, 0, 0);
    
    const faultDurations = results.timeline
        .filter(t => t.stateLabel === 'Faulted')
        .map(t => t.duration);
    
    const shortFaults = faultDurations.filter(d => d < 5);
    console.log('Total Fault Events:', faultDurations.length);
    console.log('Short Faults (< 5s):', shortFaults.length);
    console.log('Long Faults (>= 5s):', faultDurations.length - shortFaults.length);
    console.log('Average Fault Duration:', (faultDurations.reduce((a, b) => a + b, 0) / faultDurations.length).toFixed(1), 's');
    
    db.close();
});
