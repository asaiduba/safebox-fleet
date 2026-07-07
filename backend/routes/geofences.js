const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authMiddleware, getRequestUserId } = require('../middleware/auth');

// GET all geofences for a vehicle
router.get('/', authMiddleware, (req, res) => {
  const { vehicleId } = req.query;
  const userId = getRequestUserId(req);
  try {
    const user = db.prepare('SELECT subscription_status, role FROM users WHERE id = ?').get(userId);
    if (user && user.subscription_status === 'SUSPENDED' && user.role !== 'admin') {
      return res.json([]);
    }

    const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(vehicleId);
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }
    if (vehicle.owner_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized to access geofences for this vehicle' });
    }

    const geofences = db.prepare('SELECT * FROM geofences WHERE vehicle_id = ?').all(vehicleId);
    res.json(geofences);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch geofences' });
  }
});

// POST add a geofence
router.post('/', authMiddleware, (req, res) => {
  const { vehicleId, lat, lng, radius, type, coordinates } = req.body;
  const userId = getRequestUserId(req);
  try {
    const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(vehicleId);
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }
    if (vehicle.owner_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized to add geofences for this vehicle' });
    }

    const geoType = type || 'circle';
    const coordsJson = coordinates ? JSON.stringify(coordinates) : null;

    const stmt = db.prepare('INSERT INTO geofences (vehicle_id, lat, lng, radius, type, coordinates) VALUES (?, ?, ?, ?, ?, ?)');
    const info = stmt.run(vehicleId, lat || 0, lng || 0, radius || 0, geoType, coordsJson);
    res.json({ id: info.lastInsertRowid, vehicleId, lat, lng, radius, type: geoType, coordinates });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create geofence' });
  }
});

// PUT update geofence
router.put('/:id', authMiddleware, (req, res) => {
  const { lat, lng, radius, type, coordinates } = req.body;
  const userId = getRequestUserId(req);
  try {
    const geofence = db.prepare('SELECT vehicle_id FROM geofences WHERE id = ?').get(req.params.id);
    if (!geofence) {
      return res.status(404).json({ error: 'Geofence not found' });
    }
    const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(geofence.vehicle_id);
    if (!vehicle || vehicle.owner_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized to update this geofence' });
    }

    const geoType = type || 'circle';
    const coordsJson = coordinates ? JSON.stringify(coordinates) : null;

    const stmt = db.prepare('UPDATE geofences SET lat = ?, lng = ?, radius = ?, type = ?, coordinates = ? WHERE id = ?');
    stmt.run(lat || 0, lng || 0, radius || 0, geoType, coordsJson, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update geofence' });
  }
});

// DELETE geofence
router.delete('/:id', authMiddleware, (req, res) => {
  const userId = getRequestUserId(req);
  try {
    const geofence = db.prepare('SELECT vehicle_id FROM geofences WHERE id = ?').get(req.params.id);
    if (!geofence) {
      return res.status(404).json({ error: 'Geofence not found' });
    }
    const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(geofence.vehicle_id);
    if (!vehicle || vehicle.owner_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized to delete this geofence' });
    }

    const stmt = db.prepare('DELETE FROM geofences WHERE id = ?');
    stmt.run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete geofence' });
  }
});

module.exports = router;
