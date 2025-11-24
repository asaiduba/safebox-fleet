const Database = require('better-sqlite3');
const db = new Database('database.sqlite');

try {
    db.exec("ALTER TABLE vehicles ADD COLUMN fuel_level INTEGER DEFAULT 100");
    console.log("Migration successful: Added fuel_level column.");
} catch (err) {
    if (err.message.includes("duplicate column name")) {
        console.log("Migration skipped: Column already exists.");
    } else {
        console.error("Migration failed:", err);
    }
}
