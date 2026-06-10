const Database = require('better-sqlite3');
const db = new Database('./database.sqlite');

// Check if SAFEBOX_002 exists
const v = db.prepare("SELECT * FROM vehicles WHERE id = 'SAFEBOX_002'").get();
if (v) {
  console.log('FOUND:', JSON.stringify(v, null, 2));
} else {
  console.log('NOT FOUND — inserting...');
  db.prepare("INSERT OR IGNORE INTO vehicles (id, name, owner_id, is_locked) VALUES ('SAFEBOX_002', 'STM32 SafeBox', 1, 1)").run();
  const inserted = db.prepare("SELECT * FROM vehicles WHERE id = 'SAFEBOX_002'").get();
  console.log('Inserted:', JSON.stringify(inserted, null, 2));
}
