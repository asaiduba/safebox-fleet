const express = require('express');
const http = require('http');
const path = require('path');

// --- Memory logs interceptor for remote super admin diagnostics ---
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
global.serverLogs = [];
console.log = (...args) => {
  global.serverLogs.push({ type: 'log', time: new Date().toISOString(), message: args.join(' ') });
  if (global.serverLogs.length > 200) global.serverLogs.shift();
  originalConsoleLog.apply(console, args);
};
console.error = (...args) => {
  global.serverLogs.push({ type: 'error', time: new Date().toISOString(), message: args.join(' ') });
  if (global.serverLogs.length > 200) global.serverLogs.shift();
  originalConsoleError.apply(console, args);
};
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { db, initDb } = require('./db');
const { isWithinAllowedHours } = require('./utils/helpers');
const DeviceManager = require('./services/DeviceManager');
const RelayManager = require('./services/relayManager');
const mqtt = require('mqtt');
const net = require('net');
const nodemailer = require('nodemailer');
require('dotenv').config();

// Initialize DB
initDb();

// --- In-Memory Telemetry Metadata Cache ---
global.metadataCache = new Map();
global.invalidateMetadataCache = (deviceId) => {
  if (!deviceId) {
    global.metadataCache.clear();
    console.log('[Cache] Invalidated entire metadata cache.');
  } else {
    global.metadataCache.delete(deviceId);
    console.log(`[Cache] Invalidated metadata cache for device: ${deviceId}`);
  }
};

global.getVehicleMetadata = (deviceId) => {
  const now = Date.now();
  const cached = global.metadataCache.get(deviceId);
  if (cached && (now - cached.timestamp < 60000)) {
    return cached.data;
  }
  
  // Cache miss or expired: Query Database
  const vehicle = db.prepare(`
    SELECT v.owner_id, v.name, v.lat, v.lng, v.odometer_km, v.is_locked, v.relay_state,
           v.curfew_enabled, v.curfew_start, v.curfew_end, v.curfew_days, v.curfew_allow_override,
           v.curfew_holiday_mode, v.override_status, v.override_expires, v.cloud_locked,
           v.ble_beacon_id, v.ble_beacon_rssi_threshold, v.subscription_status,
           f.min_voltage, f.max_voltage,
           u.subscription_status AS user_subscription_status
    FROM vehicles v
    LEFT JOIN users u ON v.owner_id = u.id
    LEFT JOIN fuel_settings f ON v.id = f.vehicle_id
    WHERE v.id = ?
  `).get(deviceId);
  
  global.metadataCache.set(deviceId, {
    timestamp: now,
    data: vehicle || null
  });
  return vehicle;
};

// --- Batch Database Writes for History ---
global.historyWriteQueue = [];
const insertHistoryStmt = db.prepare(`
  INSERT INTO vehicle_history (vehicle_id, timestamp, speed, battery_level, fuel_level, lat, lng)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const batchInsertHistory = db.transaction((records) => {
  for (const r of records) {
    insertHistoryStmt.run(r.vehicleId, r.timestamp, r.speed, r.battery, r.fuel, r.lat, r.lng);
  }
});

global.logVehicleHistory = (record) => {
  global.historyWriteQueue.push(record);
  if (global.historyWriteQueue.length >= 20) {
    global.flushHistoryQueue();
  }
};

global.flushHistoryQueue = () => {
  if (global.historyWriteQueue.length === 0) return;
  const records = [...global.historyWriteQueue];
  global.historyWriteQueue.length = 0; // Clear queue
  try {
    batchInsertHistory(records);
    console.log(`[Database Perf] Successfully flushed ${records.length} history records in a batch.`);
  } catch (err) {
    console.error('[Database Perf] Failed to flush history records batch:', err.message);
    // Put them back in front of the queue to avoid loss
    global.historyWriteQueue.unshift(...records);
  }
};

// Periodic flush every 10 seconds
setInterval(global.flushHistoryQueue, 10000);


const app = express();
app.set('trust proxy', 1); // trust first proxy for accurate rate limiting behind Railway's reverse proxy
const server = http.createServer(app);

// --- SECURITY: CORS origin restriction ---
const ALLOWED_ORIGINS = process.env.NODE_ENV === 'production'
  ? (process.env.ALLOWED_ORIGINS || 'https://safebox.onrender.com,https://safeboxfleet.com,https://safebox-fleet-production.up.railway.app').split(',')
  : ['http://localhost:5173', 'http://localhost:3000'];

const io = socketIo(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"]
  }
});
app.set('io', io);

// --- SECURITY: Socket.io JWT Authentication Middleware ---
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error('Authentication error: Token required'));
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    

    
    socket.user = decoded; // { id, username, role }
    next();
  } catch (err) {
    return next(new Error('Authentication error: Invalid token'));
  }
});

// --- Socket.io connection joining and remote command listener ---
io.on('connection', (socket) => {
  if (socket.user && socket.user.id) {
    const userRoom = `user_${socket.user.id}`;
    socket.join(userRoom);
    console.log(`👤 Socket client ${socket.id} joined room: ${userRoom}`);

    socket.on('send-command', (data) => {
      const { deviceId, command } = data;
      console.log(`[Socket.io Command] Received "${command}" command for device ${deviceId} from user ${socket.user.username}`);

      const activeTcpSockets = app.get('activeTcpSockets');
      const mqttClient = app.get('mqttClient');

      try {
        const vehicle = db.prepare('SELECT owner_id, name FROM vehicles WHERE id = ?').get(deviceId);
        if (!vehicle) {
          console.warn(`[Socket.io Command] Vehicle ${deviceId} not found.`);
          return;
        }
        if (vehicle.owner_id !== socket.user.id && socket.user.role !== 'admin') {
          console.warn(`[Socket.io Command] User ${socket.user.username} unauthorized for vehicle ${deviceId}.`);
          return;
        }

        const isLock = (command === 'LOCK' || command === 'BLOCK_START');
        const cloudLockedVal = isLock ? 1 : 0;

        if (isLock) {
          db.prepare('UPDATE vehicles SET cloud_locked = 1, is_locked = 1 WHERE id = ?').run(deviceId);
        } else {
          db.prepare("UPDATE vehicles SET cloud_locked = 0, is_locked = 0, override_status = 'NONE', override_expires = 0 WHERE id = ?").run(deviceId);
        }
        if (global.invalidateMetadataCache) {
          global.invalidateMetadataCache(deviceId);
        }

        // Send the physical relay command immediately.
        // Route to direct TCP socket if available, otherwise fall back to Traccar API.
        const currentVehicle = db.prepare('SELECT ignition FROM vehicles WHERE id = ?').get(deviceId);
        const ignitionOn = currentVehicle && currentVehicle.ignition === 1;
        const relayCmd = isLock ? 'setdigout 0' : 'setdigout 1';
        
        if (ignitionOn || !isLock) {
          const isDirectSocket = DeviceManager.getStatus(deviceId) === 'ONLINE';
          if (isDirectSocket) {
            DeviceManager.sendCommand(deviceId, relayCmd, socket.user.id);
          } else {
            // Device is connected via Traccar — send through Traccar REST API
            sendTraccarCommand(deviceId, relayCmd);
          }
        } else {
          console.log(`[Socket.io Command] Vehicle ${deviceId} ACC is OFF. Still queuing setdigout via Traccar for when engine starts.`);
          sendTraccarCommand(deviceId, relayCmd);
        }

        const { logAuditAction } = require('./utils/audit');
        logAuditAction(
          socket.user.id,
          socket.user.username,
          isLock ? 'lock_vehicle' : 'unlock_vehicle',
          deviceId,
          { source: 'dashboard_ws', vehicleName: vehicle.name },
          socket.request
        );

        broadcastDeviceData(deviceId, `/device/${deviceId}/status`, {
          deviceId,
          locked: isLock,        // true = armed, false = disarmed
          cloudLocked: isLock,   // mirrors the web lock button state
          relayState: isLock ? 0 : 1, // 0 = wire cut, 1 = wire reconnected
          timestamp: Date.now()
        });
      } catch (err) {
        console.error('[Socket.io Command] Command execution error:', err.message);
      }
    });
  }
});

// --- Shared Tracking Socket.io Namespace ---
const sharedTrackingNamespace = io.of('/shared-tracking');
sharedTrackingNamespace.on('connection', (socket) => {
  console.log(`📡 Shared tracking socket connected: ${socket.id}`);

  socket.on('join-shared-track', (token) => {
    try {
      const link = db.prepare('SELECT * FROM shared_tracking_links WHERE token = ? AND active = 1').get(token);
      if (!link) {
        socket.emit('shared-track-error', { error: 'Invalid or inactive tracking link.' });
        return;
      }
      if (link.expires_at <= Date.now()) {
        db.prepare('UPDATE shared_tracking_links SET active = 0 WHERE token = ?').run(token);
        socket.emit('shared-track-error', { error: 'Tracking session has expired.' });
        return;
      }

      const room = `shared_token_${token}`;
      socket.join(room);
      console.log(`📡 Socket ${socket.id} joined shared tracking room: ${room} for vehicle ${link.vehicle_id}`);
    } catch (err) {
      console.error('Error joining shared track room:', err.message);
      socket.emit('shared-track-error', { error: 'Internal server error.' });
    }
  });

  socket.on('disconnect', () => {
    console.log(`📡 Shared tracking socket disconnected: ${socket.id}`);
  });
});

function broadcastToSharedTrackers(deviceId, lat, lng, speed, nowMs) {
  try {
    const activeLinks = db.prepare(`
      SELECT token FROM shared_tracking_links
      WHERE vehicle_id = ? AND active = 1 AND expires_at > ?
    `).all(deviceId, Date.now());

    activeLinks.forEach(link => {
      sharedTrackingNamespace.to(`shared_token_${link.token}`).emit('shared-device-data', {
        lat,
        lng,
        speed,
        timestamp: nowMs
      });
    });
  } catch (err) {
    console.error('Error broadcasting to shared trackers:', err.message);
  }
}

// --- SECURITY: JWT Secret & Middleware Imports ---
const { authMiddleware, adminMiddleware, getRequestUserId, JWT_SECRET } = require('./middleware/auth');
const { saveAndNotifyAlert, dispatchAlertNotification } = require('./utils/notifications');

// Middleware
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());

// --- ROUTE MODULES (P2 Modularization) ---
const authRouter = require('./routes/auth');
const vehiclesRouter = require('./routes/vehicles');
const geofencesRouter = require('./routes/geofences');
const adminRouter = require('./routes/admin');
const paymentsRouter = require('./routes/payments');
const analyticsRouter = require('./routes/analytics');
const reportsRouter = require('./routes/reports');
const notificationsRouter = require('./routes/notifications');
const overrideRouter = require('./routes/override');
const auditRouter = require('./routes/audit');
const exportsRouter = require('./routes/exports');
const groupsRouter = require('./routes/groups');

// Mount route middleware
app.use('/api', authRouter);
app.use('/api/vehicles', vehiclesRouter);
app.use('/api/geofences', geofencesRouter);
app.use('/api/admin', adminRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/override', overrideRouter);
app.use('/api/audit-logs', auditRouter);
app.use('/api/exports', exportsRouter);
app.use('/api/groups', groupsRouter);

// Serve reports public directory statically
app.use('/reports', express.static(path.join(__dirname, 'public', 'reports')));

// --- Health Check Endpoint (used by Railway and uptime monitors) ---
app.get('/api/health', (req, res) => {
  try {
    const dbOk = !!db.prepare('SELECT 1').get();
    const mqttOk = mqttClient ? mqttClient.connected : false;
    const uptime = Math.round(process.uptime());
    const memMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    res.json({
      status: dbOk && mqttOk ? 'ok' : 'degraded',
      db: dbOk,
      mqtt: mqttOk,
      uptime_seconds: uptime,
      memory_mb: memMb,
      env: process.env.NODE_ENV || 'development'
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// MQTT Broker Setup — Private HiveMQ Cloud (TLS + Credentials)
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://broker.emqx.io'; // fallback for local dev only
if (process.env.NODE_ENV === 'production' && (!process.env.MQTT_BROKER_URL || MQTT_BROKER_URL.includes('broker.emqx.io'))) {
  console.warn('⚠️ WARNING: Using fallback PUBLIC unencrypted MQTT Broker in production! Ensure MQTT_BROKER_URL is configured.');
}
const mqttOptions = process.env.MQTT_BROKER_USER ? {
  username: process.env.MQTT_BROKER_USER,
  password: process.env.MQTT_BROKER_PASS,
  rejectUnauthorized: true // enforce TLS certificate validation
} : {};

console.log(`🔌 Connecting to MQTT Broker: ${MQTT_BROKER_URL}`);
const mqttClient = mqtt.connect(MQTT_BROKER_URL, mqttOptions);
app.set('mqttClient', mqttClient);

mqttClient.on('connect', () => {
  console.log('✅ Connected to Public MQTT Broker');
  mqttClient.subscribe('/device/+/status'); // Subscribe to all device statuses
  mqttClient.subscribe('/device/+/alert');  // Subscribe to all device alerts
  mqttClient.subscribe('/device/+/command'); // Subscribe to all device commands
});

mqttClient.on('error', (err) => {
  console.error('❌ MQTT Connection Error:', err.message);
});

mqttClient.on('reconnect', () => {
  console.log('🔄 MQTT Reconnecting...');
});

mqttClient.on('offline', () => {
  console.warn('⚠️ MQTT Broker Offline — telemetry paused');
});

// Initialize global cache for Traccar Device IDs mapping to IMEIs
global.traccarDeviceIds = global.traccarDeviceIds || new Map();

// Helper to send custom commands (e.g. setdigout) to Teltonika trackers via Traccar API
const sendTraccarCommand = async (imei, commandText) => {
  const traccarUrl = process.env.TRACCAR_URL || 'https://traccar-production-e4f0.up.railway.app';
  const traccarUser = process.env.TRACCAR_USER || 'admin@safebox.com';
  // No hardcoded fallback — fail loudly if the password is not set in Railway env vars.
  const traccarPass = process.env.TRACCAR_PASS;
  if (!traccarPass) {
    console.error('[Traccar Command] TRACCAR_PASS env var not set — cannot send command to device.');
    return;
  }

  if (!traccarUrl || !traccarUser || !traccarPass) {
    console.log('[Traccar Command] Traccar API credentials not configured. Skipping command forward.');
    return;
  }

  let traccarId = global.traccarDeviceIds.get(imei);
  const auth = 'Basic ' + Buffer.from(`${traccarUser}:${traccarPass}`).toString('base64');

  if (!traccarId) {
    console.log(`[Traccar Command] Traccar ID not cached for IMEI ${imei}. Querying Traccar API...`);
    try {
      const res = await fetch(`${traccarUrl}/api/devices?uniqueId=${imei}`, {
        headers: { 'Authorization': auth }
      });
      if (res.status === 200) {
        const devices = await res.json();
        if (devices && devices.length > 0) {
          traccarId = devices[0].id;
          global.traccarDeviceIds.set(imei, traccarId);
          console.log(`[Traccar Command] Found and cached Traccar ID ${traccarId} for IMEI ${imei}`);
        }
      }
    } catch (err) {
      console.error(`[Traccar Command] Failed to fetch device ID for IMEI ${imei}:`, err.message);
      return;
    }
  }

  if (!traccarId) {
    console.warn(`[Traccar Command] Device with IMEI ${imei} not found in Traccar. Cannot send command.`);
    return;
  }

  console.log(`[Traccar Command] Sending custom command "${commandText}" to Traccar Device ${traccarId} (IMEI ${imei})`);
  try {
    const res = await fetch(`${traccarUrl}/api/commands/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': auth
      },
      body: JSON.stringify({
        deviceId: traccarId,
        type: 'custom',
        attributes: {
          data: commandText
        }
      })
    });
    if (res.status === 200 || res.status === 202) {
      console.log(`[Traccar Command] Command "${commandText}" successfully sent to Traccar device ${traccarId}`);
    } else {
      const errText = await res.text();
      console.error(`[Traccar Command] Traccar rejected command. Status: ${res.status}, Response: ${errText}`);
    }
  } catch (err) {
    console.error(`[Traccar Command] Error calling Traccar send command API:`, err.message);
  }
};

