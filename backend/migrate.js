const Database = require('better-sqlite3');
const db = new Database('database.sqlite');

console.log('Attempting to add battery_level column...');

try {
    db.exec('ALTER TABLE vehicles ADD COLUMN battery_level INTEGER DEFAULT 100');
    console.log('Migration successful: Added battery_level column.');
} catch (err) {
    if (err.message.includes('duplicate column name')) {
        console.log('Column already exists.');
    } else {
        console.error('Migration failed:', err);
    }
}
