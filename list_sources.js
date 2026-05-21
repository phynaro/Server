const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('target_database.db');

db.all("SELECT DISTINCT Source FROM ReceivedOEE", [], (err, rows) => {
    if (err) console.error(err);
    console.log(rows);
    db.close();
});
