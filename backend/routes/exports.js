const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authMiddleware, getRequestUserId } = require('../middleware/auth');
const { logAuditAction } = require('../utils/audit');

// Helper to escape CSV cell value
function escapeCSV(val) {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

// GET /api/exports/travel-history - Stream travel history as CSV
router.get('/travel-history', authMiddleware, (req, res) => {
    const userId = getRequestUserId(req);
    const { vehicleId, startDate, endDate } = req.query;

    if (!vehicleId) {
        return res.status(400).json({ error: 'vehicleId query parameter is required.' });
    }

    try {
        // Validate vehicle ownership
        const vehicle = db.prepare('SELECT owner_id, name FROM vehicles WHERE id = ?').get(vehicleId);
        if (!vehicle) {
            return res.status(404).json({ error: 'Vehicle not found.' });
        }
        if (vehicle.owner_id !== userId && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized to export history for this vehicle.' });
        }

        // Set date range filters
        const start = startDate ? parseInt(startDate) : 0;
        const end = endDate ? parseInt(endDate) : Date.now();

        // Fetch history data
        const rows = db.prepare(`
            SELECT timestamp, speed, battery_level, fuel_level, lat, lng
            FROM vehicle_history
            WHERE vehicle_id = ? AND timestamp >= ? AND timestamp <= ?
            ORDER BY timestamp ASC
        `).all(vehicleId, start, end);

        // Format to CSV string
        let csv = 'Timestamp,Date/Time,Speed (km/h),Battery (%),Fuel (%),Latitude,Longitude\n';
        rows.forEach(row => {
            const dateTimeStr = new Date(row.timestamp).toISOString();
            csv += [
                row.timestamp,
                escapeCSV(dateTimeStr),
                row.speed || 0,
                row.battery_level !== null ? row.battery_level : '',
                row.fuel_level !== null ? row.fuel_level : '',
                row.lat || 0,
                row.lng || 0
            ].join(',') + '\n';
        });

        // Log audit trail
        logAuditAction(
            userId,
            req.user.username,
            'export_travel_history_csv',
            vehicleId,
            { count: rows.length, startDate: start, endDate: end, vehicleName: vehicle.name },
            req
        );

        // Send as download attachment
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=travel_history_${vehicleId}_${Date.now()}.csv`);
        res.status(200).send(csv);

    } catch (err) {
        console.error('Failed to export travel history CSV:', err);
        res.status(500).json({ error: 'Failed to generate travel history CSV.' });
    }
});

// GET /api/exports/alerts - Stream alerts history as CSV
router.get('/alerts', authMiddleware, (req, res) => {
    const userId = getRequestUserId(req);
    const { vehicleId, startDate, endDate } = req.query;

    try {
        let rows;
        let start = startDate ? parseInt(startDate) : 0;
        let end = endDate ? parseInt(endDate) : Date.now();

        if (vehicleId) {
            // Validate vehicle ownership
            const vehicle = db.prepare('SELECT owner_id, name FROM vehicles WHERE id = ?').get(vehicleId);
            if (!vehicle) {
                return res.status(404).json({ error: 'Vehicle not found.' });
            }
            if (vehicle.owner_id !== userId && req.user.role !== 'admin') {
                return res.status(403).json({ error: 'Unauthorized to export alerts for this vehicle.' });
            }

            rows = db.prepare(`
                SELECT a.id, a.vehicle_id, a.type, a.message, a.timestamp, a.status, v.name as vehicle_name
                FROM vehicle_alerts a
                JOIN vehicles v ON a.vehicle_id = v.id
                WHERE a.vehicle_id = ? AND a.timestamp >= ? AND a.timestamp <= ?
                ORDER BY a.timestamp DESC
            `).all(vehicleId, start, end);
        } else {
            // All vehicles owned by user
            rows = db.prepare(`
                SELECT a.id, a.vehicle_id, a.type, a.message, a.timestamp, a.status, v.name as vehicle_name
                FROM vehicle_alerts a
                JOIN vehicles v ON a.vehicle_id = v.id
                WHERE v.owner_id = ? AND a.timestamp >= ? AND a.timestamp <= ?
                ORDER BY a.timestamp DESC
            `).all(userId, start, end);
        }

        // Format to CSV string
        let csv = 'Alert ID,Vehicle ID,Vehicle Name,Alert Type,Message,Timestamp,Date/Time,Status\n';
        rows.forEach(row => {
            const dateTimeStr = new Date(row.timestamp).toISOString();
            csv += [
                row.id,
                escapeCSV(row.vehicle_id),
                escapeCSV(row.vehicle_name),
                escapeCSV(row.type),
                escapeCSV(row.message),
                row.timestamp,
                escapeCSV(dateTimeStr),
                escapeCSV(row.status)
            ].join(',') + '\n';
        });

        // Log audit trail
        logAuditAction(
            userId,
            req.user.username,
            'export_alerts_csv',
            vehicleId || 'all_vehicles',
            { count: rows.length, startDate: start, endDate: end },
            req
        );

        // Send as download attachment
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=alerts_${Date.now()}.csv`);
        res.status(200).send(csv);

    } catch (err) {
        console.error('Failed to export alerts CSV:', err);
        res.status(500).json({ error: 'Failed to generate alerts CSV.' });
    }
});

module.exports = router;
