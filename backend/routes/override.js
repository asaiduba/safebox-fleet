const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authMiddleware, getRequestUserId } = require('../middleware/auth');
const { logAuditAction } = require('../utils/audit');

// GET all pending override requests for the user's vehicles
router.get('/pending', authMiddleware, (req, res) => {
    const userId = getRequestUserId(req);

    try {
        const rows = db.prepare(`
            SELECT r.id, r.vehicle_id, r.driver_name, r.requested_at, r.status, v.name as vehicle_name
            FROM override_requests r
            JOIN vehicles v ON r.vehicle_id = v.id
            WHERE v.owner_id = ? AND r.status = 'PENDING'
            ORDER BY r.requested_at DESC
        `).all(userId);

        res.json(rows);
    } catch (err) {
        console.error('Failed to fetch pending overrides:', err);
        res.status(500).json({ error: 'Failed to retrieve pending override requests.' });
    }
});

// POST resolve a pending override request
router.post('/resolve', authMiddleware, (req, res) => {
    const userId = getRequestUserId(req);
    const { requestId, status } = req.body;

    if (!requestId || !status) {
        return res.status(400).json({ error: 'requestId and status are required.' });
    }

    const allowedStatuses = ['APPROVED_ONCE', 'APPROVED_MIDNIGHT', 'DENIED'];
    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid resolution status.' });
    }

    try {
        // Fetch request and verify vehicle ownership
        const request = db.prepare(`
            SELECT r.*, v.owner_id, v.name as vehicle_name
            FROM override_requests r
            JOIN vehicles v ON r.vehicle_id = v.id
            WHERE r.id = ?
        `).get(requestId);

        if (!request) {
            return res.status(404).json({ error: 'Override request not found.' });
        }

        if (request.owner_id !== userId && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized to resolve this request.' });
        }

        const now = Date.now();
        let expiresAt = 0;

        if (status === 'APPROVED_ONCE') {
            expiresAt = now + 15 * 60 * 1000; // 15 mins
        } else if (status === 'APPROVED_MIDNIGHT') {
            const midnight = new Date();
            midnight.setHours(23, 59, 59, 999);
            expiresAt = midnight.getTime();
        }

        db.transaction(() => {
            // Update request status
            db.prepare('UPDATE override_requests SET status = ?, resolved_at = ? WHERE id = ?')
              .run(status, now, requestId);

            if (status !== 'DENIED') {
                // Update vehicle override details
                db.prepare(`
                    UPDATE vehicles 
                    SET override_status = ?, override_expires = ?, is_locked = 0, cloud_locked = 0 
                    WHERE id = ?
                `).run(status, expiresAt, request.vehicle_id);

                // Publish MQTT allow start & unlock commands
                const mqttClient = req.app.get('mqttClient');
                if (mqttClient) {
                    mqttClient.publish(`/device/${request.vehicle_id}/command`, JSON.stringify({ command: 'ALLOW_START' }));
                    mqttClient.publish(`/device/${request.vehicle_id}/command`, JSON.stringify({ command: 'UNLOCK' }));
                }

                // Send cloud unlocked via active TCP sockets
                const activeTcpSockets = req.app.get('activeTcpSockets');
                if (activeTcpSockets && activeTcpSockets.has(request.vehicle_id)) {
                    activeTcpSockets.get(request.vehicle_id).write(`$$CMD,${request.vehicle_id},SET_CLOUDLOCKED,0\r\n`);
                }
            } else {
                // If Denied, ensure curfew lock remains active
                db.prepare(`
                    UPDATE vehicles 
                    SET override_status = 'NONE', override_expires = 0, is_locked = 1 
                    WHERE id = ?
                `).run(request.vehicle_id);
            }
        })();

        // Log audit trail
        logAuditAction(
            userId,
            req.user.username,
            status === 'DENIED' ? 'deny_curfew_override' : 'approve_curfew_override',
            request.vehicle_id,
            { requestId, status, expiresAt, vehicleName: request.vehicle_name, driverName: request.driver_name },
            req
        );

        // Broadcast resolution to user room via Socket.io
        const io = req.app.get('io');
        if (io) {
            io.to(`user_${request.owner_id}`).emit('override-resolved', {
                requestId,
                status,
                vehicleId: request.vehicle_id
            });
        }

        res.json({ success: true, message: `Request resolved as ${status}.` });
    } catch (err) {
        console.error('Failed to resolve override request:', err);
        res.status(500).json({ error: 'Failed to resolve override request.' });
    }
});

module.exports = router;
