const { db } = require('../db');

/**
 * Log an administrator/manager/system action into the database.
 * @param {number|null} userId - The ID of the operator user.
 * @param {string|null} username - The username of the operator user.
 * @param {string} action - The action string description.
 * @param {string|null} targetId - The target vehicle ID, user ID, driver ID, etc.
 * @param {object|string|null} details - Structured parameters or extra textual description.
 * @param {object|null} req - Express Request object to extract IP address.
 */
function logAuditAction(userId, username, action, targetId = null, details = null, req = null) {
    try {
        let ipAddress = 'system';
        if (req) {
            ipAddress = req.headers['x-forwarded-for'] || 
                        req.socket.remoteAddress || 
                        req.ip || 
                        'unknown';
            // Clean IPv6 prefix if local
            if (ipAddress === '::1') {
                ipAddress = '127.0.0.1';
            } else if (ipAddress.startsWith('::ffff:')) {
                ipAddress = ipAddress.substring(7);
            }
        }

        let detailsStr = null;
        if (details) {
            if (typeof details === 'object') {
                detailsStr = JSON.stringify(details);
            } else {
                detailsStr = String(details);
            }
        }

        const stmt = db.prepare(`
            INSERT INTO audit_logs (user_id, username, action, target_id, details, ip_address, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(userId || null, username || null, action, targetId || null, detailsStr, ipAddress, Date.now());
    } catch (err) {
        console.error('❌ Failed to log system audit action:', err.message);
    }
}

module.exports = { logAuditAction };
