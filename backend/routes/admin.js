const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { db } = require('../db');
const { authMiddleware, adminMiddleware, getRequestUserId } = require('../middleware/auth');

// Debug Route: Dump live BLE state (Admin-only)
router.get('/ble-debug', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const vehicles = db.prepare(`
      SELECT id, name, owner_id, ble_beacon_id, ble_beacon_rssi_threshold, beacon_rssi, driver_present, last_seen
      FROM vehicles
    `).all();
    res.json({ vehicles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Route: Whitelist/Authorize new tracker IMEI (Admin-only)
router.post('/authorize-device', authMiddleware, adminMiddleware, (req, res) => {
  const { id } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Device ID/IMEI is required.' });
  }

  try {
    const idPattern = /^((MOTO|SAFEBOX)_\d{3}|\d{15})$/;
    if (!idPattern.test(id)) {
      return res.status(400).json({ error: 'Invalid ID format. Must be MOTO_XXX, SAFEBOX_XXX, or a 15-digit IMEI.' });
    }

    db.prepare('INSERT OR IGNORE INTO authorized_devices (id) VALUES (?)').run(id);
    console.log(`🛡️ Whitelisted new device IMEI: ${id}`);
    res.json({ success: true, message: `Device ${id} has been successfully whitelisted in SafeBox inventory.` });
  } catch (err) {
    console.error('Super Admin authorize-device error:', err);
    res.status(500).json({ error: 'Failed to whitelist device' });
  }
});

// SUPER ADMIN: Dashboard KPI & System Metrics
router.get('/metrics', authMiddleware, adminMiddleware, (req, res) => {
  const io = req.app.get('io');
  try {
    const totalTenants = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'company'").get().count;

    const vehicles = db.prepare("SELECT subscription_status, COUNT(*) as count FROM vehicles GROUP BY subscription_status").all();
    let totalVehicles = 0;
    let activeVehicles = 0;
    vehicles.forEach(v => {
      totalVehicles += v.count;
      if (v.subscription_status === 'ACTIVE') {
        activeVehicles += v.count;
      }
    });

    const totalWhitelisted = db.prepare("SELECT COUNT(*) as count FROM authorized_devices").get().count;
    const claimedTrackers = db.prepare("SELECT COUNT(DISTINCT id) as count FROM vehicles").get().count;
    const availableTrackers = Math.max(0, totalWhitelisted - claimedTrackers);

    const totalRev = db.prepare("SELECT SUM(amount) as sum FROM payments WHERE status = 'SUCCESS'").get().sum || 0;

    const activeClients = io ? io.sockets.sockets.size : 0;

    const dbPath = path.join(__dirname, '..', 'database.sqlite');
    let dbSize = '0 MB';
    if (fs.existsSync(dbPath)) {
      const stats = fs.statSync(dbPath);
      dbSize = (stats.size / (1024 * 1024)).toFixed(2) + ' MB';
    }

    res.json({
      totalTenants,
      totalVehicles,
      activeVehicles,
      totalWhitelisted,
      claimedTrackers,
      availableTrackers,
      totalRevenue: totalRev,
      activeClients,
      databaseSize: dbSize
    });
  } catch (err) {
    console.error("Super Admin metrics error:", err);
    res.status(500).json({ error: 'Failed to fetch admin metrics: ' + err.message });
  }
});

// SUPER ADMIN: Global Alerts Feed
router.get('/alerts', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const alerts = db.prepare(`
      SELECT a.*, v.name as vehicle_name, u.username as owner_username, u.company_name
      FROM vehicle_alerts a
      JOIN vehicles v ON a.vehicle_id = v.id
      JOIN users u ON v.owner_id = u.id
      ORDER BY a.timestamp DESC
      LIMIT 30
    `).all();
    res.json(alerts);
  } catch (err) {
    console.error("Super Admin alerts fetch error:", err);
    res.status(500).json({ error: 'Failed to fetch global alerts feed: ' + err.message });
  }
});

// SUPER ADMIN: Tenants List
router.get('/tenants', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const tenants = db.prepare(`
      SELECT id, username, company_name, email, phone, plan_id, subscription_status, currency
      FROM users
      WHERE role IN ('company', 'individual')
      ORDER BY id DESC
    `).all();

    const enrichedTenants = tenants.map(t => {
      const vehiclesCount = db.prepare("SELECT COUNT(*) as count FROM vehicles WHERE owner_id = ?").get(t.id).count;
      const paymentsCount = db.prepare("SELECT COUNT(*) as count FROM payments WHERE user_id = ? AND status = 'SUCCESS'").get(t.id).count;
      const totalPaid = db.prepare("SELECT SUM(amount) as sum FROM payments WHERE user_id = ? AND status = 'SUCCESS'").get(t.id).sum || 0;
      
      return {
        ...t,
        vehiclesCount,
        paymentsCount,
        totalPaid
      };
    });

    res.json(enrichedTenants);
  } catch (err) {
    console.error("Super Admin tenants fetch error:", err);
    res.status(500).json({ error: 'Failed to fetch tenants list: ' + err.message });
  }
});