// Register on Express app so routes (vehicles.js etc.) can use them via req.app.get(...)
app.set('sendTraccarCommand', sendTraccarCommand);

// MQTT Publish Event (Handle Telemetry, Alerts & Commands)
mqttClient.on('message', (topic, message) => {
  const payloadStr = message.toString();
  console.log(`Received MQTT: ${topic}`);

  // 1. Intercept Commands and forward them to Traccar REST API (setdigout 1 / setdigout 0)
  if (topic.startsWith('/device/') && topic.endsWith('/command')) {
    try {
      const parts = topic.split('/');
      const deviceId = parts[2];
      const payload = JSON.parse(payloadStr);
      const cmd = payload.command;
      console.log(`[Command Bridge] Intercepted command ${cmd} for device ${deviceId}`);
      
      if (cmd === 'BLOCK_START' || cmd === 'LOCK') {
        sendTraccarCommand(deviceId, 'setdigout 0');
      } else if (cmd === 'ALLOW_START' || cmd === 'UNLOCK') {
        sendTraccarCommand(deviceId, 'setdigout 1');
      }
    } catch (err) {
      console.error('[Command Bridge] Error parsing or forwarding command', err);
    }
    return;
  }

  // 2. Handle Telemetry
  if (topic.startsWith('/device/') && topic.endsWith('/status')) {
    try {
      const payload = JSON.parse(payloadStr);

      // Verify the vehicle exists and find its owner
      const vehicle = global.getVehicleMetadata(payload.deviceId);
      if (!vehicle) {
        console.warn(`⚠️ Received telemetry for unregistered device: ${payload.deviceId}`);
        return;
      }
      const ownerId = vehicle.owner_id;

      if (vehicle.subscription_status === 'SUSPENDED' || vehicle.user_subscription_status === 'SUSPENDED') {
        console.log(`[Subscription Policy] Suspended vehicle or owner for ${payload.deviceId} telemetry ignored.`);
        return;
      }

      // Curfew lock state calculation
      let curfewLocked = false;
      if (vehicle.curfew_enabled === 1) {
        const now = new Date();
        const isAllowed = isWithinAllowedHours(now, vehicle.curfew_start, vehicle.curfew_end, vehicle.curfew_days, vehicle.curfew_holiday_mode);
        if (!isAllowed) {
          let hasOverride = false;
          if (vehicle.override_status === 'APPROVED_MIDNIGHT' || vehicle.override_status === 'APPROVED_ONCE') {
            if (Date.now() < vehicle.override_expires) {
              hasOverride = true;
            }
          }
          if (!hasOverride) {
            curfewLocked = true;
          }
        }
      }

      // ─── BLE Proximity check (driver presence) ────────────────────────────────
      // Safety design: BLE RSSI fluctuates by ±15 dBm. A single missed/weak
      // reading must NOT immediately declare the driver absent, because that could
      // immobilize the engine while the vehicle is moving.
      //
      // Strategy:
      //  1. "Last-seen" grace period: beacon must be absent for 3 consecutive
      //     minutes (3 missed 60-second readings) before driver is declared absent.
      //  2. "Moving" grace period: if the vehicle moved in the last 5 minutes,
      //     never lock — rider is on the bike regardless of beacon state.

      if (!global.lastBeaconSeen) global.lastBeaconSeen   = new Map();
      if (!global.lastMovingTime) global.lastMovingTime   = new Map();

      // Track last time this vehicle was seen moving
      if (payload.speed > 0) {
        global.lastMovingTime.set(payload.deviceId, Date.now());
      }
      const lastMoving = global.lastMovingTime.get(payload.deviceId) || 0;
      const wasMovingRecently = (Date.now() - lastMoving) < 5 * 60 * 1000; // 5-minute window

      const bleBeacons = [];
      if (payload.rawBleList) {
        payload.rawBleList.split(';').forEach(pair => {
          const [mac, rssi] = pair.split(':');
          if (mac && rssi) {
            bleBeacons.push({ mac: mac.trim(), rssi: parseInt(rssi.trim()) });
          }
        });
      }

      // --- BLE DIAGNOSTIC: log what was received and what we try to match ---
      if (bleBeacons.length > 0 || payload.rawBleList) {
        console.log(`[BLE MQTT] Device ${payload.deviceId} → rawBleList: "${payload.rawBleList}", parsed beacons: ${JSON.stringify(bleBeacons)}`);
      }

      let driverPresent = false;
      let matchedRssi = null;
      if (vehicle.ble_beacon_id) {
        const normalizedBeaconId = vehicle.ble_beacon_id.replace(/:/g, '').toUpperCase();
        console.log(`[BLE MQTT] Trying to match beacons against configured ID: "${normalizedBeaconId}" (threshold: ${vehicle.ble_beacon_rssi_threshold} dBm)`);
        const matchedTag = bleBeacons.find(b => {
          const cleanMac = b.mac.replace(/:/g, '').toUpperCase().replace(/^0+/, '');
          const cleanDb = normalizedBeaconId.replace(/^0+/, '');
          const isMatch = cleanMac === cleanDb || cleanMac.endsWith(cleanDb) || cleanDb.endsWith(cleanMac);
          if (process.env.BLE_DEBUG) {
            console.log(`[BLE MQTT]   comparing cleanMac="${cleanMac}" vs cleanDb="${cleanDb}" → ${isMatch ? '✅ MATCH' : '❌ no match'}`);
          }
          return isMatch;
        });
        if (matchedTag) {
          matchedRssi = matchedTag.rssi;
          const aboveThreshold = matchedTag.rssi >= vehicle.ble_beacon_rssi_threshold;
          console.log(`[BLE MQTT] ✅ Beacon matched! RSSI=${matchedRssi} dBm, threshold=${vehicle.ble_beacon_rssi_threshold}, driverPresent=${aboveThreshold}`);
          if (aboveThreshold) {
            // Beacon visible and above threshold → update last-seen timestamp
            global.lastBeaconSeen.set(payload.deviceId, Date.now());
            driverPresent = true;
          }
        } else {
          console.log(`[BLE MQTT] ❌ No beacon matched configured ID "${vehicle.ble_beacon_id}" among ${bleBeacons.length} received beacon(s).`);
        }

        // GRACE PERIOD: if beacon was visible within the last 3 minutes, still
        // treat the driver as present (covers RSSI fluctuation and missed scans).
        const lastSeen = global.lastBeaconSeen.get(payload.deviceId) || 0;
        const beaconSeenRecently = (Date.now() - lastSeen) < 3 * 60 * 1000; // 3-minute window
        if (!driverPresent && beaconSeenRecently) {
          console.log(`[BLE MQTT] ⏱️  Beacon not in current packet but was seen ${Math.round((Date.now()-lastSeen)/1000)}s ago — grace period active, treating driver as present.`);
          driverPresent = true;
        }

        // MOVING GRACE: if the vehicle moved in the last 5 minutes, driver is present
        // regardless of beacon state — never risk cutting the engine mid-ride.
        if (!driverPresent && wasMovingRecently) {
          console.log(`[BLE MQTT] 🚗 Vehicle was moving ${Math.round((Date.now()-lastMoving)/1000)}s ago — moving grace period active, treating driver as present.`);
          driverPresent = true;
        }
      } else {
        driverPresent = true;
      }

      // Expose BLE properties directly in the payload so they are broadcast to user screens
      payload.beaconRssi = matchedRssi;
      payload.driverPresent = driverPresent;

      // Dashboard badge / DB is_locked is driven ONLY by cloud_locked + curfew.
      // BLE (driverPresent) is a startup-only guard and must NOT control is_locked.
      const isWebOrCurfewLocked = (vehicle.cloud_locked === 1 || curfewLocked);
      const currentDbLocked = vehicle.is_locked === 1;
      let isLocked = isWebOrCurfewLocked ? 1 : 0;

      // Evaluate unified security alerts (Hotwire, Towing, and Unauthorized Movement)
      evaluateSecurityAlerts(
        payload.deviceId, 
        vehicle, 
        payload.ignition ? 1 : 0,  // truthy check: accepts boolean true, number 1, string '1'
        payload.speed || 0, 
        driverPresent, 
        curfewLocked, 
        isLocked, 
        Date.now(), 
        ownerId
      );

      // 🚨 Alert calculation: Harsh Driving Behavior
      if (payload.harshAccel || payload.harshBrake) {
        const alertType = payload.harshAccel ? 'HARSH_ACCEL' : 'HARSH_BRAKE';
        const alertMsg = payload.harshAccel 
          ? `Driver Behavior Alert: Harsh acceleration detected on vehicle "${vehicle.name || payload.deviceId}"!` 
          : `Driver Behavior Alert: Harsh braking detected on vehicle "${vehicle.name || payload.deviceId}"!`;

        const alertCooldownKey = `${payload.deviceId}_${alertType}`;
        if (!global.alertCooldowns) global.alertCooldowns = new Map();
        if (!global.alertCooldowns.has(alertCooldownKey) || Date.now() - global.alertCooldowns.get(alertCooldownKey) > 1 * 60 * 1000) {
          global.alertCooldowns.set(alertCooldownKey, Date.now());
          saveAndNotifyAlert(payload.deviceId, alertType, alertMsg, Date.now());
          mqttClient.publish(`/device/${payload.deviceId}/alert`, JSON.stringify({
            deviceId: payload.deviceId,
            type: alertType,
            message: alertMsg,
            timestamp: Date.now()
          }));
          console.log(`[Alert Engine] Dispatched harsh driving alert for ${payload.deviceId}: ${alertType}`);
        }
      }

      if (!isWebOrCurfewLocked && currentDbLocked) {
        // --- TRANSITION: UNLOCK ENGINE (web unlocked or curfew ended) ---
        console.log(`[Security Policy] Auto-unlocking vehicle ${payload.deviceId} (web unlocked / curfew ended).`);
        payload.locked = false;

        // Clear curfew override if back inside allowed hours
        if (vehicle.override_status !== 'NONE' && !curfewLocked) {
          db.prepare("UPDATE vehicles SET override_status = 'NONE', override_expires = 0 WHERE id = ?").run(payload.deviceId);
        }
      }
      else if (isWebOrCurfewLocked && !currentDbLocked) {
        // --- TRANSITION: LOCK ENGINE (web locked or curfew started) ---
        console.log(`[Security Policy] Enforcing LOCK for vehicle ${payload.deviceId}. Reason: cloud_locked=${vehicle.cloud_locked}, curfew=${curfewLocked}`);
        payload.locked = true;
      }
      else {
        // --- NO TRANSITION: Maintain current web/curfew lock state ---
        payload.locked = currentDbLocked;

        // Clear curfew override if back inside allowed hours
        if (!isWebOrCurfewLocked && vehicle.override_status !== 'NONE' && !curfewLocked) {
          db.prepare("UPDATE vehicles SET override_status = 'NONE', override_expires = 0 WHERE id = ?").run(payload.deviceId);
        }
      }

      // ─── Automatic Relay State Machine (Unified via RelayManager) ────────────
      RelayManager.evaluateAutomaticRelay(payload.deviceId, payload.ignition ? 1 : 0, payload.speed || 0, payload.rawBleList || '', vehicle);
      // ─────────────────────────────────────────────────────────────────────────

      // Warn if running outside allowed hours and moving
      if (curfewLocked && payload.speed > 0) {
        if (!global.curfewRunningAlerts) global.curfewRunningAlerts = new Map();
        const lastAlertTime = global.curfewRunningAlerts.get(payload.deviceId);
        if (!lastAlertTime || (Date.now() - lastAlertTime > 300000)) { // 5 min cooldown
          const alertMsg = `Warning: Vehicle ${payload.deviceId} is running outside authorized hours!`;
          io.to(`user_${ownerId}`).emit('notification', {
            id: Date.now() + 10,
            type: 'CURFEW_VIOLATION',
            severity: 'warning',
            message: alertMsg,
            timestamp: Date.now(),
            is_read: false
          });
          global.curfewRunningAlerts.set(payload.deviceId, Date.now());
        }
      }

      // Curfew override tracking
      if (curfewLocked && vehicle.override_status === 'APPROVED_ONCE' && payload.speed > 0) {
        console.log(`[Curfew Override] Vehicle ${payload.deviceId} has started. Expiring APPROVED_ONCE override.`);
        db.prepare("UPDATE vehicles SET override_status = 'NONE', override_expires = 0 WHERE id = ?").run(payload.deviceId);
      }

      // Calculate distance delta and update odometer (only if GPS is valid)
      let newOdometer = vehicle.odometer_km || 0;
      const isGpsValid = payload.gpsValid !== false && payload.lat !== null && payload.lng !== null && payload.lat !== 0 && payload.lng !== 0;
      if (isGpsValid && vehicle.lat !== null && vehicle.lng !== null && vehicle.lat !== 0 && vehicle.lng !== 0) {
        const delta = getDistanceFromLatLonInKm(vehicle.lat, vehicle.lng, payload.lat, payload.lng);
        // Filter out GPS jumps (e.g. > 2km in 3 seconds)
        if (delta > 0 && delta <= 2) {
          newOdometer += delta;
        }
      }

      const finalLat = isGpsValid ? payload.lat : (vehicle.lat || 0);
      const finalLng = isGpsValid ? payload.lng : (vehicle.lng || 0);
      const finalSpeed = isGpsValid ? (payload.speed || 0) : 0;

      // Update the payload so that Socket.IO and shared tracking receive the correct filtered coordinates
      payload.lat = finalLat;
      payload.lng = finalLng;
      payload.speed = finalSpeed;

      // Update last_seen, battery_level, fuel_level, and is_locked in DB.
      // IMPORTANT: We do NOT update cloud_locked here — it is a web-only command
      // and must only change when the user presses LOCK/UNLOCK on the dashboard.
      // If we let the device overwrite it, the dashboard lock button would revert
      // every time the device sends a telemetry packet (every 2 seconds).
      try {
        const stmt = db.prepare('UPDATE vehicles SET last_seen = ?, battery_level = ?, fuel_level = ?, is_locked = ?, lat = ?, lng = ?, odometer_km = ?, beacon_rssi = ?, driver_present = ?, ignition = ? WHERE id = ?');
        stmt.run(Date.now(), payload.battery || 100, payload.fuel || 100, payload.locked ? 1 : 0, finalLat, finalLng, newOdometer, matchedRssi, driverPresent ? 1 : 0, payload.ignition ? 1 : 0, payload.deviceId);

        // Insert into vehicle_history in batches
        global.logVehicleHistory({
          vehicleId: payload.deviceId,
          timestamp: Date.now(),
          speed: finalSpeed,
          battery: payload.battery || 100,
          fuel: payload.fuel || 100,
          lat: finalLat,
          lng: finalLng
        });

        // --- Maintenance Alerts Notification Check ---
        try {
          const reminders = db.prepare(`
            SELECT * FROM maintenance_reminders
            WHERE vehicle_id = ? AND status = 'PENDING' AND alerted = 0
          `).all(payload.deviceId);

          for (const reminder of reminders) {
            let isDue = false;
            let limitStr = '';

            // Check distance threshold
            if (reminder.threshold_km !== null) {
              const limit = (reminder.last_service_km || 0) + reminder.threshold_km;
              if (newOdometer >= limit) {
                isDue = true;
                limitStr = `Limit: ${Math.round(limit)} km`;
              }
            }

            // Check date threshold (due_date)
            if (reminder.due_date !== null && Date.now() >= reminder.due_date) {
              isDue = true;
              const dateStr = new Date(reminder.due_date).toLocaleDateString();
              limitStr = limitStr ? `${limitStr}, Date: ${dateStr}` : `Date: ${dateStr}`;
            }

            if (isDue) {
              const limit = (reminder.last_service_km || 0) + (reminder.threshold_km || 0);

              // 1. Mark as alerted in database
              db.prepare('UPDATE maintenance_reminders SET alerted = 1 WHERE id = ?').run(reminder.id);

              // 2. Format alert message
              const alertMsg = `Maintenance Alert: ${reminder.type} is due on ${vehicle.name || payload.deviceId}! Current Odometer: ${Math.round(newOdometer)} km (${limitStr}).`;

              // 3. Persist alert
              saveAndNotifyAlert(payload.deviceId, 'MAINTENANCE_DUE', alertMsg, Date.now());

              // 4. Emit WebSocket notifications
              io.to(`user_${ownerId}`).emit('notification', {
                id: Date.now() + Math.floor(Math.random() * 1000),
                type: 'MAINTENANCE',
                message: alertMsg,
                timestamp: Date.now(),
                is_read: false
              });

              io.to(`user_${ownerId}`).emit('geofence-alert', {
                vehicleId: payload.deviceId,
                message: alertMsg,
                timestamp: Date.now()
              });

              // 5. Dispatch email notification to owner
              const owner = db.prepare('SELECT username, email FROM users WHERE id = ?').get(ownerId);
              if (owner && owner.email) {
                sendMaintenanceEmail(owner.email, owner.username, vehicle.name || payload.deviceId, reminder, newOdometer);
              }
            }
          }
        } catch (maintErr) {
          console.error("Maintenance check failed:", maintErr);
        }

        // --- Live Alerts Broker (Speeding, Low Battery, Low Fuel) ---
        if (!global.alertCooldowns) global.alertCooldowns = new Map();
        const now = Date.now();

        // 1. Speeding Check (>100 km/h)
        if (payload.speed > 100) {
          const speedKey = `${payload.deviceId}-speeding`;
          const lastSpeedAlert = global.alertCooldowns.get(speedKey);
          if (!lastSpeedAlert || (now - lastSpeedAlert > 300000)) { // 5 min cooldown
            const alertMsg = `Vehicle ${payload.deviceId} is speeding at ${payload.speed} km/h!`;
            
            io.to(`user_${ownerId}`).emit('notification', {
              id: now + 1,
              type: 'SPEED',
              message: alertMsg,
              timestamp: now,
              is_read: false
            });

            io.to(`user_${ownerId}`).emit('geofence-alert', {
              vehicleId: payload.deviceId,
              message: alertMsg,
              timestamp: now
            });

            global.alertCooldowns.set(speedKey, now);

            // Persist to vehicle_alerts
            saveAndNotifyAlert(payload.deviceId, 'SPEEDING', alertMsg, now);
          }
        }

        // 2. Low Battery Check (<20%)
        if (payload.battery && payload.battery < 20) {
          const battKey = `${payload.deviceId}-low-battery`;
          const lastBattAlert = global.alertCooldowns.get(battKey);
          if (!lastBattAlert || (now - lastBattAlert > 600000)) { // 10 min cooldown
            const alertMsg = `Warning: Vehicle ${payload.deviceId} battery is critical at ${payload.battery}%!`;
            
            io.to(`user_${ownerId}`).emit('notification', {
              id: now + 2,
              type: 'BATTERY',
              message: alertMsg,
              timestamp: now,
              is_read: false
            });

            io.to(`user_${ownerId}`).emit('geofence-alert', {
              vehicleId: payload.deviceId,
              message: alertMsg,
              timestamp: now
            });

            global.alertCooldowns.set(battKey, now);

            // Persist to vehicle_alerts
            saveAndNotifyAlert(payload.deviceId, 'LOW_BATTERY', alertMsg, now);
          }
        }

        // 3. Low Fuel Check (<15%)
        if (payload.fuel && payload.fuel < 15) {
          const fuelKey = `${payload.deviceId}-low-fuel`;
          const lastFuelAlert = global.alertCooldowns.get(fuelKey);
          if (!lastFuelAlert || (now - lastFuelAlert > 600000)) { // 10 min cooldown
            const alertMsg = `Warning: Vehicle ${payload.deviceId} fuel is low at ${payload.fuel}%!`;
            
            io.to(`user_${ownerId}`).emit('notification', {
              id: now + 3,
              type: 'FUEL',
              message: alertMsg,
              timestamp: now,
              is_read: false
            });

            io.to(`user_${ownerId}`).emit('geofence-alert', {
              vehicleId: payload.deviceId,
              message: alertMsg,
              timestamp: now
            });

            global.alertCooldowns.set(fuelKey, now);

            // Persist to vehicle_alerts
            saveAndNotifyAlert(payload.deviceId, 'LOW_FUEL', alertMsg, now);
          }
        }

        // 4. Dynamic Fuel Theft Detection (>10% drop in <60s while stopped)
        if (!global.fuelTracker) global.fuelTracker = new Map();
        const fuelRecord = global.fuelTracker.get(payload.deviceId);
        if (fuelRecord && payload.speed === 0 && fuelRecord.speed === 0) {
          const fuelDrop = fuelRecord.fuel - (payload.fuel || 100);
          const timeDiff = now - fuelRecord.timestamp;
          if (fuelDrop > 10 && timeDiff < 60000) {
            const theftKey = `${payload.deviceId}-fuel-theft-server`;
            const lastTheftAlert = global.alertCooldowns.get(theftKey);
            if (!lastTheftAlert || (now - lastTheftAlert > 120000)) { // 2 min cooldown
              const theftMsg = `Critical: Possible fuel theft on ${payload.deviceId}! Fuel dropped ${Math.round(fuelDrop)}% in ${Math.round(timeDiff / 1000)}s while stopped.`;
              io.to(`user_${ownerId}`).emit('notification', {
                id: now + 4,
                type: 'FUEL_THEFT',
                message: theftMsg,
                timestamp: now,
                is_read: false
              });
              io.to(`user_${ownerId}`).emit('geofence-alert', {
                vehicleId: payload.deviceId,
                message: theftMsg,
                timestamp: now
              });
              global.alertCooldowns.set(theftKey, now);
              saveAndNotifyAlert(payload.deviceId, 'FUEL_THEFT', theftMsg, now);
            }
          }
        }
        global.fuelTracker.set(payload.deviceId, { fuel: payload.fuel || 100, speed: payload.speed || 0, timestamp: now });

        // Check Geofences (supports both circle and polygon types)
        if (payload.lat && payload.lng) {
          const geofences = db.prepare('SELECT * FROM geofences WHERE vehicle_id = ?').all(payload.deviceId);

          if (!global.alertCooldowns) global.alertCooldowns = new Map();

          geofences.forEach(geo => {
            const alertKey = `${payload.deviceId}-${geo.id}`;
            let isOutside = false;

            if (geo.type === 'polygon' && geo.coordinates) {
              // Polygon geofence: use ray-casting
              try {
                const polygon = JSON.parse(geo.coordinates);
                isOutside = !isPointInPolygon({ lat: payload.lat, lng: payload.lng }, polygon);
              } catch (e) {
                console.error(`Invalid polygon coordinates for geofence ${geo.id}:`, e.message);
              }
            } else {
              // Circle geofence: use haversine distance
              const distance = getDistanceFromLatLonInKm(geo.lat, geo.lng, payload.lat, payload.lng) * 1000; // meters
              isOutside = distance > geo.radius;
            }

            if (isOutside) {
              // OUTSIDE - Alert only once upon transition from inside to outside
              if (global.alertCooldowns.get(alertKey) !== 'outside') {
                const geoNow = Date.now();
                const breachMsg = `Vehicle ${payload.deviceId} has left the safe zone "${geo.name || 'Geofence'}"!`;
                io.to(`user_${ownerId}`).emit('geofence-alert', {
                  vehicleId: payload.deviceId,
                  message: breachMsg,
                  timestamp: geoNow
                });

                // Emit Notification for Bell Icon
                io.to(`user_${ownerId}`).emit('notification', {
                  id: geoNow,
                  type: 'GEOFENCE',
                  message: breachMsg,
                  timestamp: geoNow,
                  is_read: false
                });
                console.log(`Geofence Breach: ${payload.deviceId}`);
                global.alertCooldowns.set(alertKey, 'outside'); // Mark as alerted outside

                // Persist to vehicle_alerts
                saveAndNotifyAlert(payload.deviceId, 'GEOFENCE_BREACH', breachMsg, geoNow);
              }
            } else {
              // INSIDE - Alert only once upon transition from outside to inside
              if (global.alertCooldowns.get(alertKey) === 'outside') {
                const geoNow = Date.now();
                const entryMsg = `Vehicle ${payload.deviceId} has entered the safe zone "${geo.name || 'Geofence'}"!`;
                io.to(`user_${ownerId}`).emit('geofence-alert', {
                  vehicleId: payload.deviceId,
                  message: entryMsg,
                  timestamp: geoNow
                });

                io.to(`user_${ownerId}`).emit('notification', {
                  id: geoNow,
                  type: 'GEOFENCE',
                  message: entryMsg,
                  timestamp: geoNow,
                  is_read: false
                });
                console.log(`Vehicle ${payload.deviceId} re-entered safe zone ${geo.id}`);
                global.alertCooldowns.set(alertKey, 'inside'); // Mark as inside

                // Persist to vehicle_alerts
                saveAndNotifyAlert(payload.deviceId, 'GEOFENCE_ENTRY', entryMsg, geoNow);
              } else if (!global.alertCooldowns.has(alertKey)) {
                global.alertCooldowns.set(alertKey, 'inside');
              }
            }
          });
        }

      } catch (dbErr) {
        console.error("DB Update/History Insert failed", dbErr);
      }

      broadcastDeviceData(payload.deviceId, topic, payload);

      // Broadcast to any active shared tracking viewers
      broadcastToSharedTrackers(payload.deviceId, payload.lat, payload.lng, payload.speed, payload.timestamp || Date.now());
    } catch (e) {
      console.error("Failed to parse MQTT payload", e);
    }
  }

  // 2. Handle Device Alerts from MQTT
  if (topic.startsWith('/device/') && topic.endsWith('/alert')) {
    try {
      const parts = topic.split('/');
      const deviceId = parts[2];
      const payload = JSON.parse(payloadStr);

      // Verify the vehicle exists and find its owner
      const vehicle = db.prepare(`
        SELECT v.owner_id, v.name, v.subscription_status, u.subscription_status AS user_subscription_status
        FROM vehicles v
        LEFT JOIN users u ON v.owner_id = u.id
        WHERE v.id = ?
      `).get(deviceId);
      if (!vehicle) {
        console.warn(`⚠️ Received alert for unregistered device: ${deviceId}`);
        return;
      }
      if (vehicle.subscription_status === 'SUSPENDED' || vehicle.user_subscription_status === 'SUSPENDED') {
        console.log(`[Subscription Policy] Suspended vehicle or owner for ${deviceId} alert ignored.`);
        return;
      }
      const ownerId = vehicle.owner_id;

      let notifType = payload.type || 'ALERT';

      // Cooldown Check: Ignore identical alert types from the same device within 5 minutes (300,000 ms)
      if (!global.alertCooldowns) global.alertCooldowns = new Map();
      const cooldownKey = `${deviceId}-${notifType}`;
      const lastAlertTime = global.alertCooldowns.get(cooldownKey);
      const nowMs = Date.now();
      if (lastAlertTime && (nowMs - lastAlertTime < 300000)) {
        console.log(`[Alert Broker] Cooldown active for ${notifType} on ${deviceId}. Skipping notification.`);
        return;
      }
      global.alertCooldowns.set(cooldownKey, nowMs);

      let alertMsg = payload.message || `Alert from device ${deviceId}: ${notifType}`;
      if (notifType === 'FUEL_THEFT') {
        alertMsg = `Warning: Fuel theft detected on vehicle ${deviceId}!`;
      } else if (notifType === 'DEVICE_TAMPERING') {
        alertMsg = `Critical: Device tampering detected on vehicle ${deviceId}!`;
      } else if (notifType === 'UNAUTHORIZED_START') {
        alertMsg = `Critical: Unauthorized start detected on vehicle ${deviceId}!`;
      } else if (notifType === 'START_ATTEMPT_BLOCKED') {
        // Double check: Is curfew actually active right now?
        const vCurfew = db.prepare('SELECT curfew_enabled, curfew_start, curfew_end, curfew_days, curfew_holiday_mode FROM vehicles WHERE id = ?').get(deviceId);
        
        let curfewActive = false;
        if (vCurfew && vCurfew.curfew_enabled === 1) {
          const now = new Date();
          const isAllowed = isWithinAllowedHours(now, vCurfew.curfew_start, vCurfew.curfew_end, vCurfew.curfew_days, vCurfew.curfew_holiday_mode);
          if (!isAllowed) {
            curfewActive = true;
          }
        }
        
        if (!curfewActive) {
          // Curfew is NOT active! Auto-correct by sending ALLOW_START and UNLOCK
          console.log(`[Curfew Policy] Received START_ATTEMPT_BLOCKED for ${deviceId} during allowed operating hours. Auto-unblocking.`);
          mqttClient.publish(`/device/${deviceId}/command`, JSON.stringify({ command: 'ALLOW_START' }));
          mqttClient.publish(`/device/${deviceId}/command`, JSON.stringify({ command: 'UNLOCK' }));
          return;
        }

        alertMsg = `Security: Engine start blocked outside authorized hours for vehicle ${deviceId}!`;
        
        // Log pending override request in override_requests table!
        // Get vehicle's driver_name
        const vInfo = db.prepare('SELECT driver_name, curfew_allow_override FROM vehicles WHERE id = ?').get(deviceId);
        const driverName = vInfo ? (vInfo.driver_name || 'Driver') : 'Driver';
        const allowOverride = vInfo ? vInfo.curfew_allow_override : 1;

        if (allowOverride === 1) {
          // Check if there is already a PENDING request for this vehicle to avoid duplicates
          const existing = db.prepare("SELECT id FROM override_requests WHERE vehicle_id = ? AND status = 'PENDING'").get(deviceId);
          if (!existing) {
            const stmt = db.prepare(`
              INSERT INTO override_requests (vehicle_id, driver_name, requested_at, status)
              VALUES (?, ?, ?, 'PENDING')
            `);
            const res = stmt.run(deviceId, driverName, Date.now());
            
            // Broadcast the override-request event to the manager
            io.to(`user_${ownerId}`).emit('override-request', {
              id: res.lastInsertRowid,
              vehicle_id: deviceId,
              vehicle_name: vehicle.name || deviceId,
              driver_name: driverName,
              requested_at: Date.now(),
              status: 'PENDING'
            });
          }
        }
      }

      const now = Date.now();

      // Emit Notification for Bell Icon
      io.to(`user_${ownerId}`).emit('notification', {
        id: now,
        type: notifType,
        message: alertMsg,
        timestamp: now,
        is_read: false
      });

      // Emit specific alert socket event
      io.to(`user_${ownerId}`).emit('device-alert', {
        vehicleId: deviceId,
        type: notifType,
        message: alertMsg,
        timestamp: now
      });

      // Persist alert to vehicle_alerts table for safety scoring and trigger notifications
      saveAndNotifyAlert(deviceId, notifType, alertMsg, now);

      console.log(`Alert processed for ${deviceId}: ${notifType}`);
    } catch (e) {
      console.error("Failed to parse MQTT alert payload", e);
    }
  }
});

