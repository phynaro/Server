const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'target_database.db');
const db = new sqlite3.Database(dbPath);

const query = "SELECT * FROM ReceivedData WHERE Qty > 53 AND Source LIKE 'CasePacker%'";

db.all(query, (err, rows) => {
    if (err) {
        console.error('Error querying database:', err.message);
        process.exit(1);
    }
    console.log(JSON.stringify(rows, null, 2));
    db.close();
});