// SUPER ADMIN: Toggle Tenant Subscription Status (Suspend/Activate)
router.post('/tenants/:id/toggle-status', authMiddleware, adminMiddleware, (req, res) => {
  const { id } = req.params;
  const mqttClient = req.app.get('mqttClient');
  const activeTcpSockets = req.app.get('activeTcpSockets');
  const io = req.app.get('io');

  try {
    const user = db.prepare("SELECT subscription_status, role FROM users WHERE id = ?").get(id);
    if (!user) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const newStatus = user.subscription_status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    
    db.transaction(() => {
      db.prepare("UPDATE users SET subscription_status = ? WHERE id = ?").run(newStatus, id);
      if (newStatus === 'SUSPENDED') {
        db.prepare("UPDATE vehicles SET subscription_status = 'SUSPENDED', cloud_locked = 1, is_locked = 1 WHERE owner_id = ?").run(id);
      } else {
        db.prepare("UPDATE vehicles SET subscription_status = 'ACTIVE', cloud_locked = 0, is_locked = 0 WHERE owner_id = ?").run(id);
      }
    })();

    if (global.invalidateMetadataCache) {
      global.invalidateMetadataCache(); // Clear all cache entries
    }

    const vehicles = db.prepare("SELECT id FROM vehicles WHERE owner_id = ?").all(id);
    vehicles.forEach(v => {
      if (newStatus === 'SUSPENDED') {
        if (mqttClient) {
          mqttClient.publish(`/device/${v.id}/command`, JSON.stringify({ command: 'BLOCK_START' }));
          mqttClient.publish(`/device/${v.id}/command`, JSON.stringify({ command: 'LOCK' }));
        }
        if (activeTcpSockets && activeTcpSockets.has(v.id)) {
          activeTcpSockets.get(v.id).write(`$$CMD,v.id,SET_CLOUDLOCKED,1\r\n`);
        }
      } else {
        if (mqttClient) {
          mqttClient.publish(`/device/${v.id}/command`, JSON.stringify({ command: 'ALLOW_START' }));
          mqttClient.publish(`/device/${v.id}/command`, JSON.stringify({ command: 'UNLOCK' }));
        }
        if (activeTcpSockets && activeTcpSockets.has(v.id)) {
          activeTcpSockets.get(v.id).write(`$$CMD,v.id,SET_CLOUDLOCKED,0\r\n`);
        }
      }
    });

    if (newStatus === 'SUSPENDED' && io) {
      try {
        io.in(`user_${id}`).disconnectSockets(true);
        console.log(`🔌 Terminated active WebSocket connections for suspended user ID: ${id}`);
      } catch (e) {
        console.error(`Failed to disconnect sockets for suspended user ID: ${id}`, e);
      }
    }

    console.log(`🛡️ Super Admin changed subscription status of user ${id} to ${newStatus}`);
    res.json({ success: true, newStatus });
  } catch (err) {
    console.error("Super Admin toggle tenant status error:", err);
    res.status(500).json({ error: 'Failed to toggle tenant subscription status' });
  }
});

// SUPER ADMIN: Delete Tenant Account
router.delete('/tenants/:id', authMiddleware, adminMiddleware, (req, res) => {
  const { id } = req.params;
  try {
    const user = db.prepare("SELECT username, role FROM users WHERE id = ?").get(id);
    if (!user) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    if (user.role === 'admin') {
      return res.status(400).json({ error: 'Cannot delete an administrator account' });
    }

    db.transaction(() => {
      const vehicles = db.prepare("SELECT id FROM vehicles WHERE owner_id = ?").all(id);
      const vehicleIds = vehicles.map(v => v.id);

      if (vehicleIds.length > 0) {
        const placeholders = vehicleIds.map(() => '?').join(',');
        
        db.prepare(`DELETE FROM vehicle_history WHERE vehicle_id IN (${placeholders})`).run(...vehicleIds);
        db.prepare(`DELETE FROM vehicle_alerts WHERE vehicle_id IN (${placeholders})`).run(...vehicleIds);
        db.prepare(`DELETE FROM geofences WHERE vehicle_id IN (${placeholders})`).run(...vehicleIds);
        db.prepare(`DELETE FROM maintenance_reminders WHERE vehicle_id IN (${placeholders})`).run(...vehicleIds);
        db.prepare(`DELETE FROM override_requests WHERE vehicle_id IN (${placeholders})`).run(...vehicleIds);
        
        try {
          db.prepare(`DELETE FROM fuel_settings WHERE vehicle_id IN (${placeholders})`).run(...vehicleIds);
        } catch (e) {}

        db.prepare(`DELETE FROM vehicles WHERE owner_id = ?`).run(id);
      }

      db.prepare(`DELETE FROM payments WHERE user_id = ?`).run(id);
      db.prepare(`DELETE FROM report_schedules WHERE user_id = ?`).run(id);
      db.prepare(`DELETE FROM report_history WHERE generated_by = ?`).run(id);
      db.prepare(`DELETE FROM reports WHERE user_id = ?`).run(id);
      db.prepare(`DELETE FROM support_codes WHERE user_id = ?`).run(id);
      db.prepare(`DELETE FROM subscriptions WHERE user_id = ?`).run(id);
      db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
    })();

    console.log(`🛡️ Super Admin deleted user ${user.username} (ID: ${id}) and all associated fleet data.`);
    res.json({ success: true, message: 'Tenant and all associated data deleted successfully.' });
  } catch (err) {
    console.error("Super Admin delete tenant error:", err);
    res.status(500).json({ error: 'Failed to delete tenant: ' + err.message });
  }
});

