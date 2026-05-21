const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('target_database.db');

db.all("SELECT sql FROM sqlite_master WHERE type='table'", [], (err, rows) => {
    if (err) console.error(err);
    rows.forEach(r => console.log(r.sql));
    db.close();
});
