const express = require('express');
const http = require('http');
const aedes = require('aedes')();
const serverFactory = require('aedes-server-factory');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { db, initDb } = require('./db');
require('dotenv').config();

// Initialize DB
initDb();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // Allow all for dev
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "unpkg.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "unpkg.com", "fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "blob:", "*.tile.openstreetmap.org", "cdnjs.cloudflare.com", "unpkg.com"],
      connectSrc: ["'self'", "ws:", "wss:", "data:"],
      fontSrc: ["'self'", "fonts.gstatic.com"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
}));
app.use(morgan('dev'));
app.use(express.json());

// Serve static frontend files in production
if (process.env.NODE_ENV === 'production') {
  const path = require('path');
  app.use(express.static(path.join(__dirname, 'public')));
}


// MQTT Broker Setup
const mqttPort = process.env.MQTT_PORT || 1883;
const mqttServer = serverFactory.createServer(aedes);

mqttServer.listen(mqttPort, function () {
  console.log('MQTT Broker started and listening on port', mqttPort);
});

// MQTT Events
aedes.on('client', function (client) {
  console.log('MQTT Client Connected:', client ? client.id : client);
});

// MQTT Publish Event (Handle Telemetry & Alerts)
aedes.on('publish', function (packet, client) {
  if (client) {
    // 1. Handle Telemetry
    if (packet.topic.startsWith('/device/') && packet.topic.endsWith('/status')) {
      try {
        const payloadStr = packet.payload.toString();
        const payload = JSON.parse(payloadStr);

        // Update last_seen, battery_level, and fuel_level in DB
        try {
          const stmt = db.prepare('UPDATE vehicles SET last_seen = ?, battery_level = ?, fuel_level = ? WHERE id = ?');
          stmt.run(Date.now(), payload.battery || 100, payload.fuel || 100, payload.deviceId);

          // Insert into vehicle_history
          const historyStmt = db.prepare(`
              INSERT INTO vehicle_history (vehicle_id, timestamp, speed, battery_level, fuel_level, lat, lng)
              VALUES (?, ?, ?, ?, ?, ?, ?)
          `);
          historyStmt.run(
            payload.deviceId,
            Date.now(),
            payload.speed || 0,
            payload.battery || 100,
            payload.fuel || 100,
            payload.lat || 0,
            payload.lng || 0
          );

          // Check Speeding
          if (payload.speed > 90) {
            const alertKey = `${payload.deviceId}-SPEED`;
            const lastAlert = global.alertCooldowns.get(alertKey);
            const now = Date.now();
            if (!lastAlert || (now - lastAlert > 60000)) {
              const msg = `Vehicle ${payload.deviceId} is speeding! (${payload.speed} km/h)`;
              io.emit('geofence-alert', { vehicleId: payload.deviceId, message: msg, timestamp: now, type: 'SPEED' });
              try { db.prepare('INSERT INTO notifications (vehicle_id, type, message, timestamp) VALUES (?, ?, ?, ?)').run(payload.deviceId, 'SPEED', msg, now); } catch (e) { }
              global.alertCooldowns.set(alertKey, now);
            }
          }

          // Check Low Fuel
          if (payload.fuel < 15) {
            const alertKey = `${payload.deviceId}-FUEL`;
            const lastAlert = global.alertCooldowns.get(alertKey);
            const now = Date.now();
            if (!lastAlert || (now - lastAlert > 300000)) { // 5 mins cooldown
              const msg = `Vehicle ${payload.deviceId} has low fuel! (${Math.round(payload.fuel)}%)`;
              io.emit('geofence-alert', { vehicleId: payload.deviceId, message: msg, timestamp: now, type: 'FUEL' });
              try { db.prepare('INSERT INTO notifications (vehicle_id, type, message, timestamp) VALUES (?, ?, ?, ?)').run(payload.deviceId, 'FUEL', msg, now); } catch (e) { }
              global.alertCooldowns.set(alertKey, now);
            }
          }

          // Check Geofences
          if (payload.lat && payload.lng) {
            const geofences = db.prepare('SELECT * FROM geofences WHERE vehicle_id = ?').all(payload.deviceId);

            if (!global.alertCooldowns) global.alertCooldowns = new Map();

            geofences.forEach(geo => {
              const distance = getDistanceFromLatLonInKm(geo.lat, geo.lng, payload.lat, payload.lng) * 1000; // meters
              const alertKey = `${payload.deviceId}-${geo.id}`;

              if (distance > geo.radius) {
                // OUTSIDE
                const lastAlert = global.alertCooldowns.get(alertKey);
                const now = Date.now();

                // Alert only if never alerted or > 60 seconds ago
                if (!lastAlert || (now - lastAlert > 60000)) {
                  const alertMsg = `Vehicle ${payload.deviceId} has left the safe zone!`;

                  // Save to DB
                  try {
                    db.prepare('INSERT INTO notifications (vehicle_id, type, message, timestamp) VALUES (?, ?, ?, ?)').run(payload.deviceId, 'GEOFENCE', alertMsg, now);
                  } catch (e) { console.error(e); }

                  io.emit('geofence-alert', {
                    vehicleId: payload.deviceId,
                    message: alertMsg,
                    timestamp: now
                  });
                  console.log(`Geofence Breach: ${payload.deviceId}`);
                  global.alertCooldowns.set(alertKey, now);
                }
              } else {
                // INSIDE - Reset cooldown so we alert immediately if they leave again
                if (global.alertCooldowns.has(alertKey)) {
                  global.alertCooldowns.delete(alertKey);
                  console.log(`Vehicle ${payload.deviceId} re-entered safe zone ${geo.id}`);
                }
              }
            });
          }

        } catch (dbErr) {
          console.error("DB Update/History Insert failed", dbErr);
        }

        io.emit('device-data', { topic: packet.topic, payload });
      } catch (e) {
        console.error("Failed to parse MQTT payload", e);
      }
    }
  }
});

