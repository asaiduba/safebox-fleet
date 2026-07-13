const { db, initDb } = require('../db');
const assert = require('assert');

console.log('🧪 Starting SafeBox Fleet E2E Verification Tests...');

try {
    // Run DB migrations
    initDb();
    // 1. Verify Vehicles Table Schema
    console.log('⏳ Verifying vehicles schema...');
    const vehicleInfo = db.prepare('PRAGMA table_info(vehicles)').all();
    const columns = vehicleInfo.map(c => c.name);

    assert.ok(columns.includes('id'), 'vehicles table should have id');
    assert.ok(columns.includes('name'), 'vehicles table should have name');
    assert.ok(columns.includes('cloud_locked'), 'vehicles table should have cloud_locked column for cloud control');
    assert.ok(columns.includes('is_locked'), 'vehicles table should have is_locked column');
    assert.ok(columns.includes('group_id'), 'vehicles table should have group_id column');
    assert.ok(columns.includes('ble_beacon_id'), 'vehicles table should have ble_beacon_id');
    assert.ok(columns.includes('ble_beacon_rssi_threshold'), 'vehicles table should have ble_beacon_rssi_threshold');
    console.log('✅ Vehicles table schema verified.');

    // 2. Verify Geofences Table Schema
    console.log('⏳ Verifying geofences schema...');
    const geofenceInfo = db.prepare('PRAGMA table_info(geofences)').all();
    const geofenceCols = geofenceInfo.map(c => c.name);

    assert.ok(geofenceCols.includes('vehicle_id'), 'geofences table should have vehicle_id');
    assert.ok(geofenceCols.includes('coordinates'), 'geofences table should have coordinates for polygon modes');
    assert.ok(geofenceCols.includes('type'), 'geofences table should have type (circle/polygon)');
    console.log('✅ Geofences table schema verified.');

    // 3. Verify Fuel Settings Table Schema
    console.log('⏳ Verifying fuel_settings schema...');
    const fuelInfo = db.prepare('PRAGMA table_info(fuel_settings)').all();
    const fuelCols = fuelInfo.map(c => c.name);

    assert.ok(fuelCols.includes('vehicle_id'), 'fuel_settings table should have vehicle_id');
    assert.ok(fuelCols.includes('fuel_type'), 'fuel_settings table should have fuel_type');
    assert.ok(fuelCols.includes('fuel_price'), 'fuel_settings table should have fuel_price');
    assert.ok(fuelCols.includes('fuel_efficiency'), 'fuel_settings table should have fuel_efficiency');
    console.log('✅ Fuel settings table schema verified.');

    // 3b. Verify Devices Table Schema
    console.log('⏳ Verifying devices schema...');
    const devicesInfo = db.prepare('PRAGMA table_info(devices)').all();
    const devicesCols = devicesInfo.map(c => c.name);

    assert.ok(devicesCols.includes('id'), 'devices table should have id');
    assert.ok(devicesCols.includes('vehicle_id'), 'devices table should have vehicle_id');
    assert.ok(devicesCols.includes('imei'), 'devices table should have imei');
    assert.ok(devicesCols.includes('tracker_type'), 'devices table should have tracker_type');
    assert.ok(devicesCols.includes('protocol'), 'devices table should have protocol');
    assert.ok(devicesCols.includes('status'), 'devices table should have status');
    assert.ok(devicesCols.includes('last_seen'), 'devices table should have last_seen');
    console.log('✅ Devices table schema verified.');

    // 4. Verify user authentication retrieval
    console.log('⏳ Verifying user settings lookup query...');
    const dummyUser = db.prepare('SELECT * FROM users LIMIT 1').get();
    if (dummyUser) {
        console.log(`ℹ️ Sample User found: ${dummyUser.username} (${dummyUser.role})`);
        const userVehicles = db.prepare('SELECT * FROM vehicles WHERE owner_id = ?').all(dummyUser.id);
        console.log(`✅ Dummy query: User has ${userVehicles.length} vehicles.`);
    } else {
        console.log('ℹ️ No users in database, skipping dummy lookup.');
    }

    // 5. Verify Report History Insert & Delete
    console.log('⏳ Verifying report history insertion and deletion...');
    const userIdForTest = dummyUser ? dummyUser.id : 1;
    
    // Insert test report
    db.prepare(`
      INSERT INTO report_history (generated_by, generated_at, report_type, file_path, name, period)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userIdForTest, Date.now(), 'Full Fleet Report', '/reports/test.pdf', 'test.pdf', 'Last 7 Days');
    
    // Query it
    const insertedReport = db.prepare('SELECT * FROM report_history WHERE name = ?').get('test.pdf');
    assert.ok(insertedReport, 'report should be inserted successfully');
    assert.strictEqual(insertedReport.generated_by, userIdForTest, 'report owner should match');
    
    // Delete it
    db.prepare('DELETE FROM report_history WHERE report_id = ?').run(insertedReport.report_id);
    const deletedReport = db.prepare('SELECT * FROM report_history WHERE report_id = ?').get(insertedReport.report_id);
    assert.ok(!deletedReport, 'report should be deleted successfully');
    console.log('✅ Report history operations verified.');

    console.log('\n🎉 ALL SCHEMA AND COMPILATION CHECKS PASSED SUCCESSFULLY! 🎉');
    process.exit(0);

} catch (err) {
    console.error('\n❌ E2E VERIFICATION TEST FAILED:', err);
    process.exit(1);
}
