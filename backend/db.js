const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.NODE_ENV === 'production'
    ? '/data/database.sqlite'
    : 'database.sqlite';

const db = new Database(dbPath, { timeout: 7000 });

function initDb() {
    // Migrate users check constraint to support 'admin' role if needed
    try {
        const userTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
        if (userTableSql && !userTableSql.sql.includes("'admin'")) {
            console.log("🛡️ Migrating users table check constraint to support 'admin' role...");
            db.exec("PRAGMA foreign_keys = OFF;");
            try {
                db.transaction(() => {
                    db.exec("ALTER TABLE users RENAME TO users_old");
                    db.exec(`
                        CREATE TABLE users (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            username TEXT UNIQUE NOT NULL,
                            password TEXT NOT NULL,
                            role TEXT CHECK(role IN ('individual', 'company', 'admin')) NOT NULL,
                            company_name TEXT,
                            email TEXT,
                            phone TEXT,
                            plan_id TEXT DEFAULT 'FREE',
                            subscription_status TEXT DEFAULT 'ACTIVE',
                            is_verified INTEGER DEFAULT 1,
                            verification_code TEXT,
                            verification_expires INTEGER,
                            currency TEXT DEFAULT 'NGN'
                        )
                    `);
                    
                    // Get all columns that exist in the old users table dynamically
                    const columnsInfo = db.prepare("PRAGMA table_info(users_old)").all().map(c => c.name);
                    const selectCols = ['id', 'username', 'password', 'role', 'company_name', 'email', 'phone'];
                    if (columnsInfo.includes('plan_id')) selectCols.push('plan_id');
                    if (columnsInfo.includes('subscription_status')) selectCols.push('subscription_status');
                    if (columnsInfo.includes('is_verified')) selectCols.push('is_verified');
                    if (columnsInfo.includes('verification_code')) selectCols.push('verification_code');
                    if (columnsInfo.includes('verification_expires')) selectCols.push('verification_expires');
                    if (columnsInfo.includes('currency')) selectCols.push('currency');

                    const colsStr = selectCols.join(', ');
                    db.exec(`INSERT INTO users (${colsStr}) SELECT ${colsStr} FROM users_old`);
                    db.exec("DROP TABLE users_old");
                })();
                console.log("🛡️ Users table check constraint migrated successfully.");
            } finally {
                db.exec("PRAGMA foreign_keys = ON;");
            }
        }
    } catch (e) {
        console.error("Failed users table migration check:", e.message);
    }

    // 1. Create Users Table
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT CHECK(role IN ('individual', 'company', 'admin')) NOT NULL,
            company_name TEXT,
            email TEXT,
            phone TEXT,
            plan_id TEXT DEFAULT 'FREE',
            subscription_status TEXT DEFAULT 'ACTIVE',
            is_verified INTEGER DEFAULT 1,
            verification_code TEXT,
            verification_expires INTEGER,
            currency TEXT DEFAULT 'NGN'
        )
    `);

    // Schema Migration: Ensure new user columns exist in users table
    try {
        db.exec("ALTER TABLE users ADD COLUMN plan_id TEXT DEFAULT 'FREE'");
    } catch (e) {
        // Column already exists
    }
    try {
        db.exec("ALTER TABLE users ADD COLUMN subscription_status TEXT DEFAULT 'ACTIVE'");
    } catch (e) {
        // Column already exists
    }
    try {
        db.exec("ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 1");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE users ADD COLUMN verification_code TEXT");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE users ADD COLUMN verification_expires INTEGER");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE users ADD COLUMN currency TEXT DEFAULT 'NGN'");
    } catch (e) {}

    // 2. Create Vehicles Table
    db.exec(`
        CREATE TABLE IF NOT EXISTS vehicles (
            id TEXT PRIMARY KEY,
            name TEXT,
            owner_id INTEGER,
            is_locked INTEGER DEFAULT 1,
            cloud_locked INTEGER DEFAULT 1,
            last_seen INTEGER,
            battery_level INTEGER DEFAULT 100,
            fuel_level INTEGER DEFAULT 100,
            lat REAL DEFAULT 0,
            lng REAL DEFAULT 0,
            plate_number TEXT,
            driver_name TEXT,
            subscription_status TEXT DEFAULT 'ACTIVE',
            grace_period_expires INTEGER,
            next_billing_date INTEGER,
            gsm_signal_dbm INTEGER DEFAULT 0,
            sat_lock_count INTEGER DEFAULT 0,
            curfew_enabled INTEGER DEFAULT 0,
            curfew_start TEXT DEFAULT '06:00',
            curfew_end TEXT DEFAULT '18:00',
            curfew_days TEXT DEFAULT '["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]',
            curfew_allow_override INTEGER DEFAULT 1,
            curfew_holiday_mode INTEGER DEFAULT 0,
            override_status TEXT DEFAULT 'NONE',
            override_expires INTEGER DEFAULT 0,
            odometer_km REAL DEFAULT 0,
            ble_beacon_id TEXT,
            ble_beacon_rssi_threshold INTEGER DEFAULT -80,
            device_type TEXT DEFAULT 'mokosmart',
            vehicle_type TEXT DEFAULT 'car',
            FOREIGN KEY(owner_id) REFERENCES users(id)
        )
    `);
 
    // Schema Migration: Ensure all vehicle columns exist in vehicles table
    try {
        db.exec('ALTER TABLE vehicles ADD COLUMN lat REAL DEFAULT 0');
    } catch (e) {}
    try {
        db.exec('ALTER TABLE vehicles ADD COLUMN lng REAL DEFAULT 0');
    } catch (e) {}
    try {
        db.exec('ALTER TABLE vehicles ADD COLUMN plate_number TEXT');
    } catch (e) {}
    try {
        db.exec('ALTER TABLE vehicles ADD COLUMN gsm_signal_dbm INTEGER DEFAULT 0');
    } catch (e) {}
    try {
        db.exec('ALTER TABLE vehicles ADD COLUMN sat_lock_count INTEGER DEFAULT 0');
    } catch (e) {}
    try {
        db.exec('ALTER TABLE vehicles ADD COLUMN driver_name TEXT');
    } catch (e) {}
    try {
        db.exec("ALTER TABLE vehicles ADD COLUMN subscription_status TEXT DEFAULT 'ACTIVE'");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE vehicles ADD COLUMN grace_period_expires INTEGER");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE vehicles ADD COLUMN next_billing_date INTEGER");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE vehicles ADD COLUMN curfew_enabled INTEGER DEFAULT 0");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE vehicles ADD COLUMN curfew_start TEXT DEFAULT '06:00'");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE vehicles ADD COLUMN curfew_end TEXT DEFAULT '18:00'");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE vehicles ADD COLUMN curfew_days TEXT DEFAULT '[\"Mon\",\"Tue\",\"Wed\",\"Thu\",\"Fri\",\"Sat\",\"Sun\"]'");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE vehicles ADD COLUMN curfew_allow_override INTEGER DEFAULT 1");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE vehicles ADD COLUMN curfew_holiday_mode INTEGER DEFAULT 0");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE vehicles ADD COLUMN override_status TEXT DEFAULT 'NONE'");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE vehicles ADD COLUMN override_expires INTEGER DEFAULT 0");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE vehicles ADD COLUMN odometer_km REAL DEFAULT 0");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE vehicles ADD COLUMN ble_beacon_id TEXT");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE vehicles ADD COLUMN ble_beacon_rssi_threshold INTEGER DEFAULT -80");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE vehicles ADD COLUMN device_type TEXT DEFAULT 'mokosmart'");
    } catch (e) {}
    try {
        db.exec("ALTER TABLE vehicles ADD COLUMN vehicle_type TEXT DEFAULT 'car'");
    } catch (e) {}

    // 3. Create Vehicle History Table for Analytics
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

    // 4. Create Geofences Table
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

    // 5. Create Subscriptions Table (NEW)
    db.exec(`
        CREATE TABLE IF NOT EXISTS subscriptions (
            id TEXT PRIMARY KEY,
            user_id INTEGER,
            plan_id TEXT NOT NULL,
            paystack_customer_code TEXT,
            paystack_subscription_code TEXT,
            next_billing_date INTEGER,
            status TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
    `);

    // 6. Create Payments Table (NEW)
    db.exec(`
        CREATE TABLE IF NOT EXISTS payments (
            id TEXT PRIMARY KEY,
            user_id INTEGER,
            subscription_id TEXT,
            amount REAL,
            timestamp INTEGER,
            status TEXT NOT NULL,
            reference TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(subscription_id) REFERENCES subscriptions(id)
        )
    `);

    // 7. Create Maintenance Reminders Table (NEW - Dynamic Alerts v2)
    try {
        const hasLegacySchema = db.prepare("PRAGMA table_info(maintenance_reminders)").all().some(c => c.name === 'oil_change_threshold_km');
        if (hasLegacySchema) {
            console.log("Dropping legacy maintenance_reminders table to migrate to dynamic alerts v2...");
            db.exec("DROP TABLE maintenance_reminders");
        }
    } catch (e) {
        console.error("Failed to check/drop legacy maintenance table:", e.message);
    }

    db.exec(`
        CREATE TABLE IF NOT EXISTS maintenance_reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vehicle_id TEXT,
            type TEXT CHECK(type IN ('Oil Change', 'Brake Service', 'Tire Change', 'Insurance', 'Road Worthiness', 'Vehicle License', 'Custom')) NOT NULL,
            custom_name TEXT,
            threshold_km REAL,
            last_service_km REAL,
            due_date INTEGER,
            notes TEXT,
            status TEXT CHECK(status IN ('PENDING', 'COMPLETED')) DEFAULT 'PENDING',
            alerted INTEGER DEFAULT 0,
            FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
        )
    `);

    try {
        db.exec("ALTER TABLE maintenance_reminders ADD COLUMN alerted INTEGER DEFAULT 0");
    } catch (e) {}

    // 8. Create Drivers Table (NEW)
    db.exec(`
        CREATE TABLE IF NOT EXISTS drivers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            employee_id TEXT UNIQUE,
            phone TEXT,
            email TEXT,
            safety_score INTEGER DEFAULT 100
        )
    `);

    // 9. Create Support Codes Table
    db.exec(`
        CREATE TABLE IF NOT EXISTS support_codes (
            code TEXT PRIMARY KEY,
            user_id INTEGER,
            expires_at INTEGER,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // 10. Create Override Requests Table (NEW)
    db.exec(`
        CREATE TABLE IF NOT EXISTS override_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vehicle_id TEXT,
            driver_name TEXT,
            requested_at INTEGER,
            status TEXT CHECK(status IN ('PENDING', 'APPROVED_ONCE', 'APPROVED_MIDNIGHT', 'DENIED')) DEFAULT 'PENDING',
            resolved_at INTEGER,
            FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
        )
    `);

    // 11. Create Vehicle Alerts Table (NEW - Alert History for Safety Scoring)
    db.exec(`
        CREATE TABLE IF NOT EXISTS vehicle_alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vehicle_id TEXT,
            type TEXT NOT NULL,
            message TEXT,
            timestamp INTEGER,
            FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
        )
    `);

    // 12. Create Fuel Settings Table
    db.exec(`
        CREATE TABLE IF NOT EXISTS fuel_settings (
            vehicle_id TEXT PRIMARY KEY,
            fuel_type TEXT,
            fuel_price REAL,
            fuel_efficiency REAL,
            updated_at INTEGER,
            FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
        )
    `);

    // 13. Create Report History Table
    db.exec(`
        CREATE TABLE IF NOT EXISTS report_history (
            report_id INTEGER PRIMARY KEY AUTOINCREMENT,
            generated_by INTEGER,
            generated_at INTEGER,
            report_type TEXT,
            file_path TEXT,
            name TEXT,
            period TEXT,
            FOREIGN KEY(generated_by) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // 14. Create Report Schedules Table
    db.exec(`
        CREATE TABLE IF NOT EXISTS report_schedules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            frequency TEXT,
            recipients TEXT,
            report_type TEXT,
            delivery_method TEXT,
            time_of_delivery TEXT,
            created_at INTEGER,
            last_run_at INTEGER,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    try {
        db.exec("ALTER TABLE report_schedules ADD COLUMN last_run_at INTEGER");
    } catch (e) {}

    // 15. Create Transient Reports Processing Table
    db.exec(`
        CREATE TABLE IF NOT EXISTS reports (
            id TEXT PRIMARY KEY,
            user_id INTEGER,
            status TEXT,
            progress INTEGER DEFAULT 0,
            created_at INTEGER,
            completed_at INTEGER,
            error TEXT,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // Schema Migration: Add polygon geofence columns to geofences table
    try {
        db.exec("ALTER TABLE geofences ADD COLUMN type TEXT DEFAULT 'circle'");
    } catch (e) {
        // Column already exists
    }
    try {
        db.exec("ALTER TABLE geofences ADD COLUMN coordinates TEXT");
    } catch (e) {
        // Column already exists
    }

    // Create Indexes for Performance
    db.exec(`CREATE INDEX IF NOT EXISTS idx_history_vehicle_time ON vehicle_history(vehicle_id, timestamp DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_alerts_vehicle_time ON vehicle_alerts(vehicle_id, timestamp DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_alerts_type ON vehicle_alerts(type)`);

    // Seed default admin user if not exists (MUST run before vehicles referencing owner_id = 1)
    try {
        const adminExists = db.prepare("SELECT 1 FROM users WHERE username = 'admin'").get();
        const bcrypt = require('bcrypt');
        
        if (!adminExists) {
            const adminPassword = process.env.ADMIN_PASSWORD || 'admin';
            const hashedAdminPassword = bcrypt.hashSync(adminPassword, 12);
            db.prepare(`
                INSERT INTO users (username, password, role, email, phone, is_verified, plan_id, subscription_status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run('admin', hashedAdminPassword, 'admin', 'admin@safebox.com', '+234800000000', 1, 'ENTERPRISE', 'ACTIVE');
            console.log(`🛡️ Seeded default Super Admin user: admin / ${adminPassword === 'admin' ? 'admin (default)' : 'configured secure password'}`);
        } else if (process.env.ADMIN_PASSWORD) {
            // Only update the password if the environment variable is explicitly configured
            const adminPassword = process.env.ADMIN_PASSWORD;
            const hashedAdminPassword = bcrypt.hashSync(adminPassword, 12);
            db.prepare(`
                UPDATE users SET password = ? WHERE username = 'admin'
            `).run(hashedAdminPassword);
            console.log(`🛡️ Updated Super Admin user 'admin' password on startup from explicit environment variable.`);
        }
    } catch (e) {
        console.error("Failed to seed/update admin user:", e.message);
    }

    // Auto-register SAFEBOX_003 to SAFEBOX_007 for the TCP telematics simulator
    try {
        const adminUser = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
        const adminId = adminUser ? adminUser.id : 1;
        const insertStmt = db.prepare("INSERT OR IGNORE INTO vehicles (id, name, owner_id, is_locked, ble_beacon_id, ble_beacon_rssi_threshold) VALUES (?, ?, ?, ?, ?, ?)");
        for (let i = 3; i <= 7; i++) {
            insertStmt.run(`SAFEBOX_00` + i, `COTS Tracker 0` + i, adminId, 1, `TAG_00` + i, -80);
        }
        console.log("Registered SAFEBOX_003 - SAFEBOX_007 in database for simulation testing.");
    } catch (e) {
        console.error("Failed to auto-register simulation vehicles:", e.message);
    }

    // 16. Create Authorized Devices Table (Device Whitelist)
    db.exec(`
        CREATE TABLE IF NOT EXISTS authorized_devices (
            id TEXT PRIMARY KEY,
            created_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    `);

    // Auto-populate simulation IDs in authorized_devices
    try {
        const authInsert = db.prepare("INSERT OR IGNORE INTO authorized_devices (id) VALUES (?)");
        // Seed MOTO_001 to MOTO_050
        for (let i = 1; i <= 50; i++) {
            const numStr = i.toString().padStart(3, '0');
            authInsert.run(`MOTO_${numStr}`);
        }
        // Seed SAFEBOX_001 to SAFEBOX_010
        for (let i = 1; i <= 10; i++) {
            const numStr = i.toString().padStart(3, '0');
            authInsert.run(`SAFEBOX_${numStr}`);
        }
        // Seed a test physical IMEI
        authInsert.run("866344050048896");
        console.log("Authorized devices whitelist populated (simulation IDs and test IMEI).");
    } catch (e) {
        console.error("Failed to seed authorized devices:", e.message);
    }

    // 17. Create Shared Tracking Links Table (Live Location Sharing)
    db.exec(`
        CREATE TABLE IF NOT EXISTS shared_tracking_links (
            token TEXT PRIMARY KEY,
            vehicle_id TEXT NOT NULL,
            created_by INTEGER,
            expires_at INTEGER NOT NULL,
            active INTEGER DEFAULT 1,
            created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
            FOREIGN KEY(vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
            FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE CASCADE
        )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_shared_links_vehicle ON shared_tracking_links(vehicle_id, active)`);

    // Auto-seed mock companies (users with role='company') and payments for Super Admin analytics
    try {
        const companyCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'company'").get().count;
        if (companyCount === 0) {
            console.log("🌱 Seeding mock companies for Super Admin dashboard testing...");
            const bcrypt = require('bcrypt');
            const companyPass = bcrypt.hashSync('company123', 12);
            
            // Seed Company A (Active Premium)
            db.prepare(`
                INSERT INTO users (username, password, role, company_name, email, phone, plan_id, subscription_status, is_verified)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
            `).run('comp_logistics', companyPass, 'company', 'Apex Logistics Ltd', 'apex@logistics.com', '+2348031112222', 'PREMIUM', 'ACTIVE');
            
            // Seed Company B (Suspended Basic)
            db.prepare(`
                INSERT INTO users (username, password, role, company_name, email, phone, plan_id, subscription_status, is_verified)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
            `).run('comp_express', companyPass, 'company', 'Swift Express Inc', 'swift@express.com', '+2348033334444', 'BASIC', 'SUSPENDED');
            
            // Seed Company C (Active Free)
            db.prepare(`
                INSERT INTO users (username, password, role, company_name, email, phone, plan_id, subscription_status, is_verified)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
            `).run('comp_cargo', companyPass, 'company', 'Horizon Cargo Solutions', 'horizon@cargo.com', '+2348035556666', 'FREE', 'ACTIVE');
            
            console.log("🌱 Seeding mock payments...");
            const compA = db.prepare("SELECT id FROM users WHERE username = 'comp_logistics'").get();
            const compB = db.prepare("SELECT id FROM users WHERE username = 'comp_express'").get();
            
            if (compA) {
                // Seed mock subscription first to prevent foreign key violation
                db.prepare(`
                    INSERT OR IGNORE INTO subscriptions (id, user_id, plan_id, status)
                    VALUES (?, ?, ?, ?)
                `).run('sub_a', compA.id, 'PREMIUM', 'ACTIVE');

                // Seed some monthly payments for Apex Logistics (Premium: ₦15,000 / month)
                const insertPayment = db.prepare(`
                    INSERT INTO payments (id, user_id, subscription_id, amount, timestamp, status, reference)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `);
                
                // Last 3 months
                const now = Date.now();
                insertPayment.run('pay_a1', compA.id, 'sub_a', 15000, now - 90 * 24 * 3600 * 1000, 'SUCCESS', 'ref_apex_mar');
                insertPayment.run('pay_a2', compA.id, 'sub_a', 15000, now - 60 * 24 * 3600 * 1000, 'SUCCESS', 'ref_apex_apr');
                insertPayment.run('pay_a3', compA.id, 'sub_a', 15000, now - 30 * 24 * 3600 * 1000, 'SUCCESS', 'ref_apex_may');
                insertPayment.run('pay_a4', compA.id, 'sub_a', 15000, now, 'SUCCESS', 'ref_apex_jun');
            }
            
            if (compB) {
                // Seed mock subscription first to prevent foreign key violation
                db.prepare(`
                    INSERT OR IGNORE INTO subscriptions (id, user_id, plan_id, status)
                    VALUES (?, ?, ?, ?)
                `).run('sub_b', compB.id, 'BASIC', 'ACTIVE');

                // Seed payment for Swift Express (Basic: ₦5,000 / month)
                const insertPayment = db.prepare(`
                    INSERT INTO payments (id, user_id, subscription_id, amount, timestamp, status, reference)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `);
                const now = Date.now();
                insertPayment.run('pay_b1', compB.id, 'sub_b', 5000, now - 60 * 24 * 3600 * 1000, 'SUCCESS', 'ref_swift_apr');
                insertPayment.run('pay_b2', compB.id, 'sub_b', 5000, now - 30 * 24 * 3600 * 1000, 'SUCCESS', 'ref_swift_may');
                insertPayment.run('pay_b3', compB.id, 'sub_b', 5000, now, 'FAILED', 'ref_swift_jun');
            }
            console.log("🌱 Auto-seeding of mock companies and payments finished.");
        }
    } catch (e) {
        console.error("Failed to seed mock companies/payments:", e.message);
    }

    console.log('Database initialized successfully with new GTM and Reports schemas');
}

module.exports = { db, initDb };