// Helper to broadcast telemetry and lock status updates to the owner and all administrators for multi-browser sync
function broadcastDeviceData(deviceId, topic, payload) {
  try {
    const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(deviceId);
    if (!vehicle) return;

    const ownerId = vehicle.owner_id;
    const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all();

    // Emit to owner
    io.to(`user_${ownerId}`).emit('device-data', { topic, payload });

    // Emit to all admins
    for (const admin of admins) {
      if (admin.id !== ownerId) {
        io.to(`user_${admin.id}`).emit('device-data', { topic, payload });
      }
    }
  } catch (err) {
    console.error(`[Socket Broadcast Error] Failed to broadcast status update for ${deviceId}:`, err.message);
  }
}

// --- Multi-Protocol TCP Helper Functions ---

function reflect(val, bits) {
  let res = 0;
  for (let i = 0; i < bits; i++) {
    if ((val & (1 << i)) !== 0) {
      res |= (1 << (bits - 1 - i));
    }
  }
  return res;
}

function calculateGT06CRC(data) {
  let crc = 0xFFFF;
  const polynomial = 0x1021;

  for (let i = 0; i < data.length; i++) {
    let byte = data[i];
    byte = reflect(byte, 8);
    
    crc ^= (byte << 8);
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ polynomial) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return reflect(crc, 16) ^ 0xFFFF;
}

