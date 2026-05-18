const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const port = 3001;

app.use(bodyParser.json());

const dbPath = path.join(__dirname, 'target_database.db');
const db = new sqlite3.Database(dbPath);

// Performance Optimizations
db.serialize(() => {
    db.run("PRAGMA journal_mode=WAL");
    db.run("PRAGMA synchronous=NORMAL");
});

const insertStmt = db.prepare(`INSERT INTO ReceivedData (SourceTimestamp, LocalTimestamp, TypeOfProduct, Qty, Source) VALUES (?, ?, ?, ?, ?)`);

const productMapping = {
    "1": "60PA", "2": "60PB", "3": "50PA", "4": "50PB", "5": "30PA", "6": "30PB",
    "10": "60P", "20": "50P", "30": "30P",
    "901": "REJ-60PA", "902": "REJ-60PB", "903": "REJ-50PA", "904": "REJ-50PB", "905": "REJ-30PA", "906": "REJ-30PB"
};

function getProductLabel(code) {
    return productMapping[code] || `Unknown (${code})`;
}

const colorPalette = {
    // 60P - Green Tones
    "60P": "rgba(46, 125, 50, 0.7)",   // Dark Green
    "60PA": "rgba(76, 175, 80, 0.7)",  // Green
    "60PB": "rgba(129, 199, 132, 0.7)", // Light Green
    // 50P - Blue Tones
    "50P": "rgba(21, 101, 192, 0.7)",   // Dark Blue
    "50PA": "rgba(33, 150, 243, 0.7)",  // Blue
    "50PB": "rgba(100, 181, 246, 0.7)", // Light Blue
    // 30P - Purple Tones
    "30P": "rgba(106, 27, 154, 0.7)",   // Dark Purple
    "30PA": "rgba(156, 39, 176, 0.7)",  // Purple
    "30PB": "rgba(186, 104, 200, 0.7)", // Light Purple
    // Default
    "Other": "rgba(158, 158, 158, 0.7)"
};

