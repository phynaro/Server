const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const port = 3001;

app.use(bodyParser.json());

const dbPath = path.join(__dirname, 'target_database.db');
const db = new sqlite3.Database(dbPath);

const productMapping = {
    "1": "60PA", "2": "60PB", "3": "50PA", "4": "50PB", "5": "30PA", "6": "30PB",
    "10": "60P", "20": "50P", "30": "30P",
    "901": "REJ-60PA", "902": "REJ-60PB", "903": "REJ-50PA", "904": "REJ-50PB", "905": "REJ-30PA", "906": "REJ-30PB"
};

function getProductLabel(code) {
    return productMapping[code] || `Unknown (${code})`;
}

db.serialize(() => {
    // 1. Create table with Source column
    db.run(`CREATE TABLE IF NOT EXISTS ReceivedData (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        SourceTimestamp TEXT,
        LocalTimestamp TEXT,
        TypeOfProduct TEXT,
        Qty INTEGER,
        Source TEXT,
        ServerReceivedTimestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (!err) {
            // 2. Migration: Add Source column if it doesn't exist (in case table already existed without it)
            db.run("ALTER TABLE ReceivedData ADD COLUMN Source TEXT", (err) => {
                // If it fails, column likely exists. Update null sources.
                db.run("UPDATE ReceivedData SET Source = 'CasePacker1' WHERE Source IS NULL");
                console.log('Database schema checked and migrated.');
            });
        }
    });
});

app.post('/api/data', (req, res) => {
    const { Timestamp, LocalTimestamp, TypeOfProduct, Qty, Source } = req.body;
    
    console.log('Received data:', req.body);

    const stmt = db.prepare(`INSERT INTO ReceivedData (SourceTimestamp, LocalTimestamp, TypeOfProduct, Qty, Source) VALUES (?, ?, ?, ?, ?)`);
    stmt.run(Timestamp, LocalTimestamp, TypeOfProduct, Qty, Source || 'CasePacker1', function(err) {
        if (err) {
            console.error('Error inserting data:', err.message);
            return res.status(500).json({ error: err.message });
        }
        res.status(200).json({ message: 'Data received and stored', id: this.lastID });
    });
    stmt.finalize();
});

app.use(express.static(path.join(__dirname, 'public')));

// Summary API with Production Day Logic (6AM to 6AM)
app.get('/api/summary', (req, res) => {
    const { from, to } = req.query;
    let query = `
        SELECT 
            Source,
            TypeOfProduct, 
            date(SourceTimestamp, '+1 hour') as ProdDate, 
            COUNT(*) as RowCount,
            SUM(Qty) as TotalQty
        FROM ReceivedData 
    `;
    const params = [];

    if (from && to) {
        query += ` WHERE date(SourceTimestamp, '+1 hour') BETWEEN ? AND ? `;
        params.push(from, to);
    }

    query += ` GROUP BY Source, TypeOfProduct, date(SourceTimestamp, '+1 hour') ORDER BY ProdDate DESC, Source ASC`;

    db.all(query, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        // Process data into station-specific buckets
        const summary = {
            packers: [],
            forming: [],
            closer: { good: 0, reject: 0, details: [] },
            palletizer: { totalPallets: 0, totalCapacity: 0, details: [] }
        };
// Process data into station-specific buckets
const closerMap = new Map(); // For grouping Good/Reject by base product

rows.forEach(row => {
    const typeCode = Number(row.TypeOfProduct);
    const isReject = typeCode >= 900;
    const baseType = isReject ? (typeCode - 900) : typeCode;
    const label = getProductLabel(baseType);

    const data = {
        date: row.ProdDate,
        source: row.Source,
        product: getProductLabel(row.TypeOfProduct), // Full label for others
        rowCount: row.RowCount,
        totalQty: row.TotalQty
    };

    if (row.Source.startsWith('CasePacker')) {
        summary.packers.push(data);
    } else if (row.Source === 'CaseForming') {
        summary.forming.push(data);
    } else if (row.Source === 'CapCloser') {
        if (isReject) summary.closer.reject += row.RowCount;
        else summary.closer.good += row.RowCount;

        // Grouping logic for the table
        if (!closerMap.has(baseType)) {
            closerMap.set(baseType, { product: label, good: 0, reject: 0 });
        }
        const entry = closerMap.get(baseType);
        if (isReject) entry.reject += row.RowCount;
        else entry.good += row.RowCount;
    } else if (row.Source === 'Palletizer') {
        // Pallet Capacity Logic: Type 1,2 = 8 boxes, others = 6 boxes
        const capacityPerPallet = (typeCode === 1 || typeCode === 2) ? 8 : 6;
        const rowCapacity = row.RowCount * capacityPerPallet;
        
        summary.palletizer.totalPallets += row.RowCount;
        summary.palletizer.totalCapacity += rowCapacity;
        summary.palletizer.details.push({
            ...data,
            capacity: rowCapacity
        });
    }
});

        summary.closer.details = Array.from(closerMap.values());
        res.json(summary);
    });
});

// Raw Data API with filtering
app.get('/api/raw', (req, res) => {
    const { from, to } = req.query;
    let query = `SELECT *, datetime(SourceTimestamp, '+7 hours') as LocalDateTime FROM ReceivedData`;
    const params = [];

    if (from && to) {
        // Raw filter using the same Production Day logic for consistency
        query += ` WHERE date(SourceTimestamp, '+1 hour') BETWEEN ? AND ? `;
        params.push(from, to);
    }
    query += ` ORDER BY SourceTimestamp DESC LIMIT 100`;

    db.all(query, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        const mappedRows = rows.map(row => ({
            ...row,
            TypeOfProduct: getProductLabel(row.TypeOfProduct)
        }));
        res.json(mappedRows);
    });
});

app.listen(port, () => {
    console.log(`Target server listening at http://localhost:${port}`);
});
