const Database = require('better-sqlite3');
const path = require('path');

const db = new Database('database.sqlite');

function initDb() {
    // Create Users Table with extra fields
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT CHECK(role IN ('individual', 'company')) NOT NULL,
            company_name TEXT,
            email TEXT,
            phone TEXT
        )
    `);

    // Create Vehicles Table
    db.exec(`
        CREATE TABLE IF NOT EXISTS vehicles (
            id TEXT PRIMARY KEY,
            name TEXT,
            owner_id INTEGER,
            is_locked INTEGER DEFAULT 1,
            last_seen INTEGER,
            battery_level INTEGER DEFAULT 100,
            fuel_level INTEGER DEFAULT 100,
            FOREIGN KEY(owner_id) REFERENCES users(id)
        )
    `);

    // Create Vehicle History Table for Analytics
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

    // Create Geofences Table
    db.exec(`
        CREATE TABLE IF NOT EXISTS geofences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vehicle_id TEXT,
            lat REAL,
            lng REAL,
            radius REAL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
        )
    `);

    // Create Index for Performance
    db.exec(`CREATE INDEX IF NOT EXISTS idx_history_vehicle_time ON vehicle_history(vehicle_id, timestamp DESC)`);

    console.log('Database initialized');
}

module.exports = { db, initDb };