function calculateTeltonikaCRC(buffer) {
  let crc = 0x0000;
  const polynomial = 0xA001; // Reflected 0x8005

  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x0001) !== 0) {
        crc = (crc >> 1) ^ polynomial;
      } else {
        crc >>= 1;
      }
    }
  }
  return crc & 0xFFFF;
}

function buildTeltonikaCodec12Frame(commandText) {
  const cmdBuffer = Buffer.from(commandText, 'ascii');
  const cmdLength = cmdBuffer.length;
  const payloadSize = 8 + cmdLength;
  const payload = Buffer.alloc(payloadSize);

  payload[0] = 0x0C; // Codec ID (Codec 12)
  payload[1] = 0x01; // Quantity of Commands 1
  payload[2] = 0x05; // Type (0x05 for custom command)
  payload.writeUInt32BE(cmdLength, 3); // Command size (4 bytes BE)
  cmdBuffer.copy(payload, 7); // Copy ASCII bytes of command string
  payload[7 + cmdLength] = 0x01; // Quantity of Commands 2 (repeat)

  const crc = calculateTeltonikaCRC(payload);
  const frame = Buffer.alloc(12 + payloadSize);

  frame.writeUInt32BE(0, 0); // Preamble (4 zero bytes)
  frame.writeUInt32BE(payloadSize, 4); // Data Field Length (4 bytes BE)
  payload.copy(frame, 8); // Copy Payload
  frame.writeUInt32BE(crc, 8 + payloadSize); // CRC (4 bytes BE, zero-padded, calculated CRC is 2 bytes, writeUInt32BE zero-pads on left)

  return frame;
}

function buildGT06CommandFrame(commandText) {
  const cmdBytes = Buffer.from(commandText, 'ascii');
  const serverFlag = Buffer.from([0x00, 0x00, 0x00, 0x01]); // 4 bytes
  const language = Buffer.from([0x00, 0x02]); // 2 bytes (English)
  const serialNo = Buffer.from([0x00, 0x01]); // 2 bytes
  
  // Information content length = serverFlag (4) + cmdBytes (M) = 4 + M
  const infoLenByte = Buffer.from([4 + cmdBytes.length]);
  
  // Assemble info content: infoLenByte (1) + serverFlag (4) + cmdBytes (M) + language (2)
  const infoContent = Buffer.concat([infoLenByte, serverFlag, cmdBytes, language]);
  
  // Package Length = Agreement (1) + InfoContent (7+M) + SerialNo (2) = 10 + M
  const packageLenByte = Buffer.from([1 + infoContent.length + 2]);
  
  // Assemble the body for CRC calculation: Package Length + Agreement + InfoContent + SerialNo
  const crcBody = Buffer.concat([packageLenByte, Buffer.from([0x80]), infoContent, serialNo]);
  
  const crcVal = calculateGT06CRC(crcBody);
  const crcBytes = Buffer.alloc(2);
  crcBytes.writeUInt16BE(crcVal, 0);
  
  // Complete frame: Start Bit (2) + crcBody + CRC (2) + Stop Bit (2)
  const frame = Buffer.concat([
    Buffer.from([0x78, 0x78]),
    crcBody,
    crcBytes,
    Buffer.from([0x0D, 0x0A])
  ]);
  
  return frame;
}

// Unified Security Alert Evaluator (For direct TCP and Traccar/MQTT)
function evaluateSecurityAlerts(deviceId, vehicle, ignition, speed, driverPresent, curfewLocked, isLocked, nowMs, ownerId) {
  if (!global.alertCooldowns) global.alertCooldowns = new Map();

  // 1. Hotwiring / Unauthorized Startup Detection Alert
  // Only fire when cloud_locked=1 or curfew is active — not just because BLE is absent.
  // (BLE absence alone while web-unlocked is a normal scenario, not a security breach.)
  if (ignition === 1 && isLocked === 1 && (vehicle.cloud_locked === 1 || curfewLocked)) {
    const hotwireKey = `${deviceId}-hotwire`;
    const lastHotwire = global.alertCooldowns.get(hotwireKey);
    if (!lastHotwire || (nowMs - lastHotwire > 300000)) { // 5 min cooldown
      const cause = curfewLocked ? 'curfew locked' : 'cloud locked';

      const alertMsg = `Critical Security: Hotwiring / Unauthorized startup detected on vehicle "${vehicle.name || deviceId}"! ACC turned ON while vehicle is ${cause}.`;
      console.warn(`[SECURITY ALERT] ${alertMsg}`);

      saveAndNotifyAlert(deviceId, 'THEFT_HOTWIRE', alertMsg, nowMs);

      io.to(`user_${ownerId}`).emit('notification', {
        id: nowMs + 10,
        type: 'THEFT',
        severity: 'error',
        message: alertMsg,
        timestamp: nowMs,
        is_read: false
      });
      io.to(`user_${ownerId}`).emit('device-alert', {
        vehicleId: deviceId,
        type: 'DEVICE_TAMPERING',
        message: alertMsg,
        timestamp: nowMs
      });

      global.alertCooldowns.set(hotwireKey, nowMs);
    }
  }

  // 2. Towing / Unauthorized Movement Detection Alert
  // Only fire when cloud_locked=1 or curfew is active — not just BLE absence.
  if (ignition === 0 && speed > 2 && isLocked === 1 && (vehicle.cloud_locked === 1 || curfewLocked)) {
    const towingKey = `${deviceId}-towing`;
    const lastTowing = global.alertCooldowns.get(towingKey);
    if (!lastTowing || (nowMs - lastTowing > 300000)) { // 5 min cooldown
      const cause = curfewLocked ? 'curfew locked' : 'cloud locked';

      const alertMsg = `Critical Alert: Towing / Unauthorized movement detected on vehicle "${vehicle.name || deviceId}"! Vehicle moving (${speed} km/h) with ignition OFF while ${cause}.`;
      console.warn(`[SECURITY ALERT] ${alertMsg}`);

      saveAndNotifyAlert(deviceId, 'THEFT_TOWING', alertMsg, nowMs);

      io.to(`user_${ownerId}`).emit('notification', {
        id: nowMs + 11,
        type: 'THEFT',
        severity: 'error',
        message: alertMsg,
        timestamp: nowMs,
        is_read: false
      });
      io.to(`user_${ownerId}`).emit('device-alert', {
        vehicleId: deviceId,
        type: 'DEVICE_TAMPERING',
        message: alertMsg,
        timestamp: nowMs
      });

      global.alertCooldowns.set(towingKey, nowMs);
    }
  }

  // 3. Unauthorized Movement Alert (movement without BLE keyfob)
  // ONLY fire if a BLE beacon is actually configured for this vehicle.
  // If no beacon is configured, BLE guard is disabled entirely.
  if (vehicle.ble_beacon_id && !driverPresent && (ignition === 1 || speed > 2)) {
    const alertType = 'UNAUTHORIZED_MOVEMENT';
    const alertMsg = `Critical Alert: Unauthorized movement detected on vehicle "${vehicle.name || deviceId}" without the authorized BLE Beacon keyfob!`;
    const alertCooldownKey = `${deviceId}_${alertType}`;

    if (!global.alertCooldowns.has(alertCooldownKey) || nowMs - global.alertCooldowns.get(alertCooldownKey) > 300000) {
      global.alertCooldowns.set(alertCooldownKey, nowMs);
      try {
        saveAndNotifyAlert(deviceId, alertType, alertMsg, nowMs);

        mqttClient.publish(`/device/${deviceId}/alert`, JSON.stringify({
          deviceId,
          type: alertType,
          message: alertMsg,
          timestamp: nowMs
        }));

        io.to(`user_${ownerId}`).emit('notification', {
          id: nowMs + 12,
          type: 'THEFT',
          severity: 'error',
          message: alertMsg,
          timestamp: nowMs,
          is_read: false
        });
        io.to(`user_${ownerId}`).emit('device-alert', {
          vehicleId: deviceId,
          type: 'UNAUTHORIZED_MOVEMENT',
          message: alertMsg,
          timestamp: nowMs
        });
        console.log(`[Alert Engine] Dispatched UNAUTHORIZED_MOVEMENT alert for ${deviceId}`);
      } catch (err) {
        console.error('[Alert Engine] Failed to record unauthorized movement alert:', err.message);
      }
    }
  }
}

