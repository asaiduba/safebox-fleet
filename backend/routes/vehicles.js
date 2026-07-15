const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { db } = require('../db');
const { authMiddleware, getRequestUserId } = require('../middleware/auth');
const { isWithinAllowedHours, getDeviceHeartbeatStatus } = require('../utils/helpers');
const { logAuditAction } = require('../utils/audit');

// GET all vehicles for user
router.get('/', authMiddleware, (req, res) => {
  const userId = getRequestUserId(req);
  try {
    const user = db.prepare('SELECT subscription_status, role FROM users WHERE id = ?').get(userId);
    const isUserSuspended = user && user.subscription_status === 'SUSPENDED' && user.role !== 'admin';

    const vehicles = db.prepare(`
      SELECT v.*, d.imei, d.tracker_type, d.protocol, d.status as device_status
      FROM vehicles v
      LEFT JOIN devices d ON v.id = d.vehicle_id
      WHERE v.owner_id = ?
    `).all(userId);

    const processed = vehicles.map(v => {
      const base = {
        ...v,
        imei: v.imei || '',
        trackerType: v.tracker_type || 'teltonika',
        protocol: v.protocol || 'codec8',
        deviceStatus: getDeviceHeartbeatStatus(v.last_seen),
        cloudLocked: v.cloud_locked === 1,
        locked: v.is_locked === 1,
        beaconRssi: v.beacon_rssi,
        driverPresent: v.driver_present !== 0
      };
      if (isUserSuspended || v.subscription_status === 'SUSPENDED') {
        return {
          ...base,
          lat: 0.0,
          lng: 0.0,
          speed: 0,
          odometer_km: 0
        };
      }
      return base;
    });

    res.json(processed);
  } catch (err) {
    console.error('Get vehicles error:', err);
    res.status(500).json({ error: 'Failed to retrieve vehicles: ' + err.message });
  }
});

