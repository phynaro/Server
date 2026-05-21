const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, 'target_database.db');
const db = new sqlite3.Database(dbPath);

const query = "UPDATE ReceivedOEE SET ReasonCode = 306 WHERE ReasonCode = 300 AND Source = 'CaseForming'";

db.run(query, function(err) {
    if (err) {
        console.error('Error updating ReasonCode:', err.message);
    } else {
        console.log(`Success! Updated ${this.changes} records for CaseForming (ReasonCode 300 -> 306).`);
    }
    db.close();
});
