const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authMiddleware, getRequestUserId } = require('../middleware/auth');
const reportsService = require('../reportsService');
const analyticsService = require('../analyticsService');

// GET Live Preview Analytics
router.get('/analytics', authMiddleware, (req, res) => {
  const userId = req.user.id;
  const { vehicleIds, range, customStart, customEnd } = req.query;

  try {
    let selectIds = [];
    if (!vehicleIds || vehicleIds === 'all') {
      const owned = db.prepare('SELECT id FROM vehicles WHERE owner_id = ?').all(userId);
      selectIds = owned.map(o => o.id);
    } else {
      selectIds = vehicleIds.split(',');
    }

    if (selectIds.length === 0) {
      return res.json({
        totalVehicles: 0,
        onlineVehicles: 0,
        offlineVehicles: 0,
        totalDistance: 0,
        totalIdleTime: 0,
        utilization: 0,
        totalAlerts: 0
      });
    }

    const { startTime, endTime } = reportsService.getDateRange(range, customStart, customEnd);

    let totalDistance = 0;
    let totalIdleTime = 0;
    let totalAlerts = 0;
    let onlineVehicles = 0;

    const vehicles = db.prepare('SELECT id, last_seen FROM vehicles').all().filter(v => selectIds.includes(v.id));
    vehicles.forEach(v => {
      totalDistance += analyticsService.calculateDistance(v.id, startTime, endTime);
      totalIdleTime += analyticsService.calculateIdleTime(v.id, startTime, endTime);
      
      const isOnline = Date.now() - v.last_seen < 120000;
      if (isOnline) onlineVehicles++;

      const alertCount = db.prepare('SELECT COUNT(*) as cnt FROM vehicle_alerts WHERE vehicle_id = ? AND timestamp >= ? AND timestamp <= ?').get(v.id, startTime, endTime);
      totalAlerts += alertCount.cnt;
    });

    const utilization = analyticsService.calculateFleetUtilization(selectIds, startTime, endTime);

    res.json({
      totalVehicles: vehicles.length,
      onlineVehicles,
      offlineVehicles: vehicles.length - onlineVehicles,
      totalDistance: parseFloat(totalDistance.toFixed(2)),
      totalIdleTime: Math.round(totalIdleTime),
      utilization,
      totalAlerts
    });
  } catch (err) {
    console.error('Fetch live preview analytics failed:', err);
    res.status(500).json({ error: 'Failed to retrieve preview analytics' });
  }
});