function handleIncomingTelemetry(deviceId, lat, lng, speed, battery, fuel, ignition, rawBleList = '', dout1 = null) {
  const nowMs = Date.now();
  const vehicle = global.getVehicleMetadata(deviceId);

  if (!vehicle) return null;
  const ownerId = vehicle.owner_id;

  if (vehicle.subscription_status === 'SUSPENDED' || vehicle.user_subscription_status === 'SUSPENDED') {
    console.log(`[Subscription Policy] Suspended vehicle or owner for ${deviceId} TCP telemetry ignored.`);
    return null;
  }

  // Parse BLE Beacons if provided
  const bleBeacons = [];
  if (rawBleList) {
    rawBleList.split(';').forEach(pair => {
      const [mac, rssi] = pair.split(':');
      if (mac && rssi) {
        bleBeacons.push({ mac: mac.trim(), rssi: parseInt(rssi.trim()) });
      }
    });
  }

  if (!global.lastBeaconSeen) global.lastBeaconSeen = new Map();
  if (!global.lastMovingTime) global.lastMovingTime = new Map();

  // Track last time this vehicle was seen moving
  if (speed > 0) {
    global.lastMovingTime.set(deviceId, nowMs);
  }
  const lastMoving = global.lastMovingTime.get(deviceId) || 0;
  const wasMovingRecently = (nowMs - lastMoving) < 5 * 60 * 1000; // 5-minute window

  // Proximity check (driver presence)
  let driverPresent = false;
  let matchedRssi = null;
  if (vehicle.ble_beacon_id) {
    const normalizedBeaconId = vehicle.ble_beacon_id.replace(/:/g, '').toUpperCase();
    const matchedTag = bleBeacons.find(b => {
      const cleanMac = b.mac.replace(/:/g, '').toUpperCase().replace(/^0+/, '');
      const cleanDb = normalizedBeaconId.replace(/^0+/, '');
      return cleanMac === cleanDb || cleanMac.endsWith(cleanDb) || cleanDb.endsWith(cleanMac);
    });
    if (matchedTag) {
      matchedRssi = matchedTag.rssi;
      const aboveThreshold = matchedTag.rssi >= vehicle.ble_beacon_rssi_threshold;
      if (aboveThreshold) {
        global.lastBeaconSeen.set(deviceId, nowMs);
        driverPresent = true;
      }
    }

    // GRACE PERIOD: 3-minute window
    const lastSeen = global.lastBeaconSeen.get(deviceId) || 0;
    const beaconSeenRecently = (nowMs - lastSeen) < 3 * 60 * 1000;
    if (!driverPresent && beaconSeenRecently) {
      driverPresent = true;
    }

    // MOVING GRACE: 5-minute window
    if (!driverPresent && wasMovingRecently) {
      driverPresent = true;
    }
  } else {
    driverPresent = true;
  }

  // Curfew validation
  let curfewLocked = false;
  if (vehicle.curfew_enabled === 1) {
    const now = new Date();
    const isAllowed = isWithinAllowedHours(now, vehicle.curfew_start, vehicle.curfew_end, vehicle.curfew_days, vehicle.curfew_holiday_mode);
    if (!isAllowed) {
      let hasOverride = false;
      if (vehicle.override_status === 'APPROVED_MIDNIGHT' || vehicle.override_status === 'APPROVED_ONCE') {
        if (Date.now() < vehicle.override_expires) {
          hasOverride = true;
        }
      }
      if (!hasOverride) {
        curfewLocked = true;
      }
    }
  }

  // ── Web/Curfew = master switch for dashboard badge AND physical relay ──────
  // ── BLE = startup-only guard, NEVER overwrites the web lock state in DB ───
  const isWebOrCurfewLocked = (vehicle.cloud_locked === 1 || curfewLocked);

  // Dashboard badge / DB column: ONLY reflects cloud_locked + curfew.
  // BLE missing must NOT set is_locked=1 in the DB — that was causing the
  // "always ARMED on refresh" bug because telemetry kept overwriting it.
  let isLocked = isWebOrCurfewLocked ? 1 : 0;

  // Physical relay desired state
  // 0 = de-energized / wire cut  → engine blocked
  // 1 = energized / wire reconnected → engine allowed
  let desiredRelayState = 0;

  if (ignition === 1) {
    if (isWebOrCurfewLocked) {
      // Web/curfew lock: always cut the wire regardless of BLE or speed
      desiredRelayState = 0;
    } else if (!driverPresent) {
      // Web is UNLOCKED but BLE keyfob is missing
      if (speed <= 2) {
        // Stationary: block startup — keyfob must be present to start
        desiredRelayState = 0;
      } else {
        // Moving: keep relay energized — BLE signal can fluctuate, never cut engine
        desiredRelayState = 1;
      }
    } else {
      // Web UNLOCKED + BLE present (or no BLE configured) → energize relay
      desiredRelayState = 1;
    }
  } else {
    // ACC/Ignition OFF: de-energize relay to save vehicle battery
    desiredRelayState = 0;
  }

  // Send command ONLY when physical state differs from desired state
  const currentRelay = (dout1 !== null) ? dout1 : (vehicle.relay_state || 0);
  if (currentRelay !== desiredRelayState) {
    const cmdText = `setdigout ${desiredRelayState}`;
    console.log(`[Relay Controller] Vehicle ${deviceId}: DOUT1 current=${currentRelay} desired=${desiredRelayState} ignition=${ignition} speed=${speed} webLocked=${isWebOrCurfewLocked} blePresent=${driverPresent} → ${cmdText}`);
    
    // Dynamically route the command depending on device connection type
    const isDirectSocket = DeviceManager.getStatus(deviceId) === 'ONLINE';
    if (isDirectSocket) {
      DeviceManager.sendCommand(deviceId, cmdText);
    } else {
      sendTraccarCommand(deviceId, cmdText);
    }
  }

  // Evaluate security alerts (Hotwire, Towing, and Unauthorized Movement)
  evaluateSecurityAlerts(deviceId, vehicle, ignition, speed, driverPresent, curfewLocked, isLocked, nowMs, ownerId);


  // Odometer calculation
  let newOdometer = vehicle.odometer_km || 0;
  if (vehicle.lat !== null && vehicle.lng !== null && vehicle.lat !== 0 && vehicle.lng !== 0 &&
      lat !== null && lng !== null && lat !== 0 && lng !== 0) {
    const delta = getDistanceFromLatLonInKm(vehicle.lat, vehicle.lng, lat, lng);
    if (delta > 0 && delta <= 2) {
      newOdometer += delta;
    }
  }

  // Update database
  try {
    if (dout1 !== null) {
      db.prepare('UPDATE vehicles SET last_seen = ?, battery_level = ?, fuel_level = ?, is_locked = ?, lat = ?, lng = ?, odometer_km = ?, relay_state = ?, relay_updated_at = ?, ignition = ? WHERE id = ?')
        .run(nowMs, battery || 100, fuel || 100, isLocked, lat || 0, lng || 0, newOdometer, dout1, nowMs, ignition, deviceId);

      // Perform command lifecycle confirmation if state matches expectation
      const pendingCmd = db.prepare(`
        SELECT id, command, sent_at FROM device_commands
        WHERE vehicle_id = ? AND status IN ('SENT', 'DELIVERED')
        ORDER BY sent_at DESC LIMIT 1
      `).get(deviceId);

      if (pendingCmd) {
        // If command is lock ('setdigout 1'), expected DOUT is 1
        // If command is unlock ('setdigout 0'), expected DOUT is 0
        const expectedDout = pendingCmd.command.includes('setdigout 1') ? 1 : 0;
        if (dout1 === expectedDout) {
          const latencyMs = nowMs - pendingCmd.sent_at;
          db.prepare(`
            UPDATE device_commands
            SET status = 'CONFIRMED', ack_at = ?, latency_ms = ?
            WHERE id = ?
          `).run(nowMs, latencyMs, pendingCmd.id);
          console.log(`[Telemetry Confirmation] ✅ Confirmed command ID ${pendingCmd.id} executed successfully. Latency: ${latencyMs}ms`);
        }
      }
    } else {
      db.prepare('UPDATE vehicles SET last_seen = ?, battery_level = ?, fuel_level = ?, is_locked = ?, lat = ?, lng = ?, odometer_km = ?, ignition = ? WHERE id = ?')
        .run(nowMs, battery || 100, fuel || 100, isLocked, lat || 0, lng || 0, newOdometer, ignition, deviceId);
    }

    // Batch write history
    global.logVehicleHistory({
      vehicleId: deviceId,
      timestamp: nowMs,
      speed: speed || 0,
      battery: battery || 100,
      fuel: fuel || 100,
      lat: lat || 0,
      lng: lng || 0
    });
  } catch (dbErr) {
    console.error('[TCP DB] Failed to save telematics record:', dbErr.message);
  }

  // Update frontend
  broadcastDeviceData(deviceId, `/device/${deviceId}/status`, {
    deviceId,
    lat,
    lng,
    speed,
    battery,
    fuel,
    locked: isLocked === 1,
    ignition: ignition === 1 ? 1 : 0,
    timestamp: nowMs
  });

  // Broadcast to any active shared tracking viewers
  broadcastToSharedTrackers(deviceId, lat, lng, speed, nowMs);

  return { isLocked };
}

// --- TCP Telematics Ingestion Server (Multi-Protocol support) ---
const activeTcpSockets = new Map(); // Maps deviceId -> net.Socket
app.set('activeTcpSockets', activeTcpSockets);
DeviceManager.init(activeTcpSockets, buildTeltonikaCodec12Frame, buildGT06CommandFrame);
RelayManager.init(DeviceManager, sendTraccarCommand);

