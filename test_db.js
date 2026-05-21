const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('target_database.db');
db.get("SELECT COUNT(*) as count FROM ReceivedOEE WHERE SourceTimestamp LIKE '2026-05-19%'", (err, row) => {
    if (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }
    console.log('Total Rows (2026-05-19):', row.count);
    db.all("SELECT Source, COUNT(*) as count FROM ReceivedOEE WHERE SourceTimestamp LIKE '2026-05-19%' GROUP BY Source", (err, rows) => {
        if (err) console.error(err);
        console.log('Rows by Machine:', rows);
        db.close();
    });
});
