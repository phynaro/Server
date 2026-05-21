const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('target_database.db');

const source = 'CaseForming';

db.all("SELECT Date, RollingMtbf FROM ReliabilityHistory WHERE Machine = ? ORDER BY Date DESC LIMIT 10", [source], (err, rows) => {
    if (err) console.error(err);
    console.log(rows);
    db.close();
});