function getProductColor(label) {
    if (label.includes("60P")) return colorPalette[label] || colorPalette["60P"];
    if (label.includes("50P")) return colorPalette[label] || colorPalette["50P"];
    if (label.includes("30P")) return colorPalette[label] || colorPalette["30P"];
    return colorPalette["Other"];
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
        // Maps for consolidation
        const packerMap = new Map();
        const formingMap = new Map();
        const closerMap = new Map();
        const palletizerMap = new Map();

        rows.forEach(row => {
            const typeCode = Number(row.TypeOfProduct);
            const isReject = typeCode >= 900;
            const baseType = isReject ? (typeCode - 900) : typeCode;
            const label = getProductLabel(baseType);
            const fullLabel = getProductLabel(row.TypeOfProduct);

            if (row.Source.startsWith('CasePacker')) {
                const key = `${row.Source}-${row.TypeOfProduct}`;
                if (!packerMap.has(key)) {
                    packerMap.set(key, { 
                        source: row.Source, 
                        product: fullLabel, 
                        typeCode: typeCode,
                        rowCount: 0, 
                        totalQty: 0 
                    });
                }
                const entry = packerMap.get(key);
                entry.rowCount += row.RowCount;
                entry.totalQty += row.TotalQty;
            } else if (row.Source === 'CaseForming') {
                const key = `${row.Source}-${row.TypeOfProduct}`;
                if (!formingMap.has(key)) {
                    formingMap.set(key, { source: row.Source, product: fullLabel, rowCount: 0 });
                }
                const entry = formingMap.get(key);
                entry.rowCount += row.RowCount;
            } else if (row.Source === 'CapCloser') {
                if (isReject) summary.closer.reject += row.RowCount;
                else summary.closer.good += row.RowCount;

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

                const key = row.TypeOfProduct;
                if (!palletizerMap.has(key)) {
                    palletizerMap.set(key, { product: fullLabel, rowCount: 0, capacity: 0 });
                }
                const entry = palletizerMap.get(key);
                entry.rowCount += row.RowCount;
                entry.capacity += rowCapacity;
            }
        });

        summary.packers = Array.from(packerMap.values()).map(entry => {
            let expectedPerBox = 0;
            if (entry.typeCode === 1 || entry.typeCode === 2) expectedPerBox = 51;
            else if (entry.typeCode >= 3 && entry.typeCode <= 6) expectedPerBox = 49;
            
            const expectedInfeed = entry.rowCount * expectedPerBox;
            return {
                source: entry.source,
                product: entry.product,
                rowCount: entry.rowCount,
                totalQty: entry.totalQty,
                expectedInfeed: expectedInfeed,
                diff: entry.totalQty - expectedInfeed
            };
        }).sort((a, b) => a.source.localeCompare(b.source) || a.product.localeCompare(b.product));
        summary.forming = Array.from(formingMap.values()).sort((a, b) => a.product.localeCompare(b.product));
        summary.closer.details = Array.from(closerMap.values()).sort((a, b) => a.product.localeCompare(b.product));
        summary.palletizer.details = Array.from(palletizerMap.values()).sort((a, b) => a.product.localeCompare(b.product));
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

// Chart API
app.get('/api/chart', (req, res) => {
    const { from, to } = req.query;
    let query = `
        SELECT 
            Source,
            TypeOfProduct, 
            date(SourceTimestamp, '+1 hour') as ProdDate, 
            COUNT(*) as RowCount
        FROM ReceivedData 
        WHERE Source LIKE 'CasePacker%'
    `;
    const params = [];

    if (from && to) {
        query += ` AND date(SourceTimestamp, '+1 hour') BETWEEN ? AND ? `;
        params.push(from, to);
    }

    query += ` GROUP BY ProdDate, Source, TypeOfProduct ORDER BY ProdDate ASC, Source ASC`;

    db.all(query, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        // Organize data for Chart.js
        const dates = [...new Set(rows.map(r => r.ProdDate))];
        const productTypes = [...new Set(rows.map(r => getProductLabel(r.TypeOfProduct)))];
        const machines = [...new Set(rows.map(r => r.Source))];

        // We want a dataset for each (Machine + Product) combination
        const datasets = [];

        machines.forEach(machine => {
            productTypes.forEach(product => {
                const data = dates.map(date => {
                    const row = rows.find(r => r.ProdDate === date && r.Source === machine && getProductLabel(r.TypeOfProduct) === product);
                    return row ? row.RowCount : 0;
                });

                if (data.some(v => v > 0)) {
                    datasets.push({
                        label: `${machine} - ${product}`,
                        data: data,
                        backgroundColor: getProductColor(product),
                        stack: machine // This stacks by machine per day
                    });
                }
            });
        });

        res.json({ labels: dates, datasets });
    });
});

app.get('/api/chart-forming', (req, res) => {
    const { from, to } = req.query;
    let query = `
        SELECT 
            Source,
            TypeOfProduct, 
            date(SourceTimestamp, '+1 hour') as ProdDate, 
            COUNT(*) as RowCount
        FROM ReceivedData 
        WHERE Source = 'CaseForming'
    `;
    const params = [];

    if (from && to) {
        query += ` AND date(SourceTimestamp, '+1 hour') BETWEEN ? AND ? `;
        params.push(from, to);
    }

    query += ` GROUP BY ProdDate, Source, TypeOfProduct ORDER BY ProdDate ASC, Source ASC`;

    db.all(query, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        const dates = [...new Set(rows.map(r => r.ProdDate))];
        const productTypes = [...new Set(rows.map(r => getProductLabel(r.TypeOfProduct)))];
        const machines = [...new Set(rows.map(r => r.Source))];

        const datasets = [];

        machines.forEach(machine => {
            productTypes.forEach(product => {
                const data = dates.map(date => {
                    const row = rows.find(r => r.ProdDate === date && r.Source === machine && getProductLabel(r.TypeOfProduct) === product);
                    return row ? row.RowCount : 0;
                });

                if (data.some(v => v > 0)) {
                    datasets.push({
                        label: product,
                        data: data,
                        backgroundColor: getProductColor(product)
                    });
                }
            });
        });

        res.json({ labels: dates, datasets });
    });
});