// SUPER ADMIN: Get Running Server Logs
router.get('/logs', authMiddleware, adminMiddleware, (req, res) => {
  res.json(global.serverLogs || []);
});

// SUPER ADMIN: Device Inventory List
router.get('/devices', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const devices = db.prepare(`
      SELECT 
        ad.id, 
        ad.created_at, 
        v.name as vehicle_name, 
        v.id as vehicle_id,
        u.username as owner_username, 
        u.company_name,
        d.imei as linked_imei,
        d.tracker_type,
        d.status as device_status,
        d.last_seen
      FROM authorized_devices ad
      LEFT JOIN vehicles v ON v.id = ad.id
      LEFT JOIN devices d ON d.imei = ad.id OR d.vehicle_id = v.id
      LEFT JOIN users u ON u.id = v.owner_id
      ORDER BY ad.created_at DESC
    `).all();

    res.json(devices);
  } catch (err) {
    console.error("Super Admin devices fetch error:", err);
    res.status(500).json({ error: 'Failed to fetch device inventory: ' + err.message });
  }
});

// SUPER ADMIN: Bulk Whitelist Tracker Devices
router.post('/devices/whitelist', authMiddleware, adminMiddleware, (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Array of device IDs/IMEIs (ids) is required.' });
  }

  try {
    const idPattern = /^((MOTO|SAFEBOX)_\d{3}|\d{15})$/;
    const invalidIds = ids.filter(id => !idPattern.test(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({ error: `Invalid ID formats: ${invalidIds.join(', ')}. Must be MOTO_XXX, SAFEBOX_XXX, or a 15-digit IMEI.` });
    }

    const insertStmt = db.prepare('INSERT OR IGNORE INTO authorized_devices (id) VALUES (?)');
    let addedCount = 0;
    
    db.transaction(() => {
      for (const id of ids) {
        const info = insertStmt.run(id);
        if (info.changes > 0) {
          addedCount++;
        }
      }
    })();

    console.log(`🛡️ Whitelisted ${addedCount} new devices in inventory via Super Admin bulk whitelist.`);
    res.json({ success: true, message: `Successfully whitelisted ${addedCount} new devices.` });
  } catch (err) {
    console.error('Super Admin bulk whitelist error:', err);
    res.status(500).json({ error: 'Failed to whitelist devices' });
  }
});

// SUPER ADMIN: Delete Whitelisted Device IMEI
router.delete('/devices/:id', authMiddleware, adminMiddleware, (req, res) => {
  const deviceId = req.params.id;
  try {
    db.prepare('DELETE FROM vehicles WHERE id = ?').run(deviceId);
    const info = db.prepare('DELETE FROM authorized_devices WHERE id = ?').run(deviceId);

    if (info.changes === 0) {
      return res.status(404).json({ error: 'Device not found in whitelist.' });
    }

    console.log(`🛡️ Whitelisted device ${deviceId} removed by admin`);
    res.json({ success: true });
  } catch (err) {
    console.error("Super Admin device delete error:", err);
    res.status(500).json({ error: 'Failed to delete device: ' + err.message });
  }
});

// SUPER ADMIN: Transaction Payment Logs
router.get('/payments', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const payments = db.prepare(`
      SELECT p.id, p.amount, p.timestamp, p.status, p.reference, u.username, u.company_name
      FROM payments p
      JOIN users u ON u.id = p.user_id
      ORDER BY p.timestamp DESC
    `).all();

    res.json(payments);
  } catch (err) {
    console.error("Super Admin payments fetch error:", err);
    res.status(500).json({ error: 'Failed to fetch payment logs: ' + err.message });
  }
});

module.exports = router;
