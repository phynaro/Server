const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('target_database.db');

const source = 'CaseForming';
const startSQL = '2026-05-19T23:00:00';

db.all("SELECT SourceTimestamp, StateCode, ReasonCode FROM ReceivedOEE WHERE Source = ? AND SourceTimestamp >= ? AND StateCode = 5 ORDER BY SourceTimestamp ASC LIMIT 10", [source, startSQL], (err, rows) => {
    if (err) console.error(err);
    console.log(rows);
    db.close();
});