app.get('/api/chart-closer', (req, res) => {
    const { from, to } = req.query;
    let query = `
        SELECT 
            TypeOfProduct, 
            date(SourceTimestamp, '+1 hour') as ProdDate, 
            COUNT(*) as RowCount
        FROM ReceivedData 
        WHERE Source = 'CapCloser'
    `;
    const params = [];

    if (from && to) {
        query += ` AND date(SourceTimestamp, '+1 hour') BETWEEN ? AND ? `;
        params.push(from, to);
    }

    query += ` GROUP BY ProdDate, TypeOfProduct ORDER BY ProdDate ASC`;

    db.all(query, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        const dates = [...new Set(rows.map(r => r.ProdDate))];
        const typeCodes = [...new Set(rows.map(r => r.TypeOfProduct))];
        
        // Extract base types (without reject code 900+)
        const baseTypes = [...new Set(typeCodes.map(c => {
            const code = Number(c);
            return code >= 900 ? (code - 900).toString() : c;
        }))];

        const datasets = [];
        const rejectColor = "rgba(229, 57, 53, 0.8)"; // Consistent Red for Rejects

        baseTypes.forEach(baseCode => {
            const label = getProductLabel(baseCode);
            const rejectCode = (Number(baseCode) + 900).toString();

            // Good Dataset
            const goodData = dates.map(date => {
                const row = rows.find(r => r.ProdDate === date && r.TypeOfProduct === baseCode);
                return row ? row.RowCount : 0;
            });

            // Reject Dataset
            const rejectData = dates.map(date => {
                const row = rows.find(r => r.ProdDate === date && r.TypeOfProduct === rejectCode);
                return row ? row.RowCount : 0;
            });

            if (goodData.some(v => v > 0) || rejectData.some(v => v > 0)) {
                // Add Good dataset
                datasets.push({
                    label: `${label} (Good)`,
                    data: goodData,
                    backgroundColor: getProductColor(label),
                    stack: label
                });
                // Add Reject dataset
                datasets.push({
                    label: `${label} (Reject)`,
                    data: rejectData,
                    backgroundColor: rejectColor,
                    stack: label
                });
            }
        });

        res.json({ labels: dates, datasets });
    });
});

app.get('/api/chart-palletizer', (req, res) => {
    const { from, to } = req.query;
    let query = `
        SELECT 
            TypeOfProduct, 
            date(SourceTimestamp, '+1 hour') as ProdDate, 
            COUNT(*) as PalletCount
        FROM ReceivedData 
        WHERE Source = 'Palletizer'
    `;
    const params = [];

    if (from && to) {
        query += ` AND date(SourceTimestamp, '+1 hour') BETWEEN ? AND ? `;
        params.push(from, to);
    }

    query += ` GROUP BY ProdDate, TypeOfProduct ORDER BY ProdDate ASC`;

    db.all(query, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        const dates = [...new Set(rows.map(r => r.ProdDate))];
        const productTypes = [...new Set(rows.map(r => r.TypeOfProduct))];

        const datasets = [];

        productTypes.forEach(typeCode => {
            const label = getProductLabel(typeCode);
            const capacityPerPallet = (typeCode === "1" || typeCode === "2") ? 8 : 6;

            const data = dates.map(date => {
                const row = rows.find(r => r.ProdDate === date && r.TypeOfProduct === typeCode);
                return row ? (row.PalletCount * capacityPerPallet) : 0;
            });

            const palletCounts = dates.map(date => {
                const row = rows.find(r => r.ProdDate === date && r.TypeOfProduct === typeCode);
                return row ? row.PalletCount : 0;
            });

            if (data.some(v => v > 0)) {
                datasets.push({
                    label: label,
                    data: data,
                    palletCounts: palletCounts, // Extra data for tooltips/labels
                    backgroundColor: getProductColor(label)
                });
            }
        });

        res.json({ labels: dates, datasets });
    });
});

app.listen(port, () => {
    console.log(`Target server listening at http://localhost:${port}`);
});