const TCP_PORT = process.env.PORT_TCP || 5000;
const tcpServer = net.createServer((socket) => {
  let authenticatedDeviceId = null;
  let deviceType = null; // 'custom', 'gt06', 'teltonika'
  let buffer = Buffer.alloc(0);

  console.log(`🔌 New TCP connection from: ${socket.remoteAddress}:${socket.remotePort}`);

  socket.on('data', (data) => {
    buffer = Buffer.concat([buffer, data]);
    let processedLength = 0;

    while (buffer.length - processedLength >= 2) {
      // 1. Custom ASCII simulator protocol ($$)
      if (buffer[processedLength] === 0x24 && buffer[processedLength + 1] === 0x24) {
        const newlineIndex = buffer.indexOf('\n', processedLength);
        if (newlineIndex === -1) break; // wait for full line

        const rawLine = buffer.subarray(processedLength, newlineIndex).toString().trim();
        processedLength = newlineIndex + 1;

        if (!rawLine) continue;

        const parts = rawLine.substring(2).split(',');
        const packetType = parts[0];
        const deviceId = parts[1];

        if (!deviceId) {
          console.warn(`[TCP Parser] Missing DeviceID in packet: ${rawLine}`);
          continue;
        }

        if (packetType === 'LOGIN') {
          const password = parts[2];
          const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(deviceId);
          if (!vehicle) {
            console.warn(`[TCP Auth] Connection attempt for unregistered Device: ${deviceId}`);
            socket.write(`$$LOGIN,FAIL,Unregistered\r\n`);
            socket.destroy();
            return;
          }

          authenticatedDeviceId = deviceId;
          deviceType = 'custom';
          socket.deviceType = 'custom';
          DeviceManager.registerSocket(deviceId, socket);
          console.log(`[TCP Auth] Custom Device ${deviceId} authenticated.`);
          socket.write(`$$LOGIN,OK\r\n`);

          const currentConfig = db.prepare('SELECT cloud_locked, ble_beacon_id, ble_beacon_rssi_threshold FROM vehicles WHERE id = ?').get(deviceId);
          if (currentConfig) {
            socket.write(`$$CMD,${deviceId},SET_CLOUDLOCKED,${currentConfig.cloud_locked}\r\n`);
            if (currentConfig.ble_beacon_id) {
              socket.write(`$$CMD,${deviceId},SET_BLE_BEACON,${currentConfig.ble_beacon_id},${currentConfig.ble_beacon_rssi_threshold}\r\n`);
            }
          }
        } 
        
        else if (packetType === 'DATA') {
          if (authenticatedDeviceId !== deviceId) {
            console.warn(`[TCP Security] Data packet from unauthenticated socket for Device: ${deviceId}`);
            socket.write(`$$ERROR,Unauthenticated\r\n`);
            socket.destroy();
            return;
          }

          const lat = parseFloat(parts[2]);
          const lng = parseFloat(parts[3]);
          const speed = parseFloat(parts[4]);
          const battery = parseInt(parts[5]);
          const fuel = parseInt(parts[6]);
          const ignition = parseInt(parts[7]);
          const rawBleList = parts[8] || '';

          handleIncomingTelemetry(deviceId, lat, lng, speed, battery, fuel, ignition, rawBleList);
          socket.write(`$$DATA,OK\r\n`);
        }
      }

      // 2. Concox GT06 protocol (0x78 0x78 or 0x79 0x79)
      else if ((buffer[processedLength] === 0x78 && buffer[processedLength + 1] === 0x78) ||
               (buffer[processedLength] === 0x79 && buffer[processedLength + 1] === 0x79)) {
        
        if (buffer.length - processedLength < 6) break;

        const isExtended = buffer[processedLength] === 0x79;
        const length = isExtended 
          ? buffer.readUInt16BE(processedLength + 2) 
          : buffer[processedLength + 2];
        const packetLength = length + (isExtended ? 6 : 5);

        if (buffer.length - processedLength < packetLength) break;

        const packet = buffer.subarray(processedLength, processedLength + packetLength);
        processedLength += packetLength;

        try {
          const lengthOffset = isExtended ? 4 : 3;
          const protocolNumber = packet[lengthOffset];
          const serialNumber = packet.readUInt16BE(packetLength - 4);

          // 0x01: Login Message
          if (protocolNumber === 0x01) {
            let imei = "";
            const imeiOffset = isExtended ? 1 : 0;
            for (let i = 0; i < 8; i++) {
              const byte = packet[4 + imeiOffset + i];
              imei += ((byte >> 4) & 0x0F).toString(16) + (byte & 0x0F).toString(16);
            }
            if (imei.startsWith('0')) imei = imei.substring(1);

            console.log(`[GT06 TCP] Login attempt from IMEI: ${imei}`);
            const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(imei);
            if (!vehicle) {
              console.warn(`[GT06 TCP] Login rejected: IMEI ${imei} not registered.`);
              socket.destroy();
              return;
            }

            authenticatedDeviceId = imei;
            deviceType = 'gt06';
            socket.deviceType = 'gt06';
            DeviceManager.registerSocket(imei, socket);
            console.log(`[GT06 TCP] Device ${imei} authenticated.`);

            // Response ACK
            const response = Buffer.from([0x78, 0x78, 0x05, 0x01, packet[packetLength - 4], packet[packetLength - 3], 0x00, 0x00, 0x0D, 0x0A]);
            const responseCrc = calculateGT06CRC(response.subarray(2, 6));
            response.writeUInt16BE(responseCrc, 6);
            socket.write(response);
          }

          // 0x12, 0x16, 0x22, 0x31, 0x32: Location Data / Alarm Data Message
          else if (protocolNumber === 0x12 || protocolNumber === 0x16 || protocolNumber === 0x22 || protocolNumber === 0x31 || protocolNumber === 0x32) {
            if (!authenticatedDeviceId) {
              console.warn(`[GT06 TCP] Location/Alarm packet received before Login.`);
              socket.destroy();
              return;
            }

            const offset = isExtended ? 1 : 0;
            const rawLat = packet.readUInt32BE(11 + offset);
            const rawLng = packet.readUInt32BE(15 + offset);
            let lat = rawLat / 1800000.0;
            let lng = rawLng / 1800000.0;
            const speed = packet[19 + offset];

            const byteCourseStatus = packet[20 + offset];
            const isNorth = (byteCourseStatus & 0x04) !== 0;
            const isWest = (byteCourseStatus & 0x08) !== 0;

            if (!isNorth) lat = -lat;
            if (isWest) lng = -lng;

            // Determine if ignition is ON/OFF
            let ignition = 1; // Default to ON for basic location updates
            
            // For standard alarm packets (0x16), status is at 31 + offset.
            // For 0x31 and 0x32 packets, ACC status is directly at offset 32 + offset.
            if (protocolNumber === 0x16 && packet.length > 31 + offset) {
              const terminalInfo = packet[31 + offset];
              ignition = (terminalInfo & 0x02) !== 0 ? 1 : 0;
            } else if ((protocolNumber === 0x31 || protocolNumber === 0x32) && packet.length > 32 + offset) {
              ignition = packet[32 + offset] === 0x01 ? 1 : 0;
            }

            console.log(`[GT06 TCP] Location for ${authenticatedDeviceId} (Protocol 0x${protocolNumber.toString(16)}): Lat=${lat}, Lng=${lng}, Speed=${speed}, Ignition=${ignition}`);
            handleIncomingTelemetry(authenticatedDeviceId, lat, lng, speed, 100, 100, ignition);

            // Response ACK
            const response = Buffer.from([0x78, 0x78, 0x05, protocolNumber, packet[packetLength - 4], packet[packetLength - 3], 0x00, 0x00, 0x0D, 0x0A]);
            const responseCrc = calculateGT06CRC(response.subarray(2, 6));
            response.writeUInt16BE(responseCrc, 6);
            socket.write(response);
          }

          // 0x13: Status / Heartbeat Message
          else if (protocolNumber === 0x13) {
            if (authenticatedDeviceId) {
              const offset = isExtended ? 1 : 0;
              const terminalInfo = packet[4 + offset];
              const ignition = (terminalInfo & 0x02) !== 0 ? 1 : 0;
              const batLevel = packet[5 + offset];
              const battery = Math.min(100, Math.round((batLevel / 6.0) * 100));

              // Fetch last known lat/lng from database to avoid overwriting with 0
              const vehicle = db.prepare('SELECT lat, lng FROM vehicles WHERE id = ?').get(authenticatedDeviceId);
              const lastLat = vehicle ? vehicle.lat : 0;
              const lastLng = vehicle ? vehicle.lng : 0;

              console.log(`[GT06 TCP] Heartbeat status for ${authenticatedDeviceId}: Ignition=${ignition}, Battery=${battery}%`);
              handleIncomingTelemetry(authenticatedDeviceId, lastLat, lastLng, 0, battery, 100, ignition);
            }

            // Response ACK
            const response = Buffer.from([0x78, 0x78, 0x05, 0x13, packet[packetLength - 4], packet[packetLength - 3], 0x00, 0x00, 0x0D, 0x0A]);
            const responseCrc = calculateGT06CRC(response.subarray(2, 6));
            response.writeUInt16BE(responseCrc, 6);
            socket.write(response);
          }
        } catch (gtErr) {
          console.error(`[GT06 TCP] Packet parse error:`, gtErr.message);
        }
      }

      // 3. Teltonika IMEI Login packet (starts with 0x00, followed by length 10-20)
      else if (!authenticatedDeviceId && 
               buffer[processedLength] === 0x00 && 
               buffer[processedLength + 1] >= 10 && 
               buffer[processedLength + 1] <= 20 &&
               buffer.length - processedLength >= buffer[processedLength + 1] + 2) {
        
        const imeiLen = buffer[processedLength + 1];
        const packetLength = imeiLen + 2;
        const imeiStr = buffer.subarray(processedLength + 2, processedLength + packetLength).toString('ascii');

        if (/^\d+$/.test(imeiStr)) {
          processedLength += packetLength;
          console.log(`[Teltonika TCP] Login attempt from IMEI: ${imeiStr}`);

          const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(imeiStr);
          if (!vehicle) {
            console.warn(`[Teltonika TCP] Login rejected: IMEI ${imeiStr} not registered.`);
            socket.write(Buffer.from([0x00]));
            socket.destroy();
            return;
          }

          authenticatedDeviceId = imeiStr;
          deviceType = 'teltonika';
          socket.deviceType = 'teltonika';
          DeviceManager.registerSocket(imeiStr, socket);
          console.log(`[Teltonika TCP] Device ${imeiStr} authenticated.`);
          socket.write(Buffer.from([0x01])); // Accept connection
        } else {
          processedLength += 1;
        }
      }

      // 4. Teltonika Codec 8 / 8E binary data packets (4 zeros + 4 length)
      else if (buffer.length - processedLength >= 12 && 
               buffer.readUInt32BE(processedLength) === 0x00000000) {
        
        const dataLength = buffer.readUInt32BE(processedLength + 4);
        const packetLength = dataLength + 12;

        if (buffer.length - processedLength < packetLength) break; // wait for full packet

        const packet = buffer.subarray(processedLength, processedLength + packetLength);
        processedLength += packetLength;

        try {
          if (!authenticatedDeviceId) {
            console.warn(`[Teltonika TCP] Data packet received before login.`);
            socket.destroy();
            return;
          }

          const codecId = packet[8];
          if (codecId === 0x0C) {
            const respLength = packet.readUInt32BE(11);
            const responseText = packet.subarray(15, 15 + respLength).toString('ascii').trim();
            console.log(`[Teltonika TCP] Received Codec 12 Response from ${authenticatedDeviceId}: "${responseText}"`);
            
            // Check if response contains setdigout feedback and update DB is_locked / socket status if needed
            // e.g. "DOUT1:1" or "DOUT1:0"
            const isUnlockResponse = responseText.includes('DOUT1:1') || responseText.includes('DOUT1:Already set to 1');
            const isLockResponse = responseText.includes('DOUT1:0') || responseText.includes('DOUT1:Already set to 0');
            
            if (isUnlockResponse || isLockResponse) {
              const lockedState = isLockResponse ? 1 : 0;
              db.prepare('UPDATE vehicles SET is_locked = ? WHERE id = ?').run(lockedState, authenticatedDeviceId);
              if (global.invalidateMetadataCache) global.invalidateMetadataCache(authenticatedDeviceId);
              console.log(`[Teltonika TCP] Confirmed relay state from response. is_locked is now ${lockedState}`);
              
              // Broadcast lock change update to all browser windows
              broadcastDeviceData(authenticatedDeviceId, `/device/${authenticatedDeviceId}/status`, {
                deviceId: authenticatedDeviceId,
                locked: lockedState === 1,
                          let lastLat = null;
            let lastLng = null;
            let lastSpeed = null;
            let lastIgnition = 0;
            let lastDout1 = null;
            let lastAin1 = null;
            
            // BLE Beacon state
            let lastTag1Mac = null;
            let lastTag1Rssi = null;
            let lastTag2Mac = null;
            let lastTag2Rssi = null;
            let lastTag3Mac = null;
            let lastTag3Rssi = null;
            let lastTag4Mac = null;
            let lastTag4Rssi = null;

            for (let r = 0; r < numRecords; r++) {
              if (offset + 15 > packet.length) break;

              // Timestamp (8 bytes)
              const tsMs = Number(packet.readBigUInt64BE(offset));
              offset += 8;

              // Priority (1 byte)
              const priority = packet[offset];
              offset += 1;

              // GPS Element (15 bytes)
              const rawLng = packet.readInt32BE(offset);
              const rawLat = packet.readInt32BE(offset + 4);
              const altitude = packet.readInt16BE(offset + 8);
              const angle = packet.readInt16BE(offset + 10);
              const satellites = packet[offset + 12];
              const speed = packet.readInt16BE(offset + 13);

              lastLng = rawLng / 10000000.0;
              lastLat = rawLat / 10000000.0;
              lastSpeed = speed;

              offset += 15;

              // I/O Element (Variable length)
              const isExtended = codecId === 0x8E;
              const eventId = isExtended ? packet.readUInt16BE(offset) : packet[offset];
              offset += isExtended ? 2 : 1;

              const totalIoCount = isExtended ? packet.readUInt16BE(offset) : packet[offset];
              offset += isExtended ? 2 : 1;

              // 1-byte properties
              const io1Count = isExtended ? packet.readUInt16BE(offset) : packet[offset];
              offset += isExtended ? 2 : 1;
              for (let i = 0; i < io1Count; i++) {
                const propId = isExtended ? packet.readUInt16BE(offset) : packet[offset];
                offset += isExtended ? 2 : 1;
                const val = packet[offset];
                offset += 1;

                if (propId === 239 || propId === 1) { // ACC/Ignition
                  lastIgnition = val;
                } else if (propId === 179) { // DOUT1 (Relay output status)
                  lastDout1 = val;
                } else if (propId === 10828) { // Tag 1 RSSI
                  lastTag1Rssi = val > 127 ? val - 256 : val;
                } else if (propId === 10831) { // Tag 2 RSSI
                  lastTag2Rssi = val > 127 ? val - 256 : val;
                } else if (propId === 10834) { // Tag 3 RSSI
                  lastTag3Rssi = val > 127 ? val - 256 : val;
                } else if (propId === 10837) { // Tag 4 RSSI
                  lastTag4Rssi = val > 127 ? val - 256 : val;
                }
              }

              // 2-byte properties
              const io2Count = isExtended ? packet.readUInt16BE(offset) : packet[offset];
              offset += isExtended ? 2 : 1;
              for (let i = 0; i < io2Count; i++) {
                const propId = isExtended ? packet.readUInt16BE(offset) : packet[offset];
                offset += isExtended ? 2 : 1;
                const val = packet.readUInt16BE(offset);
                offset += 2;

                if (propId === 9) {
                  lastAin1 = val; // AIN1 (mV)
                }
              }

              // 4-byte properties
              const io4Count = isExtended ? packet.readUInt16BE(offset) : packet[offset];
              offset += isExtended ? 2 : 1;
              for (let i = 0; i < io4Count; i++) {
                const propId = isExtended ? packet.readUInt16BE(offset) : packet[offset];
                offset += isExtended ? 2 : 1;
                offset += 4;
              }

              // 8-byte properties
              const io8Count = isExtended ? packet.readUInt16BE(offset) : packet[offset];
              offset += isExtended ? 2 : 1;
              for (let i = 0; i < io8Count; i++) {
                const propId = isExtended ? packet.readUInt16BE(offset) : packet[offset];
                offset += isExtended ? 2 : 1;
                const valBuf = packet.subarray(offset, offset + 8);
                offset += 8;

                if (propId === 10827) { // Tag 1 MAC
                  lastTag1Mac = valBuf.toString('hex').replace(/^0+/, '').toLowerCase();
                } else if (propId === 10830) { // Tag 2 MAC
                  lastTag2Mac = valBuf.toString('hex').replace(/^0+/, '').toLowerCase();
                } else if (propId === 10833) { // Tag 3 MAC
                  lastTag3Mac = valBuf.toString('hex').replace(/^0+/, '').toLowerCase();
                } else if (propId === 10836) { // Tag 4 MAC
                  lastTag4Mac = valBuf.toString('hex').replace(/^0+/, '').toLowerCase();
                }
              }

              // X-byte (variable length) properties (Codec 8E / 0x8E only)
              if (isExtended && offset < packet.length) {
                const ioXCount = packet.readUInt16BE(offset);
                offset += 2;
                for (let i = 0; i < ioXCount; i++) {
                  const propId = packet.readUInt16BE(offset);
                  offset += 2;
                  const length = packet.readUInt16BE(offset);
                  offset += 2;
                  offset += length;
                }
              }
            }

            if (lastLat !== null && lastLng !== null) {
              const vehicle = global.getVehicleMetadata(authenticatedDeviceId);
              let fuelPct = 100;
              if (lastAin1 !== null && vehicle && vehicle.min_voltage !== undefined && vehicle.max_voltage !== undefined && vehicle.min_voltage > 0 && vehicle.max_voltage > 0) {
                const minV = vehicle.min_voltage;
                const maxV = vehicle.max_voltage;
                if (minV !== maxV) {
                  const rawPct = ((lastAin1 - minV) / (maxV - minV)) * 100;
                  fuelPct = Math.round(Math.min(100, Math.max(0, rawPct)));
                  console.log(`[Fuel Cal TCP] Vehicle ${authenticatedDeviceId}: raw AIN1=${lastAin1}mV Empty=${minV}mV Full=${maxV}mV → Calibrated=${fuelPct}%`);
                }
              }
              
              let rawBleList = '';
              let rawBleParts = [];
              if (lastTag1Mac && lastTag1Rssi !== null) rawBleParts.push(`${lastTag1Mac}:${lastTag1Rssi}`);
              if (lastTag2Mac && lastTag2Rssi !== null) rawBleParts.push(`${lastTag2Mac}:${lastTag2Rssi}`);
              if (lastTag3Mac && lastTag3Rssi !== null) rawBleParts.push(`${lastTag3Mac}:${lastTag3Rssi}`);
              if (lastTag4Mac && lastTag4Rssi !== null) rawBleParts.push(`${lastTag4Mac}:${lastTag4Rssi}`);
              if (rawBleParts.length > 0) {
                rawBleList = rawBleParts.join(';');
              }

              console.log(`[Teltonika TCP] Telemetry parsed: Lat=${lastLat}, Lng=${lastLng}, Speed=${lastSpeed}, DOUT1=${lastDout1}, AIN1=${lastAin1}mV, BLE="${rawBleList}"`);
              handleIncomingTelemetry(authenticatedDeviceId, lastLat, lastLng, lastSpeed, 100, fuelPct, lastIgnition, rawBleList, lastDout1);
            }

            // ACK response: 4-byte UInt32BE count of records
            const ack = Buffer.alloc(4);
            ack.writeUInt32BE(numRecords, 0);
            socket.write(ack);
          }
        } catch (telErr) {
          console.error(`[Teltonika TCP] Parse error:`, telErr.message);
        }
      }

      // 5. Unrecognized header - advance by 1 byte to find next valid packet
      else {
        processedLength += 1;
      }
    }

    if (processedLength > 0) {
      buffer = buffer.subarray(processedLength);
    }
  });

  socket.on('close', () => {
    if (authenticatedDeviceId) {
      console.log(`🔌 Connection closed for Device: ${authenticatedDeviceId} (${deviceType})`);
      DeviceManager.deregisterSocket(authenticatedDeviceId);
    } else {
      console.log('🔌 Unauthenticated TCP socket closed.');
    }
  });

  socket.on('error', (err) => {
    console.error(`❌ Socket error on Device: ${authenticatedDeviceId || 'unknown'}:`, err.message);
  });
});



// HTTP-to-MQTT Webhook Bridge for Traccar (Ingesting SinoTrack, Teltonika, etc.)
// SECURITY: Protected by shared secret to prevent unauthorized telemetry injection
app.post('/api/telematics-webhook', (req, res) => {
  // Validate webhook secret (sent as Authorization header or query param)
  const webhookSecret = process.env.WEBHOOK_SECRET;
  if (webhookSecret) {
    const providedSecret = req.headers['x-webhook-secret'] || req.query.secret;
    if (providedSecret !== webhookSecret) {
      return res.status(403).json({ error: 'Unauthorized webhook request.' });
    }
  }

  try {
    const data = req.body;
    console.log('[Webhook Bridge] Received Traccar payload:', JSON.stringify(data));

    // Create a mapping from internal Traccar ID to actual IMEI (uniqueId)
    const deviceMap = new Map();
    if (data.devices && Array.isArray(data.devices)) {
      for (const dev of data.devices) {
        deviceMap.set(dev.id, dev.uniqueId);
      }
    } else if (data.device) {
      deviceMap.set(data.device.id, data.device.uniqueId);
    }

    const positionsToProcess = [];
    if (data.positions && Array.isArray(data.positions)) {
      positionsToProcess.push(...data.positions);
    } else if (data.position) {
      positionsToProcess.push(data.position);
    }

    for (const pos of positionsToProcess) {
      if (!pos.deviceId) continue;

      // ─── SKIP command-response packets (Teltonika AVL type:6) ───────────────
      // When the server sends a command (e.g. setdigout 0), the tracker responds
      // with an ACK packet.  Traccar forwards it here with attributes.type=6 and
      // attributes.result="DOUT1:Already set to 0".  These packets contain NO
      // GPS or BLE data, so processing them would (a) falsely clear beaconRssi,
      // and (b) cause an infinite LOCK → ACK → LOCK loop.
      if (pos.attributes?.type === 6 || typeof pos.attributes?.result === 'string') {
        console.log(`[Webhook Bridge] Skipping command-response packet for device ${pos.deviceId} (result: "${pos.attributes?.result}")`);
        continue;
      }

      // Resolve the internal ID to the 15-digit IMEI (uniqueId)
      let deviceId = pos.deviceId.toString();
      if (deviceMap.has(pos.deviceId)) {
        deviceId = deviceMap.get(pos.deviceId);
      } else if (pos.uniqueId) {
        deviceId = pos.uniqueId.toString();
      } else if (data.device && data.device.id === pos.deviceId) {
        deviceId = data.device.uniqueId;
      }

      // Cache Traccar internal ID mapped to IMEI for commands forwarding
      if (global.traccarDeviceIds) {
        global.traccarDeviceIds.set(deviceId, pos.deviceId);
      }

      console.log(`[Webhook Bridge] Resolved deviceId/IMEI: ${deviceId}`);
      
      // --- BLE DIAGNOSTIC: dump ALL attributes received for this position ---
      const hasBleKeys = pos.attributes && Object.keys(pos.attributes).some(k =>
        k.startsWith('tag') || k.startsWith('beacon') || k.includes('Ble') || k.includes('ble')
      );
      if (hasBleKeys) {
        console.log(`[BLE] RAW attributes for ${deviceId}:`, JSON.stringify(pos.attributes));
      }

      // Extract BLE Beacons if present from Traccar AVL elements
      let rawBleList = '';
      const bleParts = [];
      
      // 1. Check standard/alternative Beacon List attributes
      for (let b = 1; b <= 4; b++) {
        const idKey = `io${383 + b * 2}`;
        const rssiKey = `io${384 + b * 2}`;
        const altIdKey = `beacon${b}Id`;
        const altRssiKey = `beacon${b}Rssi`;
        const instanceKey = `beacon${b}Instance`;
        const tagMacKey = `tag${b}Mac`;
        const tagIdKey = `tag${b}Id`;
        const tagRssiKey = `tag${b}Rssi`;

        const mac = pos.attributes?.[idKey] || 
                    pos.attributes?.[tagMacKey] || 
                    pos.attributes?.[instanceKey] || 
                    pos.attributes?.[altIdKey] || 
                    pos.attributes?.[tagIdKey];
                    
        const rssi = pos.attributes?.[rssiKey] || 
                     pos.attributes?.[tagRssiKey] || 
                     pos.attributes?.[altRssiKey];

        if (mac && rssi !== undefined) {
          console.log(`[BLE] Beacon slot ${b} parsed → MAC: ${mac}, RSSI: ${rssi}`);
          bleParts.push(`${mac}:${rssi}`);
        }
      }
      
      // 2. Check BLE Custom AVL attributes (io331/io332, io463/io464, io468/io469, io473/io474)
      const customPairs = [
        ['io331', 'io332'],
        ['io463', 'io464'],
        ['io468', 'io469'],
        ['io473', 'io474']
      ];
      for (const [idKey, rssiKey] of customPairs) {
        const mac = pos.attributes?.[idKey];
        const rssi = pos.attributes?.[rssiKey];
        if (mac && rssi !== undefined) {
          console.log(`[BLE] Custom AVL pair ${idKey}/${rssiKey} parsed → MAC: ${mac}, RSSI: ${rssi}`);
          bleParts.push(`${mac}:${rssi}`);
        }
      }

      if (bleParts.length > 0) {
        rawBleList = bleParts.join(';');
        console.log(`[BLE] rawBleList assembled for ${deviceId}: "${rawBleList}"`);
      } else {
        // Only log if position had no BLE keys at all (reduces noise)
        if (!hasBleKeys) {
          // silent - no BLE in this position packet
        } else {
          console.log(`[BLE] ⚠️  BLE keys found in attributes but NO mac+rssi pairs matched for ${deviceId}`);
        }
      }

      // Convert battery voltage (Volts or millivolts) to percentage if needed
      let batteryPct = 100;
      if (pos.attributes?.batteryLevel !== undefined) {
        batteryPct = pos.attributes.batteryLevel;
      } else if (pos.attributes?.battery !== undefined) {
        const val = pos.attributes.battery;
        if (val > 100) {
          // sent in millivolts (e.g. 3787 mV) - LiPo range 3.4V (0%) to 4.2V (100%)
          batteryPct = Math.round(Math.min(100, Math.max(0, ((val - 3400) / 800) * 100)));
        } else if (val > 1.0 && val < 6.0) {
          // sent in Volts (e.g. 3.787 V) - LiPo range 3.4V (0%) to 4.2V (100%)
          batteryPct = Math.round(Math.min(100, Math.max(0, ((val - 3.4) / 0.8) * 100)));
        } else {
          batteryPct = val;
        }
      }

      // Extract harsh driving indicators from Traccar attributes
      const isHarshAccel = pos.attributes?.harshAcceleration === true || pos.attributes?.io253 !== undefined;
      const isHarshBrake = pos.attributes?.harshBraking === true || pos.attributes?.io254 !== undefined;

      // Normalize the payload to match the SafeBox MQTT status schema
      console.log(`[Webhook Bridge] Telemetry attributes for ${deviceId}:`, JSON.stringify(pos.attributes || {}));
      
      const ignitionOn = pos.attributes?.ignition === true || 
                         pos.attributes?.ignition === 1 || 
                         pos.attributes?.ignition === '1' || 
                         pos.attributes?.ignition === 'true' || 
                         pos.attributes?.io239 === 1 || 
                         pos.attributes?.io239 === '1' || 
                         pos.attributes?.din1 === 1 || 
                         pos.attributes?.din1 === '1' || 
                         pos.attributes?.din1 === true || 
                         pos.attributes?.in1 === 1 || 
                         pos.attributes?.in1 === '1' || 
                         pos.attributes?.in1 === true || 
                         pos.attributes?.in1 === 'true' || 
                         pos.attributes?.di1 === 1 || 
                         pos.attributes?.di1 === '1' || 
                         pos.attributes?.di1 === true || 
                         pos.attributes?.io1 === 1 || 
                         pos.attributes?.io1 === '1' || 
                         pos.attributes?.io1 === true;

      const vehicle = global.getVehicleMetadata(deviceId);

      // Calibrated Fuel Calculation from Analog Input 1 (AIN1)
      let fuelPct = 100;
      // In Traccar, AIN1 usually maps to attributes.adc1 or attributes.io9
      const rawAnalog = pos.attributes?.adc1 !== undefined ? pos.attributes.adc1 : (pos.attributes?.io9 !== undefined ? pos.attributes.io9 : null);

      if (rawAnalog !== null && vehicle && vehicle.min_voltage !== undefined && vehicle.max_voltage !== undefined && vehicle.min_voltage > 0 && vehicle.max_voltage > 0) {
        const minV = vehicle.min_voltage;
        const maxV = vehicle.max_voltage;
        if (minV !== maxV) {
          const rawPct = ((rawAnalog - minV) / (maxV - minV)) * 100;
          fuelPct = Math.round(Math.min(100, Math.max(0, rawPct)));
          console.log(`[Fuel Cal Webhook] Vehicle ${deviceId}: raw AIN1=${rawAnalog}mV Empty=${minV}mV Full=${maxV}mV → Calibrated=${fuelPct}%`);
        }
      } else if (pos.attributes?.fuel !== undefined) {
        fuelPct = pos.attributes.fuel;
      }

      const normalizedPayload = {
        deviceId: deviceId,
        lat: pos.latitude || 0,
        lng: pos.longitude || 0,
        speed: pos.speed ? Math.round(pos.speed * 1.852) : 0, // Knots to km/h conversion
        battery: batteryPct,
        fuel: fuelPct,
        locked: !ignitionOn, // Default state to locked if ignition is off
        ignition: ignitionOn, // Explicit ACC state
        rawBleList: rawBleList,
        gpsValid: pos.valid !== false, // Boolean: true if GPS fix is valid
        harshAccel: isHarshAccel,
        harshBrake: isHarshBrake
      };

      // ─── Fast-path Relay State Machine (Unified via RelayManager) ──────────
      RelayManager.evaluateAutomaticRelay(deviceId, ignitionOn ? 1 : 0, normalizedPayload.speed || 0, rawBleList || '', vehicle);
      // ────────────────────────────────────────────────────────────────────────

      // Publish to MQTT broker (HiveMQ / EMQX) — for Socket.io UI updates
      const topic = `/device/${deviceId}/status`;
      mqttClient.publish(topic, JSON.stringify(normalizedPayload), { qos: 1 }, (mqttErr) => {
        if (mqttErr) {
          console.error(`[Webhook Bridge] Failed to publish MQTT status for ${deviceId}:`, mqttErr.message);
        } else {
          console.log(`[Webhook Bridge] Published status to MQTT for ${deviceId}`);
        }
      });

    }

    res.sendStatus(200);
  } catch (err) {
    console.error('[Webhook Bridge] Error processing webhook:', err.message);
    res.status(500).json({ error: 'Failed to process telematics payload: ' + err.message });
  }
});

// --- SPA Catch-All Route (must be AFTER all API routes) ---
// In production, serve index.html for any route that isn't an API endpoint
// This enables proper SPA routing and ensures search engine crawlers receive the HTML document
if (process.env.NODE_ENV === 'production') {
  app.get('*splat', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  // Start TCP Telematics Server for COTS Trackers
  tcpServer.listen(TCP_PORT, () => {
    console.log(`🔋 TCP Telematics Ingestion Server running on port ${TCP_PORT}`);
  });

  // 🧹 Daily Cleanup: Prune vehicle_history older than 90 days
  const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
  const RETENTION_DAYS = 90;

  const runHistoryCleanup = () => {
    try {
      const cutoff = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const result = db.prepare('DELETE FROM vehicle_history WHERE timestamp < ?').run(cutoff);
      if (result.changes > 0) {
        console.log(`🧹 Pruned ${result.changes} vehicle_history records older than ${RETENTION_DAYS} days`);
      }
    } catch (err) {
      console.error('History cleanup failed:', err.message);
    }
  };

  // Run once on startup, then every 24 hours
  runHistoryCleanup();
  setInterval(runHistoryCleanup, CLEANUP_INTERVAL);

  // 🕒 Automatic Curfew Transitions & Warnings: Check every 60 seconds
  const checkCurfewTransitions = () => {
    try {
      const now = new Date();
      const nowStr = now.toTimeString().substring(0, 5); // "HH:MM"

      // Fetch all vehicles with curfew enabled
      const vehicles = db.prepare('SELECT id, owner_id, curfew_start, curfew_end, curfew_days, curfew_holiday_mode, cloud_locked FROM vehicles WHERE curfew_enabled = 1').all();

      vehicles.forEach(vehicle => {
        const isAllowed = isWithinAllowedHours(now, vehicle.curfew_start, vehicle.curfew_end, vehicle.curfew_days, vehicle.curfew_holiday_mode);

        // Check if operating window is ending in 30 minutes
        if (isAllowed && vehicle.curfew_end) {
          const [endH, endM] = vehicle.curfew_end.split(':').map(Number);
          const endMinutes = endH * 60 + endM;
          
          const currentMinutes = now.getHours() * 60 + now.getMinutes();
          if (endMinutes - currentMinutes === 30) {
            // Trigger 30 minute warning!
            const alertMsg = `Operating Window Warning: Vehicle ${vehicle.id} operating hours will end in 30 minutes!`;
            console.log(`[Curfew Warning] Emitting 30-min warning for ${vehicle.id}`);
            io.to(`user_${vehicle.owner_id}`).emit('notification', {
              id: Date.now() + Math.random(),
              type: 'CURFEW_WARNING',
              severity: 'warning',
              message: alertMsg,
              timestamp: Date.now(),
              is_read: false
            });
          }
        }

        // If curfew end is reached exactly, lock if stopped
        if (nowStr === vehicle.curfew_end) {
          // Transition to curfew: BLOCK_START
          console.log(`[Curfew Scheduler] Curfew end reached. Sending BLOCK_START to ${vehicle.id}`);
          mqttClient.publish(`/device/${vehicle.id}/command`, JSON.stringify({ command: 'BLOCK_START' }));
        } else if (nowStr === vehicle.curfew_start) {
          // Transition out of curfew: ALLOW_START
          console.log(`[Curfew Scheduler] Curfew start reached. Sending ALLOW_START to ${vehicle.id}`);
          db.prepare("UPDATE vehicles SET cloud_locked = 0, is_locked = 0, override_status = 'NONE', override_expires = 0 WHERE id = ?").run(vehicle.id);
          if (global.invalidateMetadataCache) global.invalidateMetadataCache(vehicle.id);
          mqttClient.publish(`/device/${vehicle.id}/command`, JSON.stringify({ command: 'ALLOW_START' }));
          mqttClient.publish(`/device/${vehicle.id}/command`, JSON.stringify({ command: 'UNLOCK' }));

          // Broadcast to frontend
          broadcastDeviceData(vehicle.id, `/device/${vehicle.id}/status`, {
            deviceId: vehicle.id,
            locked: false,
            timestamp: Date.now()
          });
        }
      });
    } catch (err) {
      console.error('Curfew transition check failed:', err.message);
    }
  };

  setInterval(checkCurfewTransitions, 60000);

  // 🕒 Scheduled Report Deliveries checking loop: check every 60 seconds
  const runScheduledReportsCheck = async () => {
    try {
      const now = new Date();
      const currentHM = now.toTimeString().substring(0, 5); // "HH:MM"
      
      const schedules = db.prepare('SELECT * FROM report_schedules').all();
      
      for (const s of schedules) {
        if (s.time_of_delivery !== currentHM) continue;

        // Check if schedule already ran today to avoid double triggers in the same minute
        if (s.last_run_at) {
          const lastRunDate = new Date(s.last_run_at).toLocaleDateString();
          if (lastRunDate === now.toLocaleDateString()) continue;
        }

        // Evaluate frequency rules
        let shouldRun = false;
        let rangeStr = 'Last 7 Days';
        
        if (s.frequency === 'daily') {
          shouldRun = true;
          rangeStr = 'Yesterday';
        } else if (s.frequency === 'weekly') {
          const daysSinceLast = s.last_run_at ? (Date.now() - s.last_run_at) / (24 * 60 * 60 * 1000) : 999;
          if (daysSinceLast >= 6.5) {
            shouldRun = true;
            rangeStr = 'Last 7 Days';
          }
        } else if (s.frequency === 'biweekly') {
          const daysSinceLast = s.last_run_at ? (Date.now() - s.last_run_at) / (24 * 60 * 60 * 1000) : 999;
          if (daysSinceLast >= 13.5) {
            shouldRun = true;
            rangeStr = 'Last 14 Days';
          }
        } else if (s.frequency === 'monthly') {
          const daysSinceLast = s.last_run_at ? (Date.now() - s.last_run_at) / (24 * 60 * 60 * 1000) : 999;
          if (daysSinceLast >= 27) {
            shouldRun = true;
            rangeStr = 'Last 30 Days';
          }
        }

        if (shouldRun) {
          console.log(`[Scheduler] Compiling scheduled ${s.frequency} report (Type: ${s.report_type}) for user ${s.user_id}`);
          
          const user = db.prepare('SELECT username, email FROM users WHERE id = ?').get(s.user_id);
          if (!user) continue;

          const owned = db.prepare('SELECT id FROM vehicles WHERE owner_id = ?').all(s.user_id);
          const vehicleIds = owned.map(o => o.id);
          if (vehicleIds.length === 0) continue;

          const { startTime, endTime } = reportsService.getDateRange(rangeStr);

          // Mark last run timestamp before generating to avoid race conditions
          db.prepare('UPDATE report_schedules SET last_run_at = ? WHERE id = ?').run(Date.now(), s.id);

          try {
            const dateRangeText = rangeStr === 'Yesterday' ? 'Yesterday' : rangeStr;
            const result = await reportsService.generatePDFReport(
              'sched_' + Date.now(),
              s.report_type,
              vehicleIds,
              [],
              startTime,
              endTime,
              user.username,
              dateRangeText
            );

            // Save to report_history
            db.prepare(`
              INSERT INTO report_history (generated_by, generated_at, report_type, file_path, name, period)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(s.user_id, Date.now(), s.report_type, result.relativePath, result.reportName, dateRangeText);

            // Send notification
            io.to(`user_${s.user_id}`).emit('notification', {
              id: Date.now() + Math.random(),
              type: 'REPORT_GENERATED',
              severity: 'info',
              message: `Your scheduled ${s.frequency} ${s.report_type} is ready for download.`,
              timestamp: Date.now(),
              is_read: false
            });

            // Dispatch Email
            if (s.delivery_method && s.delivery_method.includes('email')) {
              const recipientsList = s.recipients ? s.recipients.split(',').map(email => email.trim()) : [user.email];
              const subject = `Scheduled SafeBox Report: ${s.report_type} (${s.frequency.toUpperCase()})`;
              const text = `Hello,\n\nPlease find attached your scheduled ${s.frequency} SafeBox Fleet Report for ${dateRangeText}.\n\nSafeBox Fleet Team`;
              const html = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                  <h2>Scheduled SafeBox Fleet Report</h2>
                  <p>Hello,</p>
                  <p>Your scheduled <strong>${s.frequency}</strong> report (<strong>${s.report_type}</strong>) has been generated successfully.</p>
                  <p><strong>Report Period:</strong> ${dateRangeText}</p>
                  <p>Please find the compiled PDF document attached to this email.</p>
                  <hr style="border:0; border-top:1px solid #e2e8f0; margin:20px 0;" />
                  <p style="font-size:0.8rem; color:#64748b;">This is an automated delivery. You can manage your schedules directly inside the Reports module of your Safebox Dashboard.</p>
                </div>
              `;

              let emailSent = false;

              // 1. Try Resend API
              if (process.env.RESEND_API_KEY) {
                try {
                  console.log(`✉️ [Scheduler] Attempting to send report email via Resend...`);
                  const fromEmail = process.env.RESEND_FROM_EMAIL || 'SafeBox Fleet Intelligence <onboarding@resend.dev>';
                  
                  const fs = require('fs');
                  const fileContent = fs.readFileSync(result.filePath);
                  const base64Content = fileContent.toString('base64');

                  const controller = new AbortController();
                  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 seconds for attachment

                  const response = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                      from: fromEmail,
                      to: recipientsList,
                      subject: subject,
                      html: html,
                      attachments: [
                        {
                          content: base64Content,
                          filename: result.reportName
                        }
                      ]
                    }),
                    signal: controller.signal
                  });
                  clearTimeout(timeoutId);

                  if (response.ok) {
                    console.log(`✉️ [Scheduler] Dispatched email report ${result.reportName} via Resend to ${recipientsList.join(', ')}`);
                    emailSent = true;
                  } else {
                    const errText = await response.text();
                    console.error(`❌ [Scheduler] Resend API failed (${response.status}):`, errText);
                  }
                } catch (err) {
                  console.error('❌ [Scheduler] Resend API exception:', err.message);
                }
              }

              // 2. Try SMTP Nodemailer
              if (!emailSent) {
                const smtpHost = process.env.SMTP_HOST;
                const smtpPort = process.env.SMTP_PORT || 587;
                const smtpUser = process.env.SMTP_USER;
                const smtpPass = process.env.SMTP_PASS;

                if (smtpHost && smtpUser && smtpPass) {
                  try {
                    const transporter = nodemailer.createTransport({
                      host: smtpHost,
                      port: parseInt(smtpPort),
                      secure: parseInt(smtpPort) === 465,
                      auth: { user: smtpUser, pass: smtpPass },
                      connectionTimeout: 3000,
                      greetingTimeout: 3000,
                      socketTimeout: 3000
                    });
                    await transporter.sendMail({
                      from: `"SafeBox Fleet Intelligence" <${smtpUser}>`,
                      to: recipientsList.join(', '),
                      subject,
                      text,
                      html,
                      attachments: [
                        {
                          filename: result.reportName,
                          path: result.filePath
                        }
                      ]
                    });
                    console.log(`✉️ [Scheduler] Dispatched email report ${result.reportName} via SMTP to ${recipientsList.join(', ')}`);
                    emailSent = true;
                  } catch (smtpErr) {
                    console.error('❌ [Scheduler] SMTP failed:', smtpErr.message);
                  }
                }
              }

              // 3. Fallback Mock Log
              if (!emailSent) {
                console.log(`[SMTP MOCK] Dispatched email report ${result.reportName} to ${recipientsList.join(', ')}`);
              }
            }

          } catch (err) {
            console.error(`Scheduled report execution failed for schedule ${s.id}:`, err);
          }
        }
      }
    } catch (err) {
      console.error('Scheduled reports check failed:', err);
    }
  };

  setInterval(runScheduledReportsCheck, 60000);
});

