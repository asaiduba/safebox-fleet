const Database = require('better-sqlite3');
const db = new Database('database.sqlite');

try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS vehicle_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vehicle_id TEXT,
            timestamp INTEGER,
            speed REAL,
            battery_level INTEGER,
            fuel_level INTEGER,
            lat REAL,
            lng REAL,
            FOREIGN KEY(vehicle_id) REFERENCES vehicles(id)
        )
    `);
    console.log("Migration successful: Created vehicle_history table.");
} catch (err) {
    console.error("Migration failed:", err);
}