// POST register a new vehicle
router.post('/', authMiddleware, async (req, res) => {
  const { id, name, plateNumber, driverName, vehicleType, groupId, imei, trackerType } = req.body;
  const ownerId = getRequestUserId(req);

  try {
    const idPattern = /^((MOTO|SAFEBOX)_\d{3}|\d{15})$/;
    if (!idPattern.test(id)) {
      return res.status(400).json({ error: 'Invalid ID Format. Must be MOTO_XXX, SAFEBOX_XXX, or a 15-digit IMEI number.' });
    }

    if (imei) {
      if (!/^\d{15}$/.test(imei)) {
        return res.status(400).json({ error: 'Invalid Tracker IMEI Format. Must be a 15-digit number.' });
      }
      // Ensure this IMEI is in the authorized_devices whitelist
      db.prepare('INSERT OR IGNORE INTO authorized_devices (id) VALUES (?)').run(imei);
    }

    const isAuthorized = db.prepare('SELECT 1 FROM authorized_devices WHERE id = ?').get(id);
    if (!isAuthorized) {
      return res.status(400).json({ error: 'Unauthorized Device ID. This tracker is not registered in the SafeBox system. Please contact Support to authorize your hardware.' });
    }

    if (/^\d{15}$/.test(id)) {
      const traccarUrl = process.env.TRACCAR_URL || 'https://traccar-production-e4f0.up.railway.app';
      const traccarUser = process.env.TRACCAR_USER || 'admin@safebox.com';
      const traccarPass = process.env.TRACCAR_PASS || 'adminpassword';

      if (traccarUrl && traccarUser && traccarPass) {
        (async () => {
          try {
            const auth = 'Basic ' + Buffer.from(`${traccarUser}:${traccarPass}`).toString('base64');
            await fetch(`${traccarUrl}/api/devices`, {
              method: 'POST',
              headers: {
                'Authorization': auth,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ name: name || id, uniqueId: id })
            });
            console.log(`[Traccar Link] Autolinked physical IMEI ${id} successfully.`);
          } catch (traccarErr) {
            console.error('[Traccar Link] Failed to autolink hardware in background:', traccarErr.message);
          }
        })();
      }
    }

    const existing = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(id);
    if (existing) {
      if (existing.owner_id === ownerId) {
        return res.status(400).json({ error: 'This vehicle tracker is already registered under your account.' });
      }
      return res.status(400).json({ error: 'This vehicle is already registered by another organization.' });
    }

    // If imei is set, also check if it's already registered to another vehicle
    if (imei) {
      const existingImei = db.prepare('SELECT vehicle_id FROM devices WHERE imei = ?').get(imei);
      if (existingImei) {
        return res.status(400).json({ error: `Tracker IMEI ${imei} is already registered under vehicle ID ${existingImei.vehicle_id}.` });
      }
    }

    db.prepare(`
      INSERT INTO vehicles (id, name, owner_id, is_locked, cloud_locked, last_seen, battery_level, fuel_level, lat, lng, plate_number, driver_name, subscription_status, vehicle_type, group_id)
      VALUES (?, ?, ?, 1, 1, ?, 100, 100, 0.0, 0.0, ?, ?, 'ACTIVE', ?, ?)
    `).run(id, name || id, ownerId, Date.now(), plateNumber || null, driverName || null, vehicleType || 'car', groupId ? parseInt(groupId) : null);

    if (imei) {
      db.prepare(`
        INSERT INTO devices (vehicle_id, imei, tracker_type, protocol, status)
        VALUES (?, ?, ?, 'codec8', 'OFFLINE')
      `).run(id, imei, trackerType || 'teltonika');
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${ownerId}`).emit('sync-data', { type: 'vehicles' });
    }

    res.json({ success: true, message: 'Vehicle registered successfully.' });
  } catch (err) {
    console.error('Register vehicle error:', err);
    res.status(500).json({ error: 'Failed to register vehicle: ' + err.message });
  }
});

// PUT update vehicle details
router.put('/:id', authMiddleware, (req, res) => {
  const userId = getRequestUserId(req);
  const vehicleId = req.params.id;
  const { name, plateNumber, driverName, vehicleType, groupId, imei, trackerType } = req.body;

  try {
    const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(vehicleId);
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }
    if (vehicle.owner_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized to modify this vehicle' });
    }

    if (imei) {
      if (!/^\d{15}$/.test(imei)) {
        return res.status(400).json({ error: 'Invalid Tracker IMEI Format. Must be a 15-digit number.' });
      }

      // Check if IMEI is already registered to a DIFFERENT vehicle
      const existingImei = db.prepare('SELECT vehicle_id FROM devices WHERE imei = ?').get(imei);
      if (existingImei && existingImei.vehicle_id !== vehicleId) {
        return res.status(400).json({ error: `Tracker IMEI ${imei} is already registered under vehicle ID ${existingImei.vehicle_id}.` });
      }

      // Whitelist IMEI
      db.prepare('INSERT OR IGNORE INTO authorized_devices (id) VALUES (?)').run(imei);

      // Upsert into devices table
      db.prepare('DELETE FROM devices WHERE vehicle_id = ?').run(vehicleId);
      db.prepare(`
        INSERT INTO devices (vehicle_id, imei, tracker_type, protocol, status)
        VALUES (?, ?, ?, 'codec8', 'OFFLINE')
      `).run(vehicleId, imei, trackerType || 'teltonika');
    } else {
      // If imei is empty, unlink the device
      db.prepare('DELETE FROM devices WHERE vehicle_id = ?').run(vehicleId);
    }

    db.prepare(`
      UPDATE vehicles
      SET name = ?, plate_number = ?, driver_name = ?, vehicle_type = ?, group_id = ?
      WHERE id = ?
    `).run(name || vehicleId, plateNumber || null, driverName || null, vehicleType || 'car', groupId ? parseInt(groupId) : null, vehicleId);

    if (global.invalidateMetadataCache) {
      global.invalidateMetadataCache(vehicleId);
    }

    logAuditAction(userId, req.user.username, 'update_vehicle', vehicleId, { name, plateNumber, driverName, vehicleType, groupId, imei, trackerType }, req);

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${userId}`).emit('sync-data', { type: 'vehicles' });
    }

    res.json({ success: true, message: 'Vehicle details updated successfully.' });
  } catch (err) {
    console.error("Update vehicle error:", err);
    res.status(500).json({ error: 'Failed to update vehicle details: ' + err.message });
  }
});