// Helper: Haversine Distance
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  var R = 6371; // Radius of the earth in km
  var dLat = deg2rad(lat2 - lat1);
  var dLon = deg2rad(lon2 - lon1);
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
    ;
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  var d = R * c; // Distance in km
  return d;
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

// Helper: Ray-Casting Point-in-Polygon algorithm for polygon geofences
function isPointInPolygon(point, polygon) {
  let x = point.lat, y = point.lng;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    let xi = polygon[i].lat, yi = polygon[i].lng;
    let xj = polygon[j].lat, yj = polygon[j].lng;
    let intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Helper: Estimate Battery Percentage from Voltage (with Piecewise Linear Approximation matching Teltonika curve)
function estimateBatteryPercentage(val) {
  if (val > 100) {
    val = val / 1000.0; // millivolts to volts
  }
  const points = [
    { v: 4.20, p: 100 },
    { v: 4.10, p: 80 },
    { v: 4.00, p: 60 },
    { v: 3.90, p: 40 },
    { v: 3.80, p: 20 },
    { v: 3.70, p: 5 },
    { v: 3.60, p: 0 }
  ];

  if (val >= points[0].v) return 100;
  if (val <= points[points.length - 1].v) return 0;

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    if (val <= p1.v && val >= p2.v) {
      const ratio = (val - p2.v) / (p1.v - p2.v);
      return Math.round(p2.p + ratio * (p1.p - p2.p));
    }
  }
  return 100;
}