// API Routes
// Root route removed to allow static file serving


// Auth Routes
app.post('/api/register', (req, res) => {
  const { username, password, role, companyName, email, phone } = req.body;
  try {
    const stmt = db.prepare('INSERT INTO users (username, password, role, company_name, email, phone) VALUES (?, ?, ?, ?, ?, ?)');
    const info = stmt.run(username, password, role, companyName || null, email || null, phone || null);
    res.json({ id: info.lastInsertRowid, username, role });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: 'Username already exists' });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const stmt = db.prepare('SELECT * FROM users WHERE username = ? AND password = ?');
  const user = stmt.get(username, password);

  if (user) {
    res.json({ id: user.id, username: user.username, role: user.role });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});


// Vehicle Routes
app.get('/api/vehicles', (req, res) => {
  const { userId, role } = req.query;

  if (role === 'company') {
    // Company sees ONLY vehicles they own/registered
    const stmt = db.prepare('SELECT * FROM vehicles WHERE owner_id = ?');
    const vehicles = stmt.all(userId);
    res.json(vehicles);
  } else {
    // Individual sees only their vehicles
    const stmt = db.prepare('SELECT * FROM vehicles WHERE owner_id = ?');
    const vehicles = stmt.all(userId);
    res.json(vehicles);
  }
});

app.post('/api/vehicles', (req, res) => {
  const { id, name, ownerId } = req.body;
  try {
    // 1. Validate Format (Must be MOTO_XXX)
    const idPattern = /^MOTO_\d{3}$/;
    if (!idPattern.test(id)) {
      return res.status(400).json({ error: 'Invalid ID Format. Must be MOTO_XXX (e.g., MOTO_001)' });
    }

    const stmt = db.prepare('INSERT INTO vehicles (id, name, owner_id, is_locked) VALUES (?, ?, ?, 1)');
    stmt.run(id, name, ownerId);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: 'Vehicle ID already claimed or invalid' });
  }
});

app.delete('/api/vehicles/:id', (req, res) => {
  try {
    const stmt = db.prepare('DELETE FROM vehicles WHERE id = ?');
    stmt.run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete vehicle' });
  }
});


// Geofence Routes
app.get('/api/geofences', (req, res) => {
  const { vehicleId } = req.query;
  try {
    const geofences = db.prepare('SELECT * FROM geofences WHERE vehicle_id = ?').all(vehicleId);
    res.json(geofences);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch geofences' });
  }
});