// DELETE vehicle
router.delete('/:id', authMiddleware, (req, res) => {
  const userId = getRequestUserId(req);
  const vehicleId = req.params.id;
  try {
    const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(vehicleId);
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }
    if (vehicle.owner_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized to delete this vehicle' });
    }

    db.prepare('DELETE FROM geofences WHERE vehicle_id = ?').run(vehicleId);
    db.prepare('DELETE FROM vehicle_history WHERE vehicle_id = ?').run(vehicleId);
    db.prepare('DELETE FROM vehicles WHERE id = ?').run(vehicleId);

    logAuditAction(userId, req.user.username, 'delete_vehicle', vehicleId, { name: vehicle.name }, req);

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${userId}`).emit('sync-data', { type: 'vehicles' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Delete vehicle error:', err);
    res.status(500).json({ error: 'Failed to delete vehicle' });
  }
});

// POST LOCK / UNLOCK command via REST API
// This is the primary, most reliable command path for web-initiated lock/unlock.
// It uses standard HTTP auth (JWT Bearer token) which is always working when the
// user is logged in — unlike the Socket.io channel which can silently fail if the
// WS handshake auth token is stale.
router.post('/:id/command', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const vehicleId = req.params.id;
  const { command } = req.body;

  if (!command || !['LOCK', 'UNLOCK'].includes(command)) {
    return res.status(400).json({ error: 'command must be LOCK or UNLOCK' });
  }

  try {
    const vehicle = db.prepare('SELECT owner_id, name, ignition FROM vehicles WHERE id = ?').get(vehicleId);
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }
    if (vehicle.owner_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const isLock = command === 'LOCK';

    // 1. Update database
    if (isLock) {
      db.prepare('UPDATE vehicles SET cloud_locked = 1, is_locked = 1 WHERE id = ?').run(vehicleId);
    } else {
      db.prepare('UPDATE vehicles SET cloud_locked = 0, is_locked = 0, override_status = \'NONE\', override_expires = 0 WHERE id = ?').run(vehicleId);
    }

    // 2. Invalidate metadata cache immediately so next telemetry sees the new state
    if (global.invalidateMetadataCache) {
      global.invalidateMetadataCache(vehicleId);
    }

    // 3. Send physical relay command
    const relayCmd = isLock ? 'setdigout 0' : 'setdigout 1';
    console.log(`[REST Command] ${command} for vehicle ${vehicleId} (${vehicle.name}) → ${relayCmd}`);

    const DeviceManager = req.app.get('DeviceManager');
    const sendTraccarCommand = req.app.get('sendTraccarCommand');

    const isDirectSocket = DeviceManager && DeviceManager.getStatus(vehicleId) === 'ONLINE';
    if (isDirectSocket) {
      DeviceManager.sendCommand(vehicleId, relayCmd, userId);
      console.log(`[REST Command] Sent via direct TCP socket for ${vehicleId}`);
    } else if (sendTraccarCommand) {
      await sendTraccarCommand(vehicleId, relayCmd);
      console.log(`[REST Command] Sent via Traccar API for ${vehicleId}`);
    } else {
      console.warn(`[REST Command] No command channel available for ${vehicleId}`);
    }

    // Update relay_state optimistically + reset auto-relay cooldown
    // so the next telemetry packet doesn't send a duplicate setdigout command.
    const desiredRelay = isLock ? 0 : 1;
    db.prepare('UPDATE vehicles SET relay_state = ?, relay_updated_at = ? WHERE id = ?')
      .run(desiredRelay, Date.now(), vehicleId);
    if (!global.relayCmdCooldown) global.relayCmdCooldown = new Map();
    global.relayCmdCooldown.set(`${vehicleId}-relay`, Date.now());

    // 4. Broadcast new state to all connected dashboards
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${userId}`).emit('device-data', {
        topic: `/device/${vehicleId}/status`,
        payload: {
          deviceId: vehicleId,
          locked: isLock,
          cloudLocked: isLock,
          relayState: isLock ? 0 : 1,
          timestamp: Date.now()
        }
      });
    }

    logAuditAction(userId, req.user.username, isLock ? 'lock_vehicle' : 'unlock_vehicle', vehicleId, { source: 'rest_api', vehicleName: vehicle.name }, req);

    res.json({ success: true, command, vehicleId, relayCmd });
  } catch (err) {
    console.error('[REST Command] Error:', err);
    res.status(500).json({ error: 'Command failed: ' + err.message });
  }
});