// Global fuel level tracking for dynamic fuel theft detection
if (!global.fuelTracker) global.fuelTracker = new Map();

// ─── DAILY DATABASE TELEMETRY & ALERTS PRUNING (P1) ──────────────────────
function pruneOldTelemetryHistory() {
  console.log('[Maintenance] Starting database pruning task...');
  try {
    const ninetyDaysAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
    const historyResult = db.prepare('DELETE FROM vehicle_history WHERE timestamp < ?').run(ninetyDaysAgo);
    const alertsResult = db.prepare('DELETE FROM vehicle_alerts WHERE timestamp < ?').run(ninetyDaysAgo);
    console.log(`[Maintenance] Pruning complete. Removed ${historyResult.changes} telemetry logs and ${alertsResult.changes} alert records older than 90 days.`);
  } catch (err) {
    console.error('[Maintenance] Database pruning failed:', err.message);
  }
}
// Run once on startup, then every 24 hours
setTimeout(pruneOldTelemetryHistory, 5000);
setInterval(pruneOldTelemetryHistory, 24 * 60 * 60 * 1000);

// ─── PERIODIC IN-MEMORY STATE MAP CLEANUP (P1) ──────────────────────────
function cleanInMemoryStateMaps() {
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  
  const mapsToClean = [
    { map: global.alertCooldowns, maxAge: 2 * 3600 * 1000 }, // 2 hours cooldown cache
    { map: global.lastBeaconSeen, maxAge: oneDayMs },
    { map: global.lastMovingTime, maxAge: oneDayMs },
    { map: global.lockCooldowns, maxAge: oneDayMs },
    { map: global.fuelTracker, maxAge: oneDayMs }
  ];
  
  mapsToClean.forEach(({ map, maxAge }) => {
    if (map instanceof Map) {
      for (const [key, value] of map.entries()) {
        const timestamp = typeof value === 'number' ? value : (value?.timestamp || now);
        if (now - timestamp > maxAge) {
          map.delete(key);
        }
      }
    }
  });
  console.log('[Maintenance] Stale in-memory tracking state maps cleaned.');
}
// Clean maps every 1 hour
setInterval(cleanInMemoryStateMaps, 60 * 60 * 1000);

// ─── SERVER-SIDE "DEVICE OFFLINE" DETECTION LOOP (P1) ───────────────────
function checkOfflineDevices() {
  console.log('[Offline Monitor] Checking for inactive trackers...');
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  try {
    const offlineVehicles = db.prepare(`
      SELECT id, name, last_seen, owner_id FROM vehicles
      WHERE last_seen IS NOT NULL AND last_seen < ?
    `).all(tenMinutesAgo);

    for (const vehicle of offlineVehicles) {
      // Find the latest DEVICE_OFFLINE alert to prevent duplicate notifications
      const latestOfflineAlert = db.prepare(`
        SELECT timestamp FROM vehicle_alerts
        WHERE vehicle_id = ? AND type = 'DEVICE_OFFLINE'
        ORDER BY timestamp DESC LIMIT 1
      `).get(vehicle.id);

      // Only trigger if no alert exists since they were last seen online
      if (!latestOfflineAlert || latestOfflineAlert.timestamp < vehicle.last_seen) {
        const timeDiff = Date.now() - vehicle.last_seen;
        const minutes = Math.floor(timeDiff / 60000);
        let durationStr = `${minutes}m ago`;
        if (minutes >= 60) {
          const hours = Math.floor(minutes / 60);
          if (hours >= 24) {
            durationStr = `${Math.floor(hours / 24)}d ago`;
          } else {
            durationStr = `${hours}h ago`;
          }
        }
        
        const alertMsg = `Critical Alert: Vehicle "${vehicle.name}" is offline (last active: ${durationStr}).`;

        db.prepare(`
          INSERT INTO vehicle_alerts (vehicle_id, type, message, timestamp, status)
          VALUES (?, 'DEVICE_OFFLINE', ?, ?, 'UNREAD')
        `).run(vehicle.id, alertMsg, Date.now());

        // Emit socket notification
        io.to(`user_${vehicle.owner_id}`).emit('notification', {
          id: Date.now() + Math.random(),
          type: 'DEVICE_OFFLINE',
          severity: 'error',
          message: alertMsg,
          timestamp: Date.now(),
          is_read: false
        });

        // Publish MQTT alert topic
        if (mqttClient && mqttClient.connected) {
          mqttClient.publish(`/device/${vehicle.id}/alert`, JSON.stringify({
            deviceId: vehicle.id,
            type: 'DEVICE_OFFLINE',
            message: alertMsg,
            timestamp: Date.now()
          }));
        }

        console.log(`[Offline Monitor] 🚨 Dispatched offline alert for vehicle ${vehicle.name} (${vehicle.id})`);
      }
    }
  } catch (err) {
    console.error('[Offline Monitor] Scan failed:', err.message);
  }
}
// Run scan on startup after 10 seconds, then check every 5 minutes
setTimeout(checkOfflineDevices, 10000);
setInterval(checkOfflineDevices, 5 * 60 * 1000);

// Background Job: Command Timeout Sweeper (runs every 1 minute)
function checkDeviceCommandTimeouts() {
  try {
    const cutOffTime = Date.now() - 15 * 1000;
    const result = db.prepare(`
      UPDATE device_commands
      SET status = 'TIMEOUT', error = 'Command acknowledgement timed out after 15 seconds'
      WHERE status IN ('PENDING', 'SENT') AND sent_at < ?
    `).run(cutOffTime);
    if (result.changes > 0) {
      console.log(`[Command Monitor] ⏳ Marked ${result.changes} pending/sent command(s) as TIMEOUT.`);
    }
  } catch (err) {
    console.error('[Command Monitor] Timeout scan failed:', err.message);
  }
}
// Run command timeout check every 1 minute
setInterval(checkDeviceCommandTimeouts, 60 * 1000);


// ─── GRACEFUL SHUTDOWN HANDLERS (P1) ────────────────────────────────────
function handleGracefulShutdown(signal) {
  console.log(`[Shutdown] Received ${signal}. Starting graceful shutdown...`);
  
  // Close the TCP telematics server first
  if (typeof tcpServer !== 'undefined' && tcpServer && typeof tcpServer.close === 'function') {
    try {
      tcpServer.close(() => {
        console.log('[Shutdown] TCP telematics server closed.');
      });
    } catch (e) {
      console.error('[Shutdown] Error closing TCP server:', e.message);
    }
  }

  // Close the Express HTTP/Socket.io server
  server.close(() => {
    console.log('[Shutdown] Express HTTP server stopped.');
    
    // Disconnect MQTT client if connected
    if (typeof mqttClient !== 'undefined' && mqttClient && typeof mqttClient.end === 'function') {
      mqttClient.end(false, () => {
        console.log('[Shutdown] MQTT client disconnected.');
        closeDbAndExit();
      });
    } else {
      closeDbAndExit();
    }
  });

  // Helper to cleanly close SQLite db and exit
  function closeDbAndExit() {
    try {
      if (global.flushHistoryQueue) {
        console.log('[Shutdown] Flushing remaining history logs before database close...');
        global.flushHistoryQueue();
      }
      db.close();
      console.log('[Shutdown] Database connection closed.');
    } catch (dbErr) {
      console.error('[Shutdown] Error closing database:', dbErr.message);
    }
    console.log('[Shutdown] SafeBox server shutdown complete.');
    process.exit(0);
  }

  // Force exit after 10 seconds if shutdown hangs
  setTimeout(() => {
    console.error('[Shutdown] Graceful shutdown timed out. Forcing exit.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
