const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authMiddleware, getRequestUserId } = require('../middleware/auth');
const { getDistanceFromLatLonInKm } = require('../utils/helpers');

// Helper: Calculate Vehicle Scores from vehicle_alerts (7-day window)
function calculateVehicleScore(vehicle) {
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

  const alerts = db.prepare(`
    SELECT type, COUNT(*) as count FROM vehicle_alerts
    WHERE vehicle_id = ? AND timestamp > ?
    GROUP BY type
  `).all(vehicle.id, sevenDaysAgo);

  const alertMap = {};
  alerts.forEach(a => { alertMap[a.type] = a.count; });

  let safetyScore = 100;

  const speeding = alertMap['SPEEDING'] || 0;
  const harshAccel = alertMap['HARSH_ACCEL'] || 0;
  const harshBrake = alertMap['HARSH_BRAKE'] || 0;
  const startBlocked = alertMap['START_ATTEMPT_BLOCKED'] || 0;
  const curfewViolation = alertMap['CURFEW_VIOLATION'] || 0;
  const geofenceBreach = alertMap['GEOFENCE_BREACH'] || 0;
  const fuelTheft = alertMap['FUEL_THEFT'] || 0;

  safetyScore -= (speeding * 2);        
  safetyScore -= (harshAccel * 3);      
  safetyScore -= (harshBrake * 3);      
  safetyScore -= (startBlocked * 4);    
  safetyScore -= (curfewViolation * 4); 
  safetyScore -= (geofenceBreach * 2);  
  safetyScore -= (fuelTheft * 10);      

  const history = db.prepare(`
    SELECT speed, fuel_level, battery_level, lat, lng, timestamp
    FROM vehicle_history WHERE vehicle_id = ? AND timestamp > ?
    ORDER BY timestamp ASC
  `).all(vehicle.id, sevenDaysAgo);

  let efficiencyScore = 100;
  let idleRatio = 0;
  let optimalSpeedRatio = 0;
  let kmPerLiter = 0;

  if (history.length >= 2) {
    const totalEntries = history.length;
    const idleEntries = history.filter(h => h.speed === 0).length;
    idleRatio = Math.round((idleEntries / totalEntries) * 100);

    if (idleRatio > 60) efficiencyScore -= 25;
    else if (idleRatio > 40) efficiencyScore -= 15;
    else if (idleRatio > 30) efficiencyScore -= 5;

    const movingEntries = history.filter(h => h.speed > 0);
    if (movingEntries.length > 0) {
      const optimalEntries = movingEntries.filter(h => h.speed >= 20 && h.speed <= 80);
      optimalSpeedRatio = Math.round((optimalEntries.length / movingEntries.length) * 100);

      if (optimalSpeedRatio < 40) efficiencyScore -= 20;
      else if (optimalSpeedRatio < 60) efficiencyScore -= 10;
      else if (optimalSpeedRatio < 75) efficiencyScore -= 5;
    }

    let totalDistanceKm = 0;
    let totalFuelConsumed = 0;

    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1];
      const curr = history[i];

      if (curr.speed > 0 && prev.lat && prev.lng && curr.lat && curr.lng) {
        totalDistanceKm += getDistanceFromLatLonInKm(prev.lat, prev.lng, curr.lat, curr.lng);
      }

      const fuelDiff = prev.fuel_level - curr.fuel_level;
      if (fuelDiff > 0 && fuelDiff < 10) { 
        totalFuelConsumed += fuelDiff;
      }
    }

    if (totalDistanceKm > 0.5) { 
      if (totalFuelConsumed > 0) {
        const litersConsumed = totalFuelConsumed * 0.1;
        kmPerLiter = totalDistanceKm / litersConsumed;
      } else {
        kmPerLiter = 15.0; 
      }

      if (kmPerLiter < 3.0) efficiencyScore -= 20;
      else if (kmPerLiter < 5.0) efficiencyScore -= 10;
      else if (kmPerLiter < 8.0) efficiencyScore -= 5;
    }
  } else {
    efficiencyScore = 100;
  }

  if (vehicle.fuel_level < 15) efficiencyScore -= 5;
  if (vehicle.battery_level < 15) efficiencyScore -= 5;

  return {
    safety: Math.max(0, Math.min(100, safetyScore)),
    efficiency: Math.max(0, Math.min(100, efficiencyScore)),
    breakdown: {
      speeding,
      harshAccel,
      harshBrake,
      startBlocked,
      curfewViolation,
      geofenceBreach,
      fuelTheft
    },
    efficiencyBreakdown: {
      idleRatio,           
      optimalSpeedRatio,   
      kmPerLiter: kmPerLiter > 0 ? (Math.round(kmPerLiter * 10) / 10) : 0, 
      dataPoints: history.length
    }
  };
}

