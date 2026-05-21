const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const oeeHelper = require('./oee_helper');
const scheduler = require('./scheduler_helper');

const app = express();
const port = 3001;

app.use(bodyParser.json());

const uploadDir = path.join(__dirname, 'public', 'uploads', 'manual');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, uploadDir),
        filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname).toLowerCase())
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok = ['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(file.originalname).toLowerCase());
        cb(null, ok);
    }
});

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

    // Create ReceivedOEE table for OEE syncs
    db.run(`CREATE TABLE IF NOT EXISTS ReceivedOEE (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        SourceTimestamp TEXT,
        LocalTimestamp TEXT,
        StateCode INTEGER,
        ReasonCode INTEGER,
        Source TEXT,
        ServerReceivedTimestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) {
            console.error('Error creating ReceivedOEE table:', err.message);
        } else {
            console.log('ReceivedOEE table ready.');
        }
    });

    // Create QualityData table for Q metric
    db.run(`CREATE TABLE IF NOT EXISTS QualityData (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        LocalTimestamp TEXT,
        Machine TEXT,
        ProductType TEXT,
        BadCount INTEGER,
        ImagePath TEXT,
        CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) console.error('Error creating QualityData table:', err.message);
        else {
            db.run("ALTER TABLE QualityData ADD COLUMN ImagePath TEXT", () => {});
            console.log('QualityData table ready.');
        }
    });

    // Create CycleTimes table for machine-specific ICT
    db.run(`CREATE TABLE IF NOT EXISTS CycleTimes (
        machine_id TEXT PRIMARY KEY,
        ideal_cycle_time REAL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) console.error('Error creating CycleTimes table:', err.message);
        else console.log('CycleTimes table ready.');
    });

    // Create SourceStatus table for heartbeat tracking
    db.run(`CREATE TABLE IF NOT EXISTS SourceStatus (
        Source TEXT PRIMARY KEY,
        LastSeen DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) console.error('Error creating SourceStatus table:', err.message);
        else console.log('SourceStatus table ready.');
    });

    // Machine-reported quality events with optional fault image
    db.run(`CREATE TABLE IF NOT EXISTS MachineQualityEvents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        LocalTimestamp TEXT NOT NULL,
        Source TEXT NOT NULL,
        TypeOfProduct TEXT,
        IsReject INTEGER DEFAULT 0,
        ImagePath TEXT,
        CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) console.error('Error creating MachineQualityEvents table:', err.message);
        else console.log('MachineQualityEvents table ready.');
    });
});

// Returns the correct shift date (6AM–6AM) for a local timestamp string
function shiftDate(localTimestamp) {
    const ts = localTimestamp.replace('T', ' ');
    const date = ts.slice(0, 10);
    const hour = parseInt(ts.slice(11, 13), 10);
    if (hour < 6) {
        const d = new Date(date + 'T00:00:00');
        d.setDate(d.getDate() - 1);
        return d.toISOString().split('T')[0];
    }
    return date;
}

// Returns the production date of the currently active shift
function currentShiftDate() {
    const nowLocal = new Date(new Date().getTime() + (7 * 3600000));
    if (nowLocal.getUTCHours() < 6) nowLocal.setUTCDate(nowLocal.getUTCDate() - 1);
    return nowLocal.toISOString().split('T')[0];
}

/**
 * Heartbeat Helper
 */
function updateHeartbeat(source, timestamp) {
    if (!source) return;

    let query;
    let params;

    if (timestamp) {
        // Update only if the provided timestamp is newer than what we have
        query = `INSERT INTO SourceStatus (Source, LastSeen) VALUES (?, ?)
                 ON CONFLICT(Source) DO UPDATE SET LastSeen = CASE 
                    WHEN ? > LastSeen THEN ? 
                    ELSE LastSeen 
                 END`;
        params = [source, timestamp, timestamp, timestamp];
    } else {
        // Manual heartbeat uses current server time
        query = `INSERT INTO SourceStatus (Source, LastSeen) VALUES (?, CURRENT_TIMESTAMP)
                 ON CONFLICT(Source) DO UPDATE SET LastSeen = CURRENT_TIMESTAMP`;
        params = [source];
    }

    const stmt = db.prepare(query);
    stmt.run(...params, (err) => {
        if (err) console.error('Error updating heartbeat for ' + source + ':', err.message);
    });
    stmt.finalize();
}

/**
 * Settings / Cycle Time Endpoints
 */
app.get('/api/settings/cycle-times', (req, res) => {
    db.all(`SELECT * FROM CycleTimes`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/settings/cycle-times', (req, res) => {
    const { machine_id, ideal_cycle_time } = req.body;
    if (!machine_id || ideal_cycle_time === undefined) {
        return res.status(400).json({ error: 'Missing machine_id or ideal_cycle_time' });
    }
    const n = parseFloat(ideal_cycle_time);
    if (isNaN(n) || n < 0.5 || n > 600) {
        return res.status(400).json({ error: 'ICT must be between 0.5 and 600 seconds' });
    }
    const stmt = db.prepare(`INSERT INTO CycleTimes (machine_id, ideal_cycle_time, updated_at)
                             VALUES (?, ?, CURRENT_TIMESTAMP)
                             ON CONFLICT(machine_id) DO UPDATE SET
                             ideal_cycle_time = excluded.ideal_cycle_time,
                             updated_at = CURRENT_TIMESTAMP`);
    stmt.run(machine_id, n, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Cycle time saved successfully' });
    });
    stmt.finalize();
});

app.post('/api/settings/cycle-times/bulk', (req, res) => {
    const entries = req.body;
    if (!Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({ error: 'Expected non-empty array' });
    }
    for (const { machine_id, ideal_cycle_time } of entries) {
        if (!machine_id || ideal_cycle_time === undefined) {
            return res.status(400).json({ error: 'Missing fields in entry' });
        }
        const n = parseFloat(ideal_cycle_time);
        if (isNaN(n) || n < 0.5 || n > 600) {
            return res.status(400).json({ error: `ICT for ${machine_id} must be between 0.5 and 600 seconds` });
        }
    }
    const stmt = db.prepare(`INSERT INTO CycleTimes (machine_id, ideal_cycle_time, updated_at)
                             VALUES (?, ?, CURRENT_TIMESTAMP)
                             ON CONFLICT(machine_id) DO UPDATE SET
                             ideal_cycle_time = excluded.ideal_cycle_time,
                             updated_at = CURRENT_TIMESTAMP`);
    let error = null;
    for (const { machine_id, ideal_cycle_time } of entries) {
        stmt.run(machine_id, parseFloat(ideal_cycle_time), function(err) { if (err) error = err; });
    }
    stmt.finalize(err => {
        if (err || error) return res.status(500).json({ error: (err || error).message });
        res.json({ message: `${entries.length} cycle times saved` });
    });
});

/**
 * Quality Data CRUD Endpoints
 */
app.get('/api/quality', (req, res) => {
    const { from, to } = req.query;
    let query = `SELECT * FROM QualityData`;
    const params = [];
    if (from && to) {
        if (from.includes('T') || from.includes(':')) {
            query += ` WHERE datetime(LocalTimestamp) BETWEEN ? AND ? `;
        } else {
            query += ` WHERE date(LocalTimestamp) BETWEEN ? AND ? `;
        }
        params.push(from.replace('T', ' '), to.replace('T', ' '));
    }
    query += ` ORDER BY LocalTimestamp DESC`;
    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/quality', upload.single('image'), (req, res) => {
    const { LocalTimestamp, Machine, ProductType, BadCount } = req.body;
    const imagePath = req.file ? `/uploads/manual/${req.file.filename}` : null;
    const stmt = db.prepare(`INSERT INTO QualityData (LocalTimestamp, Machine, ProductType, BadCount, ImagePath) VALUES (?, ?, ?, ?, ?)`);
    stmt.run(LocalTimestamp, Machine, ProductType, parseInt(BadCount), imagePath, async function(err) {
        if (err) return res.status(500).json({ error: err.message });

        try {
            const prodDate = shiftDate(LocalTimestamp);
            await scheduler.updateMachineDay(db, prodDate, Machine);
        } catch (syncErr) {
            console.error('Error during real-time OEE sync after quality update:', syncErr.message);
        }

        res.status(201).json({ id: this.lastID });
    });
    stmt.finalize();
});
app.put('/api/quality/:id', (req, res) => {
    const { LocalTimestamp, Machine, ProductType, BadCount } = req.body;
    const { id } = req.params;
    const stmt = db.prepare(`UPDATE QualityData SET LocalTimestamp = ?, Machine = ?, ProductType = ?, BadCount = ? WHERE id = ?`);
    stmt.run(LocalTimestamp, Machine, ProductType, BadCount, id, async function(err) {
        if (err) return res.status(500).json({ error: err.message });

        // Real-time Sync
        try {
            const prodDate = shiftDate(LocalTimestamp);
            await scheduler.updateMachineDay(db, prodDate, Machine);
        } catch (syncErr) {
            console.error('Error during real-time OEE sync after quality update:', syncErr.message);
        }

        res.json({ message: 'Updated successfully' });
    });
    stmt.finalize();
});

app.delete('/api/quality/:id', (req, res) => {
    const { id } = req.params;
    // We need to know the date/machine before deleting to sync
    db.get(`SELECT LocalTimestamp, Machine, ImagePath FROM QualityData WHERE id = ?`, [id], (err, row) => {
        if (row) {
            const { LocalTimestamp, Machine, ImagePath } = row;
            db.run(`DELETE FROM QualityData WHERE id = ?`, id, async function(err) {
                if (err) return res.status(500).json({ error: err.message });

                if (ImagePath) {
                    fs.unlink(path.join(__dirname, 'public', ImagePath), () => {});
                }

                try {
                    const prodDate = shiftDate(LocalTimestamp);
                    await scheduler.updateMachineDay(db, prodDate, Machine);
                } catch (syncErr) {
                    console.error('Error during real-time OEE sync after quality deletion:', syncErr.message);
                }

                res.json({ message: 'Deleted successfully' });
            });
        } else {
            res.status(404).json({ error: 'Not found' });
        }
    });
});
app.get('/api/machine-quality-events', (req, res) => {
    const { date, source } = req.query;
    const conditions = [];
    const params = [];

    if (date) {
        conditions.push(`date(LocalTimestamp, '+1 hour') = ?`);
        params.push(date);
    }
    if (source) {
        conditions.push(`Source = ?`);
        params.push(source);
    }
    if (req.query.isReject !== undefined) {
        conditions.push(`IsReject = ?`);
        params.push(parseInt(req.query.isReject));
    }

    const where = conditions.length > 0 ? ` WHERE ` + conditions.join(' AND ') : '';
    db.all(
        `SELECT * FROM MachineQualityEvents${where} ORDER BY LocalTimestamp DESC LIMIT 200`,
        params,
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

app.post('/api/data', (req, res) => {
    const { Timestamp, LocalTimestamp, TypeOfProduct, Qty, Source, ImagePath } = req.body;

    console.log('Received data:', req.body);
    const sourceName = Source || 'CasePacker1';
    updateHeartbeat(sourceName);

    const stmt = db.prepare(`INSERT INTO ReceivedData (SourceTimestamp, LocalTimestamp, TypeOfProduct, Qty, Source) VALUES (?, ?, ?, ?, ?)`);
    stmt.run(Timestamp, LocalTimestamp, TypeOfProduct, Qty, sourceName, function(err) {
        if (err) {
            console.error('Error inserting data:', err.message);
            return res.status(500).json({ error: err.message });
        }

        if (ImagePath) {
            const isReject = parseInt(TypeOfProduct) >= 900 ? 1 : 0;
            db.run(
                `INSERT INTO MachineQualityEvents (LocalTimestamp, Source, TypeOfProduct, IsReject, ImagePath) VALUES (?, ?, ?, ?, ?)`,
                [Timestamp, sourceName, TypeOfProduct, isReject, ImagePath],
                (mqErr) => { if (mqErr) console.error('MachineQualityEvents insert error:', mqErr.message); }
            );
        }

        res.status(200).json({ message: 'Data received and stored', id: this.lastID });
    });
    stmt.finalize();
});

// OEE ingestion endpoint
app.post('/api/oee', (req, res) => {
    const { Timestamp, LocalTimestamp, StateCode, ReasonCode, Source } = req.body;

    if (!Timestamp || (StateCode === undefined || StateCode === null)) {
        return res.status(400).json({ error: 'Missing required fields: Timestamp or StateCode' });
    }

    const sourceName = Source || 'Unknown';
    updateHeartbeat(sourceName, Timestamp);

    const stmtOEE = db.prepare(`INSERT INTO ReceivedOEE (SourceTimestamp, LocalTimestamp, StateCode, ReasonCode, Source) VALUES (?, ?, ?, ?, ?)`);
    stmtOEE.run(Timestamp, LocalTimestamp, StateCode, ReasonCode, sourceName, function(err) {
        if (err) {
            console.error('Error inserting OEE data:', err.message);
            return res.status(500).json({ error: err.message });
        }
        res.status(200).json({ message: 'OEE data received and stored', id: this.lastID });
    });
    stmtOEE.finalize();
});

// OEE bulk ingestion endpoint (handles up to 100 rows for better buffer handling)
app.post('/api/oee/bulk', (req, res) => {
    const data = req.body;

    if (!Array.isArray(data)) {
        return res.status(400).json({ error: 'Payload must be an array of OEE records' });
    }

    if (data.length === 0) {
        return res.status(200).json({ message: 'Empty array received, nothing to store' });
    }

    // Control the limit to 100 rows at a time
    const limit = 100;
    const itemsToProcess = data.slice(0, limit);

    // Filter out invalid records
    const validItems = itemsToProcess.filter(item => item.Timestamp && (item.StateCode !== undefined && item.StateCode !== null));

    if (validItems.length === 0) {
        return res.status(400).json({ error: 'No valid OEE records found in payload (Timestamp and StateCode are required)' });
    }

    // Update heartbeat for all unique sources in this batch using their max timestamp
    const sourceMaxTimestamps = {};
    validItems.forEach(item => {
        const s = item.Source || 'Unknown';
        const t = item.Timestamp;
        if (!sourceMaxTimestamps[s] || t > sourceMaxTimestamps[s]) {
            sourceMaxTimestamps[s] = t;
        }
    });

    Object.entries(sourceMaxTimestamps).forEach(([source, maxT]) => {
        updateHeartbeat(source, maxT);
    });

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        const stmtOEE = db.prepare(`INSERT INTO ReceivedOEE (SourceTimestamp, LocalTimestamp, StateCode, ReasonCode, Source) VALUES (?, ?, ?, ?, ?)`);
        
        validItems.forEach((item) => {
            const { Timestamp, LocalTimestamp, StateCode, ReasonCode, Source } = item;
            const sourceName = Source || 'Unknown';
            stmtOEE.run(Timestamp, LocalTimestamp, StateCode, ReasonCode, sourceName);
        });

        stmtOEE.finalize();
        db.run("COMMIT", (err) => {
            if (err) {
                console.error('Error committing bulk OEE transaction:', err.message);
                // Try to rollback if commit fails
                db.run("ROLLBACK");
                return res.status(500).json({ error: 'Bulk insert failed: ' + err.message });
            }
            res.status(200).json({ 
                message: `Bulk OEE data stored`, 
                count: validItems.length,
                totalReceived: data.length,
                limit: limit
            });
        });
    });
});

/**
 * Status / Heartbeat Endpoints
 */
app.post('/api/heartbeat', (req, res) => {
    const { Source } = req.body;
    if (!Source) return res.status(400).json({ error: 'Source is required' });
    
    updateHeartbeat(Source);
    res.json({ message: 'Heartbeat received' });
});

app.get('/api/status', (req, res) => {
    // Returns seconds since last update for each source
    const query = `
        SELECT 
            Source, 
            LastSeen,
            (strftime('%s', 'now') - strftime('%s', LastSeen)) as SecondsAgo
        FROM SourceStatus
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
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
        WHERE NOT (Source = 'CaseForming' AND TypeOfProduct IN ('0', '1000'))
    `;
    const params = [];

    if (from && to) {
        if (from.includes('T') || from.includes(':')) {
            query += ` AND datetime(SourceTimestamp, '+7 hours') BETWEEN ? AND ? `;
        } else {
            query += ` AND date(SourceTimestamp, '+1 hour') BETWEEN ? AND ? `;
        }
        params.push(from.replace('T', ' '), to.replace('T', ' '));
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
            palletizer: { totalPallets: 0, totalCases: 0, details: [] }
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
                    formingMap.set(key, { source: row.Source, product: fullLabel, rowCount: 0, badCount: 0 });
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
                // Pallet Case Logic: Type 1,2 = 8 cases, others = 6 cases
                const casesPerPallet = (typeCode === 1 || typeCode === 2) ? 8 : 6;
                const rowCases = row.RowCount * casesPerPallet;
                
                summary.palletizer.totalPallets += row.RowCount;
                summary.palletizer.totalCases += rowCases;

                const key = row.TypeOfProduct;
                if (!palletizerMap.has(key)) {
                    palletizerMap.set(key, { product: fullLabel, rowCount: 0, casesCount: 0, ratio: casesPerPallet });
                }
                const entry = palletizerMap.get(key);
                entry.rowCount += row.RowCount;
                entry.casesCount += rowCases;
            }
        });

        summary.packers = Array.from(packerMap.values()).map(entry => {
            let expectedPerBox = 0;
            if (entry.typeCode === 1 || entry.typeCode === 2) expectedPerBox = 51;
            else if (entry.typeCode >= 3 && entry.typeCode <= 6) expectedPerBox = 49;
            
            const expectedCarton = entry.rowCount * expectedPerBox;
            return {
                source: entry.source,
                product: entry.product,
                rowCount: entry.rowCount,
                totalQty: entry.totalQty,
                expectedCarton: expectedCarton,
                diff: entry.totalQty - expectedCarton
            };
        }).sort((a, b) => a.source.localeCompare(b.source) || a.product.localeCompare(b.product));
        summary.forming = Array.from(formingMap.values()).sort((a, b) => a.product.localeCompare(b.product));
        summary.closer.details = Array.from(closerMap.values()).sort((a, b) => a.product.localeCompare(b.product));
        summary.palletizer.details = Array.from(palletizerMap.values()).sort((a, b) => a.product.localeCompare(b.product));

        // Fetch Quality Data for CaseForming (Bad Counts)
        const qualityQuery = `
            SELECT ProductType, SUM(BadCount) as TotalBad
            FROM QualityData
            WHERE Machine = 'CaseForming'
            ${from && to ? (from.includes('T') || from.includes(':') ? 'AND datetime(LocalTimestamp) BETWEEN ? AND ?' : 'AND date(LocalTimestamp) BETWEEN ? AND ?') : ''}
            GROUP BY ProductType
        `;
        const qParams = from && to ? [from.replace('T', ' '), to.replace('T', ' ')] : [];

        db.all(qualityQuery, qParams, (qErr, qRows) => {
            if (!qErr && qRows) {
                qRows.forEach(qRow => {
                    const label = getProductLabel(qRow.ProductType);
                    const key = `CaseForming-${qRow.ProductType}`;
                    if (formingMap.has(key)) {
                        formingMap.get(key).badCount = qRow.TotalBad;
                    } else {
                        // In case there are only bad counts and no good counts
                        formingMap.set(key, { 
                            source: 'CaseForming', 
                            product: label, 
                            rowCount: 0, 
                            badCount: qRow.TotalBad 
                        });
                    }
                });
                // Re-sync forming array from updated map
                summary.forming = Array.from(formingMap.values()).sort((a, b) => a.product.localeCompare(b.product));
            }
            res.json(summary);
        });
    });
});

// Raw Data API with filtering
app.get('/api/raw', (req, res) => {
    const { from, to } = req.query;
    let query = `SELECT *, datetime(SourceTimestamp, '+7 hours') as LocalDateTime FROM ReceivedData`;
    const params = [];

    if (from && to) {
        // Raw filter using the same Production Day logic for consistency
        if (from.includes('T') || from.includes(':')) {
            query += ` WHERE datetime(SourceTimestamp, '+7 hours') BETWEEN ? AND ? `;
        } else {
            query += ` WHERE date(SourceTimestamp, '+1 hour') BETWEEN ? AND ? `;
        }
        params.push(from.replace('T', ' '), to.replace('T', ' '));
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
        if (from.includes('T') || from.includes(':')) {
            query += ` AND datetime(SourceTimestamp, '+7 hours') BETWEEN ? AND ? `;
        } else {
            query += ` AND date(SourceTimestamp, '+1 hour') BETWEEN ? AND ? `;
        }
        params.push(from.replace('T', ' '), to.replace('T', ' '));
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
        WHERE Source = 'CaseForming' AND TypeOfProduct NOT IN ('0', '1000')
    `;
    const params = [];

    if (from && to) {
        if (from.includes('T') || from.includes(':')) {
            query += ` AND datetime(SourceTimestamp, '+7 hours') BETWEEN ? AND ? `;
        } else {
            query += ` AND date(SourceTimestamp, '+1 hour') BETWEEN ? AND ? `;
        }
        params.push(from.replace('T', ' '), to.replace('T', ' '));
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
        if (from.includes('T') || from.includes(':')) {
            query += ` AND datetime(SourceTimestamp, '+7 hours') BETWEEN ? AND ? `;
        } else {
            query += ` AND date(SourceTimestamp, '+1 hour') BETWEEN ? AND ? `;
        }
        params.push(from.replace('T', ' '), to.replace('T', ' '));
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
        if (from.includes('T') || from.includes(':')) {
            query += ` AND datetime(SourceTimestamp, '+7 hours') BETWEEN ? AND ? `;
        } else {
            query += ` AND date(SourceTimestamp, '+1 hour') BETWEEN ? AND ? `;
        }
        params.push(from.replace('T', ' '), to.replace('T', ' '));
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
            const casesPerPallet = (typeCode === "1" || typeCode === "2") ? 8 : 6;

            const data = dates.map(date => {
                const row = rows.find(r => r.ProdDate === date && r.TypeOfProduct === typeCode);
                return row ? (row.PalletCount * casesPerPallet) : 0;
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

/**
 * OEE Availability API
 * Handles 6AM - 6AM shift logic and boundary edge cases.
 */
app.get('/api/oee', (req, res) => {
    const { date, source, idealCycleTime } = req.query; // date: YYYY-MM-DD
    if (!date || !source) return res.status(400).json({ error: 'Missing date or source' });

    // Helper to proceed with calculation
    const proceedWithOEE = (ict) => {
        // Define Boundaries
        // Adjust 'now' to Local Time (+7 Offset) for boundary comparison
        const nowUTC = new Date();
        const now = new Date(nowUTC.getTime() + (7 * 3600000));
        
        const startObj = new Date(date + 'T06:00:00');
        const endObj = new Date(startObj);
        endObj.setDate(endObj.getDate() + 1);

        // If the shift is currently in progress, use "now" as the end boundary
        let effectiveEndObj = endObj;
        if (now > startObj && now < endObj) {
            effectiveEndObj = now;
        }

        const pad = (n) => n.toString().padStart(2, '0');
        const formatDate = (dt) => `${pad(dt.getMonth()+1)}/${pad(dt.getDate())}/${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
        
        const startBoundaryLocal = formatDate(startObj);
        const endBoundaryLocal = formatDate(effectiveEndObj);

        // Use SourceTimestamp for reliable SQL sorting/filtering
        const startSQL = new Date(startObj.getTime() - (7 * 3600000)).toISOString().replace('Z', '');
        const endSQL = new Date(effectiveEndObj.getTime() - (7 * 3600000)).toISOString().replace('Z', '');

        // Local-time boundaries for QualityData (stored in local time, not UTC)
        const toLocalISO = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
        const startLocalStr = toLocalISO(startObj);
        const endLocalStr = toLocalISO(effectiveEndObj);

        // Production Count Mapping
        const prodMapping = {
            'CasePacker1_A': { source: 'CasePacker1', type: '1', rejectType: '901' },
            'CasePacker1_B': { source: 'CasePacker1', type: '2', rejectType: '902' },
            'CasePacker2_A': { source: 'CasePacker2', type: '3', rejectType: '903' },
            'CasePacker2_B': { source: 'CasePacker2', type: '4', rejectType: '904' },
            'CasePacker2_Both': { source: 'CasePacker2', types: ['3', '4'] },
            'CasePacker3_A': { source: 'CasePacker3', type: '5', rejectType: '905' },
            'CasePacker3_B': { source: 'CasePacker3', type: '6', rejectType: '906' },
            'CaseForming': { source: 'CaseForming', types: ['10', '20', '30'] }
        };

        const mapping = prodMapping[source];
        let countQuery = "SELECT COUNT(*) as Count FROM ReceivedData WHERE 1=0"; // Default to 0
        let countParams = [];

        if (mapping) {
            if (mapping.types) {
                countQuery = `SELECT COUNT(*) as Count FROM ReceivedData WHERE Source = ? AND TypeOfProduct IN (${mapping.types.map(()=>'?').join(',')}) AND SourceTimestamp BETWEEN ? AND ?`;
                countParams = [mapping.source, ...mapping.types, startSQL, endSQL];
            } else {
                countQuery = `SELECT COUNT(*) as Count FROM ReceivedData WHERE Source = ? AND TypeOfProduct = ? AND SourceTimestamp BETWEEN ? AND ?`;
                countParams = [mapping.source, mapping.type, startSQL, endSQL];
            }
        }

        db.get(countQuery, countParams, (err, countRow) => {
            const totalCount = countRow ? countRow.Count : 0;
            console.log(`[OEE Debug] Source: ${source}, TotalCount: ${totalCount}, Start: ${startSQL}, End: ${endSQL}, ICT: ${ict}`);

            // Fetch Bad Count for Quality (Q) — use 6AM–6AM shift window, same as production data
            let badCountQuery = "SELECT SUM(BadCount) as TotalBad FROM QualityData WHERE Machine = ? AND datetime(LocalTimestamp) BETWEEN ? AND ?";
            let badCountParams = [source, startLocalStr, endLocalStr];

            if (source === 'CaseForming') {
                badCountQuery = "SELECT SUM(BadCount) as TotalBad FROM QualityData WHERE Machine = 'CaseForming' AND ProductType IN ('10','20','30') AND datetime(LocalTimestamp) BETWEEN ? AND ?";
                badCountParams = [startLocalStr, endLocalStr];
            } else if (mapping) {
                badCountQuery = "SELECT SUM(BadCount) as TotalBad FROM QualityData WHERE Machine = ? AND ProductType = ? AND datetime(LocalTimestamp) BETWEEN ? AND ?";
                badCountParams = [source, mapping.type, startLocalStr, endLocalStr];
            }

            db.get(badCountQuery, badCountParams, (err, badRow) => {
                const manualBad = badRow ? (badRow.TotalBad || 0) : 0;

                function proceedWithBadCount(badCount) {
                    const beforeQuery = `SELECT * FROM ReceivedOEE WHERE Source = ? AND SourceTimestamp < ? ORDER BY SourceTimestamp DESC LIMIT 1`;
                    const rangeQuery = `SELECT * FROM ReceivedOEE WHERE Source = ? AND SourceTimestamp BETWEEN ? AND ? ORDER BY SourceTimestamp ASC`;

                    db.get(beforeQuery, [source, startSQL], (err, beforeRow) => {
                        if (err) return res.status(500).json({ error: err.message });

                        db.all(rangeQuery, [source, startSQL, endSQL], (err, rangeRows) => {
                            if (err) return res.status(500).json({ error: err.message });

                            let finalRows = [];

                            if (beforeRow) {
                                beforeRow.LocalTimestamp = startBoundaryLocal;
                                finalRows.push(beforeRow);
                            } else if (rangeRows.length > 0) {
                                const first = { ...rangeRows[0] };
                                first.LocalTimestamp = startBoundaryLocal;
                                finalRows.push(first);
                            }

                            finalRows = finalRows.concat(rangeRows);

                            if (finalRows.length > 0) {
                                const last = finalRows[finalRows.length - 1];
                                finalRows.push({
                                    ...last,
                                    LocalTimestamp: endBoundaryLocal,
                                    StateCode: last.StateCode
                                });
                            }

                            const results = oeeHelper.calculateStateDurations(finalRows, false, ict, totalCount, badCount);
                            res.json(results);
                        });
                    });
                }

                const rejectType = mapping && mapping.rejectType;
                if (!rejectType) {
                    proceedWithBadCount(manualBad);
                    return;
                }

                db.get(
                    `SELECT COUNT(*) as TotalRejects FROM ReceivedData WHERE Source = 'CapCloser' AND TypeOfProduct = ? AND SourceTimestamp BETWEEN ? AND ?`,
                    [rejectType, startSQL, endSQL],
                    (err, capRow) => {
                        const capBad = capRow ? (capRow.TotalRejects || 0) : 0;
                        console.log(`[Quality] ${source}: manual=${manualBad}, capCloser=${capBad}, total=${manualBad + capBad}`);
                        proceedWithBadCount(manualBad + capBad);
                    }
                );
            });
        });
    };

    if (idealCycleTime) {
        proceedWithOEE(parseFloat(idealCycleTime));
    } else {
        db.get(`SELECT ideal_cycle_time FROM CycleTimes WHERE machine_id = ?`, [source], (err, row) => {
            const ict = row ? row.ideal_cycle_time : 10; // Default to 10 if not found
            proceedWithOEE(ict);
        });
    }
});

app.get('/api/kpi/daily-month', (req, res) => {
    const { source, year, month } = req.query;
    if (!source || !year || !month) return res.status(400).json({ error: 'Missing source, year, or month' });

    const query = `
        SELECT 
            ProdDate as Date,
            Availability, Performance, Quality, Oee,
            TechUptime, FaultTime, FaultCount
        FROM DailyKpiSummary
        WHERE Machine = ? AND strftime('%Y', ProdDate) = ? AND strftime('%m', ProdDate) = ?
        ORDER BY Date ASC
    `;

    db.all(query, [source, year, month.padStart(2, '0')], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/kpi/yearly-heatmap', (req, res) => {
    const { source, year } = req.query;
    if (!source || !year) return res.status(400).json({ error: 'Missing source or year' });

    const query = `
        SELECT ProdDate as Date, Oee
        FROM DailyKpiSummary
        WHERE Machine = ? AND strftime('%Y', ProdDate) = ? AND ProdDate <= ?
        ORDER BY Date ASC
    `;
    db.all(query, [source, year, currentShiftDate()], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/kpi/monthly', (req, res) => {
    const { source, year } = req.query;
    if (!source || !year) return res.status(400).json({ error: 'Missing source or year' });

    const query = `
        SELECT
            strftime('%m', ProdDate) as Month,
            AVG(Oee) as AvgOee,
            AVG(Availability) as AvgAvail,
            AVG(Performance) as AvgPerf,
            AVG(Quality) as AvgQual,
            SUM(TechUptime) / (NULLIF(SUM(FaultCount), 0)) / 60 as MtbfMin,
            SUM(FaultTime) / (NULLIF(SUM(FaultCount), 0)) / 60 as MttrMin,
            SUM(TotalCount) as TotalQty
        FROM DailyKpiSummary
        WHERE Machine = ? AND strftime('%Y', ProdDate) = ? AND ProdDate <= ?
        GROUP BY Month
        ORDER BY Month ASC
    `;

    db.all(query, [source, year, currentShiftDate()], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Calculate YTD
        const ytdQuery = `
            SELECT 
                AVG(Oee) as Oee,
                AVG(Availability) as Avail,
                AVG(Performance) as Perf,
                AVG(Quality) as Qual,
                SUM(TechUptime) / (NULLIF(SUM(FaultCount), 0)) / 60 as Mtbf,
                SUM(TotalCount) as TotalQty
            FROM DailyKpiSummary
            WHERE Machine = ? AND strftime('%Y', ProdDate) = ?
        `;
        
        db.get(ytdQuery, [source, year], (err, ytd) => {
            res.json({ monthly: rows, ytd: ytd });
        });
    });
});

app.get('/api/losses/trends', (req, res) => {
    const { source, days, month, year } = req.query;
    if (!source) return res.status(400).json({ error: 'Missing source' });

    let query;
    let params = [source];

    if (month && year) {
        query = `
            SELECT TopLossesJson 
            FROM DailyKpiSummary 
            WHERE Machine = ? AND strftime('%Y', ProdDate) = ? AND strftime('%m', ProdDate) = ?
        `;
        params.push(year, month.padStart(2, '0'));
    } else {
        query = `
            SELECT TopLossesJson 
            FROM DailyKpiSummary 
            WHERE Machine = ? 
            ORDER BY ProdDate DESC 
            LIMIT ?
        `;
        params.push(parseInt(days || 30));
    }

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const globalLosses = {};
        rows.forEach(row => {
            if (row.TopLossesJson) {
                try {
                    const daily = JSON.parse(row.TopLossesJson);
                    daily.forEach(item => {
                        globalLosses[item.reason] = (globalLosses[item.reason] || 0) + item.duration;
                    });
                } catch (e) { /* skip malformed */ }
            }
        });

        const sorted = Object.keys(globalLosses).map(reason => ({
            reason,
            duration: globalLosses[reason]
        })).sort((a, b) => b.duration - a.duration).slice(0, 10);

        res.json(sorted);
    });
});

app.get('/api/kpi/trends', (req, res) => {
    const { source, days = 30 } = req.query;
    if (!source) return res.status(400).json({ error: 'Missing source' });

    const query = `
        SELECT ProdDate as Date, Availability, Performance, Quality, Oee
        FROM DailyKpiSummary
        WHERE Machine = ? AND ProdDate <= ?
        ORDER BY Date DESC
        LIMIT ?
    `;
    db.all(query, [source, currentShiftDate(), parseInt(days)], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows.reverse()); // Chronological order
    });
});

app.get('/api/reliability/trends', (req, res) => {
    const { source, days, month, year } = req.query;
    if (!source) return res.status(400).json({ error: 'Missing source' });

    if (month && year) {
        // Specific Month Mode
        const query = `
            SELECT 
                ProdDate as Date,
                (TechUptime / NULLIF(FaultCount, 0)) as RollingMtbf,
                (FaultTime / NULLIF(FaultCount, 0)) as RollingMttr
            FROM DailyKpiSummary
            WHERE Machine = ? AND strftime('%Y', ProdDate) = ? AND strftime('%m', ProdDate) = ?
            ORDER BY Date ASC
        `;
        db.all(query, [source, year, month.padStart(2, '0')], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    } else {
        // Rolling Window Mode
        const query = `
            SELECT Date, RollingMtbf, RollingMttr 
            FROM ReliabilityHistory 
            WHERE Machine = ? 
            ORDER BY Date DESC 
            LIMIT ?
        `;
        db.all(query, [source, parseInt(days || 30)], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows.reverse()); // Chronological order
        });
    }
});

app.listen(port, () => {
    console.log(`Target server listening at http://localhost:${port}`);
    
    // Start background scheduler: Run every 30 minutes
    // setInterval(scheduler.runDailyUpdate, 30 * 60 * 1000);
    // Initial run on startup
    // scheduler.runDailyUpdate();
});
