const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'target_database.db');

console.log('--- Database Cleanup Tool ---');

if (!fs.existsSync(dbPath)) {
    console.log('Database file does not exist. Nothing to clean.');
    process.exit(0);
}

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    console.log('Deleting all records from ReceivedData...');
    
    db.run("DELETE FROM ReceivedData", function(err) {
        if (err) {
            console.error('Error cleaning database:', err.message);
        } else {
            console.log(`Success! Deleted ${this.changes} records.`);
            
            // Optional: Vacuum to shrink file size
            db.run("VACUUM", (err) => {
                if (err) console.error('Error during VACUUM:', err.message);
                else console.log('Database file defragmented (VACUUM).');
                
                db.close();
                console.log('Done.');
            });
        }
    });
});