// GET aggregated stats
router.get('/stats', authMiddleware, (req, res) => {
  const userId = getRequestUserId(req);
  try {
    const totalVehicles = db.prepare('SELECT COUNT(*) as count FROM vehicles WHERE owner_id = ?').get(userId).count;

    const fiveMinsAgo = Date.now() - 300000;
    const activeVehicles = db.prepare('SELECT COUNT(*) as count FROM vehicles WHERE owner_id = ? AND last_seen > ?').get(userId, fiveMinsAgo).count;

    const criticalAlerts = db.prepare('SELECT COUNT(*) as count FROM vehicles WHERE owner_id = ? AND (battery_level < 20 OR fuel_level < 15)').get(userId).count;

    const avgFuel = db.prepare('SELECT AVG(fuel_level) as avg FROM vehicles WHERE owner_id = ?').get(userId).avg;

    const vehiclesForStats = db.prepare('SELECT * FROM vehicles WHERE owner_id = ?').all(userId);

    let totalSafety = 0;
    let avgSafety = 100;
    if (vehiclesForStats.length > 0) {
      vehiclesForStats.forEach(v => {
        totalSafety += calculateVehicleScore(v).safety;
      });
      avgSafety = Math.round(totalSafety / vehiclesForStats.length);
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

// GET Leaderboard
router.get('/leaderboard', authMiddleware, (req, res) => {
  const userId = getRequestUserId(req);
  try {
    const vehicles = db.prepare('SELECT * FROM vehicles WHERE owner_id = ?').all(userId);

    const leaderboard = vehicles.map(v => {
      const scores = calculateVehicleScore(v);
      return {
        id: v.id,
        name: v.name,
        driverName: v.driver_name || 'Unassigned',
        safetyScore: scores.safety,
        efficiencyScore: scores.efficiency,
        breakdown: scores.breakdown,
        efficiencyBreakdown: scores.efficiencyBreakdown,
        status: (Date.now() - v.last_seen < 300000) ? 'Online' : 'Offline'
      };
    });

    leaderboard.sort((a, b) => (b.safetyScore + b.efficiencyScore) - (a.safetyScore + a.efficiencyScore));

    res.json(leaderboard);
  } catch (err) {
    console.error("Leaderboard Error", err);
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
});

// GET History for charts
router.get('/history/:vehicleId', authMiddleware, (req, res) => {
  const userId = req.user.id;
  const { vehicleId } = req.params;
  const { range } = req.query;

  const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(vehicleId);
  if (!vehicle) {
    return res.status(404).json({ error: 'Vehicle not found' });
  }
  if (vehicle.owner_id !== userId) {
    return res.status(403).json({ error: 'Unauthorized to access history' });
  }

  let timeLimit = Date.now() - 86400000; 
  if (range === '7d') timeLimit = Date.now() - (7 * 86400000);

  try {
    const rows = db.prepare(`
      SELECT timestamp, speed, fuel_level, battery_level 
      FROM vehicle_history 
      WHERE vehicle_id = ? AND timestamp > ? 
      ORDER BY timestamp ASC
    `).all(vehicleId, timeLimit);

    res.json(rows);
  } catch (err) {
    console.error("Analytics History Error", err);
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

// GET Route replay points
router.get('/route/:vehicleId', authMiddleware, (req, res) => {
  const userId = req.user.id;
  const { vehicleId } = req.params;
  const { start, end } = req.query;

  if (!start || !end) {
    return res.status(400).json({ error: 'Start and end timestamps are required' });
  }

  const startTimestamp = parseInt(start);
  const endTimestamp = parseInt(end);

  if (isNaN(startTimestamp) || isNaN(endTimestamp)) {
    return res.status(400).json({ error: 'Invalid start or end timestamp' });
  }

  const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(vehicleId);
  if (!vehicle) {
    return res.status(404).json({ error: 'Vehicle not found' });
  }
  if (vehicle.owner_id !== userId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized to access history' });
  }

  try {
    const rows = db.prepare(`
      SELECT timestamp, speed, battery_level, fuel_level, lat, lng 
      FROM vehicle_history 
      WHERE vehicle_id = ? AND timestamp >= ? AND timestamp <= ? 
      ORDER BY timestamp ASC
    `).all(vehicleId, startTimestamp, endTimestamp);

    res.json(rows);
  } catch (err) {
    console.error("Fetch route replay error:", err);
    res.status(500).json({ error: "Failed to fetch route replay history" });
  }
});

// GET Daily travel history
router.get('/:vehicleId/history', authMiddleware, (req, res) => {
  const userId = req.user.id;
  const { vehicleId } = req.params;
  const { date } = req.query; 

  if (!date) {
    return res.status(400).json({ error: "Date parameter is required (YYYY-MM-DD)" });
  }

  const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(vehicleId);
  if (!vehicle) {
    return res.status(404).json({ error: 'Vehicle not found' });
  }
  if (vehicle.owner_id !== userId) {
    return res.status(403).json({ error: 'Unauthorized to access history' });
  }

  try {
    const startOfDay = new Date(`${date}T00:00:00`).getTime();
    const endOfDay = new Date(`${date}T23:59:59.999`).getTime();

    const rows = db.prepare(`
      SELECT timestamp, speed, battery_level, fuel_level, lat, lng 
      FROM vehicle_history 
      WHERE vehicle_id = ? AND timestamp >= ? AND timestamp <= ? 
      ORDER BY timestamp ASC
    `).all(vehicleId, startOfDay, endOfDay);

    res.json(rows);
  } catch (err) {
    console.error("Fetch vehicle history error:", err);
    res.status(500).json({ error: "Failed to fetch vehicle history" });
  }
});

module.exports = router;