app.post('/api/geofences', (req, res) => {
  const { vehicleId, lat, lng, radius } = req.body;
  try {
    const stmt = db.prepare('INSERT INTO geofences (vehicle_id, lat, lng, radius) VALUES (?, ?, ?, ?)');
    const info = stmt.run(vehicleId, lat, lng, radius);
    res.json({ id: info.lastInsertRowid, vehicleId, lat, lng, radius });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create geofence' });
  }
});

app.put('/api/geofences/:id', (req, res) => {
  const { lat, lng, radius } = req.body;
  try {
    const stmt = db.prepare('UPDATE geofences SET lat = ?, lng = ?, radius = ? WHERE id = ?');
    stmt.run(lat, lng, radius, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update geofence' });
  }
});

app.delete('/api/geofences/:id', (req, res) => {
  try {
    const stmt = db.prepare('DELETE FROM geofences WHERE id = ?');
    stmt.run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete geofence' });
  }
});

// Notification Routes
app.get('/api/notifications', (req, res) => {
  const { userId, role } = req.query;
  try {
    let notifications;
    if (role === 'company') {
      notifications = db.prepare(`
                SELECT n.*, v.name as vehicle_name 
                FROM notifications n
                JOIN vehicles v ON n.vehicle_id = v.id
                WHERE v.owner_id = ?
                ORDER BY n.timestamp DESC LIMIT 50
            `).all(userId);
    } else {
      notifications = db.prepare(`
                SELECT n.*, v.name as vehicle_name 
                FROM notifications n
                JOIN vehicles v ON n.vehicle_id = v.id
                WHERE v.owner_id = ?
                ORDER BY n.timestamp DESC LIMIT 50
            `).all(userId);
    }
    res.json(notifications);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

app.put('/api/notifications/:id/read', (req, res) => {
  try {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

app.put('/api/notifications/read-all', (req, res) => {
  const { userId } = req.body;
  try {
    db.prepare(`
            UPDATE notifications 
            SET is_read = 1 
            WHERE vehicle_id IN (SELECT id FROM vehicles WHERE owner_id = ?)
        `).run(userId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark all read' });
  }
});

// Socket.io Connection
io.on('connection', (socket) => {
  console.log('Web Client Connected');

  socket.on('disconnect', () => {
    console.log('Web Client Disconnected');
  });

  // Handle commands from frontend
  socket.on('send-command', (data) => {
    // data: { deviceId, command }
    const topic = `/device/${data.deviceId}/command`;

    // 1. Update DB State
    const isLocked = data.command === 'LOCK' ? 1 : 0;
    try {
      const stmt = db.prepare('UPDATE vehicles SET is_locked = ? WHERE id = ?');
      stmt.run(isLocked, data.deviceId);
    } catch (e) {
      console.error("DB Update failed", e);
    }

    // 2. Send to MQTT
    aedes.publish({ topic, payload: JSON.stringify({ command: data.command }) });
    console.log(`Command sent to ${data.deviceId}: ${data.command}`);
  });
});

// --- ANALYTICS API ---

// Helper: Calculate Vehicle Scores
function calculateVehicleScore(vehicle) {
  const history = db.prepare('SELECT speed, fuel_level, battery_level FROM vehicle_history WHERE vehicle_id = ? ORDER BY timestamp DESC LIMIT 50').all(vehicle.id);

  let safetyScore = 100;
  let efficiencyScore = 100;

  // Safety: Penalize speeding
  let speedingCount = 0;
  history.forEach(h => {
    if (h.speed > 80) speedingCount++;
  });
  safetyScore -= (speedingCount * 5);

  // Efficiency: Penalize low fuel/battery (current state)
  if (vehicle.fuel_level < 20) efficiencyScore -= 20;
  if (vehicle.battery_level < 20) efficiencyScore -= 20;

  return {
    safety: Math.max(0, Math.min(100, safetyScore)),
    efficiency: Math.max(0, Math.min(100, efficiencyScore))
  };
}

// Get aggregated stats
app.get('/api/analytics/stats', (req, res) => {
  const { userId, role } = req.query;
  try {
    let totalVehicles, activeVehicles, criticalAlerts, avgFuel, avgSafety;
    let vehiclesForStats = [];

    if (role === 'company' && userId) {
      // Filter by Company
      totalVehicles = db.prepare('SELECT COUNT(*) as count FROM vehicles WHERE owner_id = ?').get(userId).count;

      const fiveMinsAgo = Date.now() - 300000;
      activeVehicles = db.prepare('SELECT COUNT(*) as count FROM vehicles WHERE owner_id = ? AND last_seen > ?').get(userId, fiveMinsAgo).count;

      criticalAlerts = db.prepare(`
        SELECT COUNT(*) as count 
        FROM notifications n
        JOIN vehicles v ON n.vehicle_id = v.id
        WHERE v.owner_id = ? AND n.is_read = 0
      `).get(userId).count;

      avgFuel = db.prepare('SELECT AVG(fuel_level) as avg FROM vehicles WHERE owner_id = ?').get(userId).avg;

      vehiclesForStats = db.prepare('SELECT * FROM vehicles WHERE owner_id = ?').all(userId);
    } else {
      // Global Stats
      totalVehicles = db.prepare('SELECT COUNT(*) as count FROM vehicles').get().count;
      const fiveMinsAgo = Date.now() - 300000;
      activeVehicles = db.prepare('SELECT COUNT(*) as count FROM vehicles WHERE last_seen > ?').get(fiveMinsAgo).count;

      criticalAlerts = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE is_read = 0').get().count;

      avgFuel = db.prepare('SELECT AVG(fuel_level) as avg FROM vehicles').get().avg;

      vehiclesForStats = db.prepare('SELECT * FROM vehicles').all();
    }

    // Calculate Avg Safety
    let totalSafety = 0;
    if (vehiclesForStats.length > 0) {
      vehiclesForStats.forEach(v => {
        totalSafety += calculateVehicleScore(v).safety;
      });
      avgSafety = Math.round(totalSafety / vehiclesForStats.length);
    } else {
      avgSafety = 100;
    }

    res.json({
      totalVehicles,
      activeVehicles,
      criticalAlerts,
      avgFuel: Math.round(avgFuel || 0),
      avgSafety
    });
  } catch (err) {
    console.error("Analytics Stats Error", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// Leaderboard API
app.get('/api/analytics/leaderboard', (req, res) => {
  const { userId, role } = req.query;
  try {
    let vehicles;
    if (role === 'company' && userId) {
      vehicles = db.prepare('SELECT * FROM vehicles WHERE owner_id = ?').all(userId);
    } else {
      vehicles = db.prepare('SELECT * FROM vehicles').all();
    }

    const leaderboard = vehicles.map(v => {
      const scores = calculateVehicleScore(v);
      return {
        id: v.id,
        name: v.name,
        safetyScore: scores.safety,
        efficiencyScore: scores.efficiency,
        status: (Date.now() - v.last_seen < 300000) ? 'Online' : 'Offline'
      };
    });

    // Sort by Total Score (Safety + Efficiency) DESC
    leaderboard.sort((a, b) => (b.safetyScore + b.efficiencyScore) - (a.safetyScore + a.efficiencyScore));

    res.json(leaderboard);
  } catch (err) {
    console.error("Leaderboard Error", err);
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
});

// Get history for charts
app.get('/api/analytics/history/:vehicleId', (req, res) => {
  const { vehicleId } = req.params;
  const { range } = req.query; // '24h', '7d'

  let timeLimit = Date.now() - 86400000; // Default 24h
  if (range === '7d') timeLimit = Date.now() - (7 * 86400000);

  try {
    const rows = db.prepare(`
            SELECT timestamp, speed, fuel_level, battery_level 
            FROM vehicle_history 
            WHERE vehicle_id = ? AND timestamp > ? 
            ORDER BY timestamp ASC
        `).all(vehicleId, timeLimit);

    // Downsample if too many points (optional optimization)
    res.json(rows);
  } catch (err) {
    console.error("Analytics History Error", err);
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

// SPA catch-all route (must be last) - Catches all non-API routes
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    // Skip API routes
    if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) {
      return next();
    }
    // Serve index.html for all other routes
    const path = require('path');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
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
