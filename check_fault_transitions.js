const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('target_database.db');

const source = 'CaseForming';
const startSQL = '2026-05-19T23:00:00';

db.all("SELECT SourceTimestamp, StateCode, ReasonCode FROM ReceivedOEE WHERE Source = ? AND SourceTimestamp >= ? ORDER BY SourceTimestamp ASC", [source, startSQL], (err, rows) => {
    if (err) console.error(err);
    
    const filtered = rows.filter(r => r.StateCode !== 0);
    
    let faults = 0;
    let transitionsToFault = 0;
    let lastState = null;
    
    for (const row of filtered) {
        if (row.StateCode === 5) {
            faults++;
            if (lastState !== 5) {
                transitionsToFault++;
            }
        }
        lastState = row.StateCode;
    }
    
    console.log('Total State 5 records (excluding State 0):', faults);
    console.log('Transitions to State 5:', transitionsToFault);
    db.close();
});
