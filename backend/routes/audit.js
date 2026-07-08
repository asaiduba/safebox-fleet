const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authMiddleware, adminMiddleware, getRequestUserId } = require('../middleware/auth');

// GET /api/audit-logs - Query audit trail
router.get('/', authMiddleware, (req, res) => {
    const userId = getRequestUserId(req);
    const userRole = req.user.role;

    try {
        let rows;
        if (userRole === 'admin') {
            // Admin can view all audit logs
            rows = db.prepare(`
                SELECT a.*, u.username as operator_username
                FROM audit_logs a
                LEFT JOIN users u ON a.user_id = u.id
                ORDER BY a.timestamp DESC
                LIMIT 200
            `).all();
        } else {
            // Managers and individuals see logs where they are the operator OR targeting their vehicles
            rows = db.prepare(`
                SELECT a.*, u.username as operator_username
                FROM audit_logs a
                LEFT JOIN users u ON a.user_id = u.id
                WHERE a.user_id = ? OR a.target_id IN (
                    SELECT id FROM vehicles WHERE owner_id = ?
                )
                ORDER BY a.timestamp DESC
                LIMIT 200
            `).all(userId, userId);
        }

        res.json(rows);
    } catch (err) {
        console.error('Fetch audit logs failed:', err);
        res.status(500).json({ error: 'Failed to retrieve system audit logs.' });
    }
});

module.exports = router;