// POST Generate Report Asynchronously
router.post('/generate', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const username = req.user.username;
  const { reportType, vehicleIds, driverIds, range, customStart, customEnd, format } = req.body;

  try {
    let selectIds = vehicleIds;
    if (!selectIds || selectIds.length === 0 || selectIds[0] === 'all') {
      const owned = db.prepare('SELECT id FROM vehicles WHERE owner_id = ?').all(userId);
      selectIds = owned.map(o => o.id);
    }

    const reportId = 'rep_' + Date.now() + Math.random().toString(36).substr(2, 5);

    db.prepare(`
      INSERT INTO reports (id, user_id, status, progress, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(reportId, userId, 'PENDING', 0, Date.now());

    reportsService.processReportAsync(
      reportId,
      userId,
      reportType,
      selectIds,
      driverIds || [],
      range,
      customStart,
      customEnd,
      format || 'PDF',
      username
    ).catch(err => {
      console.error(`Background report task ${reportId} error:`, err);
    });

    res.status(202).json({ reportId, status: 'PENDING' });
  } catch (err) {
    console.error('Trigger report generation error:', err);
    res.status(500).json({ error: 'Failed to initiate report generation' });
  }
});

// GET Check Async Report Status
router.get('/status/:id', authMiddleware, (req, res) => {
  try {
    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
    if (!report) {
      return res.status(404).json({ error: 'Report task not found' });
    }
    
    let result = null;
    if (report.status === 'COMPLETED') {
      result = db.prepare('SELECT * FROM report_history WHERE generated_by = ? ORDER BY generated_at DESC LIMIT 1').get(report.user_id);
    }

    res.json({
      id: report.id,
      status: report.status,
      progress: report.progress,
      error: report.error,
      result
    });
  } catch (err) {
    console.error('Check report status error:', err);
    res.status(500).json({ error: 'Failed to retrieve report status' });
  }
});

// GET Retrieve Reports Archive History
router.get('/history', authMiddleware, (req, res) => {
  const userId = getRequestUserId(req);
  try {
    const history = db.prepare(`
      SELECT * FROM report_history 
      WHERE generated_by = ? 
      ORDER BY generated_at DESC
    `).all(userId);
    res.json(history);
  } catch (err) {
    console.error('Fetch reports history error:', err);
    res.status(500).json({ error: 'Failed to fetch reports history' });
  }
});

// GET Get Report Schedules
router.get('/schedules', authMiddleware, (req, res) => {
  const userId = getRequestUserId(req);
  try {
    const schedules = db.prepare('SELECT * FROM report_schedules WHERE user_id = ?').all(userId);
    res.json(schedules);
  } catch (err) {
    console.error('Fetch report schedules failed:', err);
    res.status(500).json({ error: 'Failed to load report schedules' });
  }
});

// POST Create Report Schedule
router.post('/schedules', authMiddleware, (req, res) => {
  const userId = getRequestUserId(req);
  const { frequency, recipients, reportType, deliveryMethod, timeOfDelivery } = req.body;

  if (!frequency || !recipients || !reportType || !deliveryMethod || !timeOfDelivery) {
    return res.status(400).json({ error: 'Missing required configuration fields' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO report_schedules (user_id, frequency, recipients, report_type, delivery_method, time_of_delivery, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, frequency, recipients, reportType, deliveryMethod, timeOfDelivery, Date.now());

    res.status(201).json({ id: result.lastInsertRowid, message: 'Schedule established successfully' });
  } catch (err) {
    console.error('Create report schedule failed:', err);
    res.status(500).json({ error: 'Failed to establish report schedule' });
  }
});

// DELETE Delete Report Schedule
router.delete('/schedules/:id', authMiddleware, (req, res) => {
  const userId = getRequestUserId(req);
  const scheduleId = req.params.id;

  try {
    const schedule = db.prepare('SELECT user_id FROM report_schedules WHERE id = ?').get(scheduleId);
    if (!schedule) {
      return res.status(404).json({ error: 'Schedule not found' });
    }
    if (schedule.user_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized to delete this schedule' });
    }

    db.prepare('DELETE FROM report_schedules WHERE id = ?').run(scheduleId);
    res.json({ message: 'Schedule removed successfully' });
  } catch (err) {
    console.error('Delete report schedule failed:', err);
    res.status(500).json({ error: 'Failed to remove schedule' });
  }
});

// GET Get Fuel & Cost Fleet Settings
router.get('/fuel-settings', authMiddleware, (req, res) => {
  const userId = getRequestUserId(req);
  try {
    const settings = db.prepare(`
      SELECT v.id, v.name, v.driver_name, f.fuel_type, f.fuel_price, f.fuel_efficiency 
      FROM vehicles v 
      LEFT JOIN fuel_settings f ON v.id = f.vehicle_id 
      WHERE v.owner_id = ?
    `).all(userId);
    res.json(settings);
  } catch (err) {
    console.error('Get fuel settings failed:', err);
    res.status(500).json({ error: 'Failed to load fuel configurations' });
  }
});

// POST Update Fuel & Cost Setting
router.post('/fuel-settings', authMiddleware, (req, res) => {
  const userId = getRequestUserId(req);
  const { vehicleId, vehicleIds, fuelType, fuelPrice, fuelEfficiency } = req.body;

  const idsToProcess = vehicleIds && Array.isArray(vehicleIds) ? vehicleIds : (vehicleId ? [vehicleId] : []);

  if (idsToProcess.length === 0) {
    return res.status(400).json({ error: 'Vehicle ID(s) are required' });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO fuel_settings (vehicle_id, fuel_type, fuel_price, fuel_efficiency, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(vehicle_id) DO UPDATE SET
        fuel_type = excluded.fuel_type,
        fuel_price = excluded.fuel_price,
        fuel_efficiency = excluded.fuel_efficiency,
        updated_at = excluded.updated_at
    `);

    const runTransaction = db.transaction((ids) => {
      for (const id of ids) {
        const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(id);
        if (!vehicle || vehicle.owner_id !== userId) {
          throw new Error(`Unauthorized configuration attempt for vehicle ${id}`);
        }
        stmt.run(id, fuelType || 'Premium Petrol', fuelPrice || 1000.0, fuelEfficiency || 12.0, Date.now());
      }
    });

    runTransaction(idsToProcess);
    res.json({ message: 'Fuel & Cost configurations saved' });
  } catch (err) {
    console.error('Save fuel configuration failed:', err);
    res.status(500).json({ error: err.message || 'Failed to save configuration' });
  }
});

module.exports = router;
