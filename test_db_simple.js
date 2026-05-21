const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, 'target_database.db');

console.log('Testing DB connection to:', dbPath);
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Connection error:', err);
        process.exit(1);
    }
    console.log('Connected.');
    db.get('SELECT 1', (err, row) => {
        if (err) {
            console.error('Query error:', err);
            process.exit(1);
        }
        console.log('Query success:', row);
        db.close();
    });
});
