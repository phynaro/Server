const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, 'target_database.db');
const db = new sqlite3.Database(dbPath);

console.log('Checking for recent KPI updates...');

db.all("SELECT ProdDate, Machine, Oee FROM DailyKpiSummary ORDER BY ProdDate DESC, Machine ASC LIMIT 10", [], (err, rows) => {
    if (err) {
        console.error('Error querying DailyKpiSummary:', err.message);
    } else {
        console.log('Recent entries in DailyKpiSummary:');
        console.table(rows);
    }
    
    db.all("SELECT Date, Machine, RollingMtbf FROM ReliabilityHistory ORDER BY Date DESC LIMIT 5", [], (err, rows) => {
        if (err) {
            console.error('Error querying ReliabilityHistory:', err.message);
        } else {
            console.log('Recent entries in ReliabilityHistory:');
            console.table(rows);
        }
        db.close();
    });
});
