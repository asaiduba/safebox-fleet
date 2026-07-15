const jwt = require('jsonwebtoken');
const { db } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set.');
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, username, role }

    // Check if user is suspended in the database
    const user = db.prepare('SELECT subscription_status, role FROM users WHERE id = ?').get(decoded.id);

    if (user && user.subscription_status === 'SUSPENDED' && user.role !== 'admin') {
      const basePath = req.originalUrl.split('?')[0];
      const isAllowed = 
        basePath.startsWith('/api/profile') || 
        basePath.startsWith('/api/payments') || 
        basePath.startsWith('/api/subscriptions') || 
        (basePath === '/api/vehicles' && req.method === 'GET') ||
        (basePath === '/api/geofences' && req.method === 'GET') ||
        (basePath === '/api/override/pending' && req.method === 'GET');

      if (!isAllowed) {
        return res.status(403).json({ error: 'Your subscription is suspended. Please renew your plan in Settings -> Billing to restore tracking and controls.' });
      }
    }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
}

function adminMiddleware(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Forbidden. Super Admin access required.' });
  }
}

function getRequestUserId(req) {
  if (req.user && req.user.role === 'admin' && req.headers['x-impersonate-user-id']) {
    const parsed = parseInt(req.headers['x-impersonate-user-id'], 10);
    return isNaN(parsed) ? req.user.id : parsed;
  }
  return req.user.id;
}

module.exports = {
  authMiddleware,
  adminMiddleware,
  getRequestUserId,
  JWT_SECRET
};