// POST Update BLE settings
router.post('/ble-settings', authMiddleware, (req, res) => {
  const userId = req.user.id;
  const { vehicleId, bleBeaconId, bleBeaconRssiThreshold } = req.body;
  const activeTcpSockets = req.app.get('activeTcpSockets');

  if (!vehicleId) {
    return res.status(400).json({ error: 'Vehicle ID is required.' });
  }

  try {
    const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(vehicleId);
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found.' });
    }
    if (vehicle.owner_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized to modify settings for this vehicle.' });
    }

    const rssi = bleBeaconRssiThreshold !== undefined ? parseInt(bleBeaconRssiThreshold) : -80;

    db.prepare('UPDATE vehicles SET ble_beacon_id = ?, ble_beacon_rssi_threshold = ? WHERE id = ?')
      .run(bleBeaconId || null, rssi, vehicleId);

    if (global.invalidateMetadataCache) {
      global.invalidateMetadataCache(vehicleId);
    }

    if (activeTcpSockets && activeTcpSockets.has(vehicleId)) {
      const socket = activeTcpSockets.get(vehicleId);
      socket.write(`$$CMD,${vehicleId},SET_BLE_BEACON,${bleBeaconId || ''},${rssi}\r\n`);
      console.log(`[BLE Config Sync] Pushed new BLE configuration to TCP socket for ${vehicleId}`);
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${userId}`).emit('sync-data', { type: 'vehicles' });
    }

    res.json({ success: true, message: 'BLE Keyless Entry configurations saved successfully.' });
  } catch (err) {
    console.error('Save BLE settings failed:', err);
    res.status(500).json({ error: 'Failed to save BLE configurations.' });
  }
});

// POST Curfew scheduler
router.post('/curfew', authMiddleware, (req, res) => {
  const userId = req.user.id;
  let { vehicleIds, applyTo, curfewEnabled, curfewStart, curfewEnd, curfewDays, curfewAllowOverride, curfewHolidayMode } = req.body;
  const activeTcpSockets = req.app.get('activeTcpSockets');
  const mqttClient = req.app.get('mqttClient');
  const io = req.app.get('io');

  if (applyTo === 'all') {
    const list = db.prepare('SELECT id FROM vehicles WHERE owner_id = ?').all(userId);
    vehicleIds = list.map(v => v.id);
  }

  if (!vehicleIds || !Array.isArray(vehicleIds) || vehicleIds.length === 0) {
    return res.status(400).json({ error: 'No vehicles selected or found.' });
  }

  if (curfewEnabled && (!curfewStart || !curfewEnd)) {
    return res.status(400).json({ error: 'Curfew start and end times are required when curfew is enabled.' });
  }

  const timePattern = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
  if (curfewStart && !timePattern.test(curfewStart)) {
    return res.status(400).json({ error: 'Invalid start time format. Use HH:MM.' });
  }
  if (curfewEnd && !timePattern.test(curfewEnd)) {
    return res.status(400).json({ error: 'Invalid end time format. Use HH:MM.' });
  }

  const daysJson = JSON.stringify(curfewDays || ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']);
  const allowOverride = curfewAllowOverride ? 1 : 0;
  const holidayMode = curfewHolidayMode ? 1 : 0;

  try {
    const placeholders = vehicleIds.map(() => '?').join(',');
    const count = db.prepare(`SELECT COUNT(*) as count FROM vehicles WHERE owner_id = ? AND id IN (${placeholders})`).get(userId, ...vehicleIds);
    if (count.count !== vehicleIds.length) {
      return res.status(403).json({ error: 'One or more vehicle IDs are invalid or not owned by you.' });
    }

    const updateCurfewLockStmt = db.prepare(`
      UPDATE vehicles
      SET curfew_enabled = ?,
          curfew_start = ?,
          curfew_end = ?,
          curfew_days = ?,
          curfew_allow_override = ?,
          curfew_holiday_mode = ?,
          is_locked = ?
      WHERE id = ? AND owner_id = ?
    `);

    const now = new Date();
    const isCurfew = !isWithinAllowedHours(now, curfewStart, curfewEnd, daysJson, holidayMode);

    const transaction = db.transaction(() => {
      vehicleIds.forEach(vid => {
        if (curfewEnabled) {
          if (isCurfew) {
            updateCurfewLockStmt.run(1, curfewStart, curfewEnd, daysJson, allowOverride, holidayMode, 1, vid, userId);
            if (mqttClient) {
              mqttClient.publish(`/device/${vid}/command`, JSON.stringify({ command: 'BLOCK_START' }));
            }
            if (activeTcpSockets && activeTcpSockets.has(vid)) {
              activeTcpSockets.get(vid).write(`$$CMD,${vid},SET_CLOUDLOCKED,1\r\n`);
            }
            console.log(`[Curfew API] Applied curfew (active) to ${vid}: Block Start sent`);
          } else {
            updateCurfewLockStmt.run(1, curfewStart, curfewEnd, daysJson, allowOverride, holidayMode, 0, vid, userId);
            if (mqttClient) {
              mqttClient.publish(`/device/${vid}/command`, JSON.stringify({ command: 'ALLOW_START' }));
              mqttClient.publish(`/device/${vid}/command`, JSON.stringify({ command: 'UNLOCK' }));
            }
            if (activeTcpSockets && activeTcpSockets.has(vid)) {
              activeTcpSockets.get(vid).write(`$$CMD,${vid},SET_CLOUDLOCKED,0\r\n`);
            }
            console.log(`[Curfew API] Applied curfew (inactive) to ${vid}: Settings updated, Allow Start sent`);
          }
        } else {
          updateCurfewLockStmt.run(0, curfewStart || '06:00', curfewEnd || '18:00', daysJson, allowOverride, holidayMode, 0, vid, userId);
          if (mqttClient) {
            mqttClient.publish(`/device/${vid}/command`, JSON.stringify({ command: 'ALLOW_START' }));
          }
          if (activeTcpSockets && activeTcpSockets.has(vid)) {
            activeTcpSockets.get(vid).write(`$$CMD,${vid},SET_CLOUDLOCKED,0\r\n`);
          }
          console.log(`[Curfew API] Disabled curfew for ${vid}: Allow Start sent`);
        }
        if (global.invalidateMetadataCache) {
          global.invalidateMetadataCache(vid);
        }
      });
    });

    transaction();

    logAuditAction(
      userId,
      req.user.username,
      curfewEnabled ? 'enable_curfew' : 'disable_curfew',
      applyTo === 'all' ? 'all' : vehicleIds.join(','),
      { curfewStart, curfewEnd, curfewDays, curfewAllowOverride, curfewHolidayMode },
      req
    );

    if (io) {
      io.to(`user_${userId}`).emit('billing-updated', { userId, vehicleIds });
    }

    res.json({ success: true, message: 'Vehicle Access Policy applied successfully.' });
  } catch (err) {
    console.error('Curfew settings update failed:', err);
    res.status(500).json({ error: 'Failed to update curfew settings' });
  }
});

// POST Generate share link
router.post('/:id/share', authMiddleware, (req, res) => {
  const userId = getRequestUserId(req);
  const vehicleId = req.params.id;
  const { durationMinutes } = req.body;

  if (!durationMinutes || durationMinutes < 1 || durationMinutes > 1440) {
    return res.status(400).json({ error: 'Duration must be between 1 and 1440 minutes (24 hours).' });
  }

  const vehicle = db.prepare('SELECT id, name, plate_number, driver_name FROM vehicles WHERE id = ? AND owner_id = ?').get(vehicleId, userId);
  if (!vehicle) {
    return res.status(404).json({ error: 'Vehicle not found or you do not own this vehicle.' });
  }

  const token = crypto.randomBytes(16).toString('hex');
  const expiresAt = Date.now() + (durationMinutes * 60 * 1000);

  db.prepare('INSERT INTO shared_tracking_links (token, vehicle_id, created_by, expires_at, active) VALUES (?, ?, ?, ?, 1)')
    .run(token, vehicleId, userId, expiresAt);

  console.log(`🔗 Live share link created for vehicle ${vehicleId} by user ${userId}, expires in ${durationMinutes}m, token: ${token}`);

  res.json({
    token,
    expiresAt,
    durationMinutes,
    vehicleName: vehicle.name,
    plateNumber: vehicle.plate_number
  });
});

// GET Resolve share token (Public)
router.get('/shared-track/:token', (req, res) => {
  const { token } = req.params;
  const now = Date.now();

  const link = db.prepare('SELECT * FROM shared_tracking_links WHERE token = ? AND active = 1').get(token);
  if (!link) {
    return res.status(404).json({ error: 'Tracking link not found or has been revoked.' });
  }

  if (link.expires_at <= now) {
    db.prepare('UPDATE shared_tracking_links SET active = 0 WHERE token = ?').run(token);
    return res.status(410).json({ error: 'This tracking session has expired.', expired: true });
  }

  const vehicle = db.prepare('SELECT id, name, plate_number, driver_name, vehicle_type, lat, lng, battery_level, fuel_level, last_seen FROM vehicles WHERE id = ?').get(link.vehicle_id);
  if (!vehicle) {
    return res.status(404).json({ error: 'Vehicle no longer exists.' });
  }

  res.json({
    vehicleId: vehicle.id,
    name: vehicle.name,
    plateNumber: vehicle.plate_number,
    driverName: vehicle.driver_name,
    vehicleType: vehicle.vehicle_type,
    lat: vehicle.lat,
    lng: vehicle.lng,
    battery: vehicle.battery_level,
    fuel: vehicle.fuel_level,
    lastSeen: vehicle.last_seen,
    expiresAt: link.expires_at
  });
});

// DELETE Revoke share token
router.delete('/shared-track/:token', authMiddleware, (req, res) => {
  const userId = getRequestUserId(req);
  const { token } = req.params;

  const link = db.prepare('SELECT * FROM shared_tracking_links WHERE token = ? AND created_by = ?').get(token, userId);
  if (!link) {
    return res.status(404).json({ error: 'Link not found or you did not create it.' });
  }

  db.prepare('UPDATE shared_tracking_links SET active = 0 WHERE token = ?').run(token);
  console.log(`🔗 Share link ${token} revoked by user ${userId}`);
  res.json({ success: true });
});

// GET maintenance reminders for a vehicle
router.get('/:vehicleId/maintenance', authMiddleware, async (req, res) => {
  const userId = getRequestUserId(req);
  const { vehicleId } = req.params;

  try {
    const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(vehicleId);
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }
    if (vehicle.owner_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized to access maintenance for this vehicle' });
    }

    const reminders = db.prepare('SELECT * FROM maintenance_reminders WHERE vehicle_id = ?').all(vehicleId);
    res.json(reminders);
  } catch (err) {
    console.error('Fetch maintenance reminders error:', err);
    res.status(500).json({ error: 'Failed to retrieve maintenance reminders' });
  }
});

// POST Create or update a maintenance reminder
router.post('/:vehicleId/maintenance', authMiddleware, async (req, res) => {
  const userId = getRequestUserId(req);
  const { vehicleId } = req.params;
  const { id, type, custom_name, threshold_km, last_service_km, due_date, notes, status } = req.body;

  if (!type) {
    return res.status(400).json({ error: 'Reminder type is required' });
  }

  const validTypes = ['Oil Change', 'Brake Service', 'Tire Change', 'Insurance', 'Road Worthiness', 'Vehicle License', 'Custom'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `Invalid reminder type. Must be one of: ${validTypes.join(', ')}` });
  }

  try {
    const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(vehicleId);
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }
    if (vehicle.owner_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized to manage maintenance for this vehicle' });
    }

    if (id) {
      const existing = db.prepare('SELECT vehicle_id FROM maintenance_reminders WHERE id = ?').get(id);
      if (!existing) {
        return res.status(404).json({ error: 'Reminder not found' });
      }
      if (existing.vehicle_id !== vehicleId) {
        return res.status(400).json({ error: 'Reminder does not belong to this vehicle' });
      }

      const stmt = db.prepare(`
        UPDATE maintenance_reminders 
        SET type = ?, custom_name = ?, threshold_km = ?, last_service_km = ?, due_date = ?, notes = ?, status = ?, alerted = 0
        WHERE id = ?
      `);
      stmt.run(type, custom_name || null, threshold_km || null, last_service_km || null, due_date || null, notes || null, status || 'PENDING', id);
      res.json({ success: true, id });
    } else {
      const stmt = db.prepare(`
        INSERT INTO maintenance_reminders (vehicle_id, type, custom_name, threshold_km, last_service_km, due_date, notes, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const info = stmt.run(vehicleId, type, custom_name || null, threshold_km || null, last_service_km || null, due_date || null, notes || null, status || 'PENDING');
      res.json({ success: true, id: info.lastInsertRowid });
    }
  } catch (err) {
    console.error('Save maintenance reminder error:', err);
    res.status(500).json({ error: 'Failed to save maintenance reminder' });
  }
});

// DELETE a maintenance reminder
router.delete('/:vehicleId/maintenance/:reminderId', authMiddleware, async (req, res) => {
  const userId = getRequestUserId(req);
  const { vehicleId, reminderId } = req.params;

  try {
    const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(vehicleId);
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }
    if (vehicle.owner_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized to delete maintenance for this vehicle' });
    }

    const reminder = db.prepare('SELECT vehicle_id FROM maintenance_reminders WHERE id = ?').get(reminderId);
    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found' });
    }
    if (reminder.vehicle_id !== vehicleId) {
      return res.status(400).json({ error: 'Reminder does not belong to this vehicle' });
    }

    db.prepare('DELETE FROM maintenance_reminders WHERE id = ?').run(reminderId);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete maintenance reminder error:', err);
    res.status(500).json({ error: 'Failed to delete maintenance reminder' });
  }
});

module.exports = router;
