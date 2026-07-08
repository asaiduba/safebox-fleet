const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authMiddleware, getRequestUserId } = require('../middleware/auth');
const { sendWebPushAlert, vapidPublicKey } = require('../utils/notifications');

// --- NOTIFICATION PREFERENCES & WEB PUSH SUBSCRIPTIONS ROUTER ---

// GET /api/notifications/vapid-public-key - Fetch VAPID Public Key for subscription enrollment
router.get('/vapid-public-key', authMiddleware, (req, res) => {
  res.json({ publicKey: vapidPublicKey });
});

// GET /api/notifications/preferences - Retrieve active alert preferences
router.get('/preferences', authMiddleware, (req, res) => {
  const userId = getRequestUserId(req);

  try {
    const preferences = db.prepare(`
      SELECT notify_email, notify_sms, notify_push, alert_email, alert_phone, email, phone 
      FROM users 
      WHERE id = ?
    `).get(userId);

    if (!preferences) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    res.json({
      notifyEmail: preferences.notify_email !== 0,
      notifySms: preferences.notify_sms !== 0,
      notifyPush: preferences.notify_push !== 0,
      alertEmail: preferences.alert_email || '',
      alertPhone: preferences.alert_phone || '',
      defaultEmail: preferences.email || '',
      defaultPhone: preferences.phone || ''
    });
  } catch (err) {
    console.error('Fetch notification preferences failed:', err);
    res.status(500).json({ error: 'Failed to retrieve notification preferences' });
  }
});

// POST /api/notifications/preferences - Save alert preferences and alert contact details
router.post('/preferences', authMiddleware, (req, res) => {
  const userId = getRequestUserId(req);
  const { notifyEmail, notifySms, notifyPush, alertEmail, alertPhone } = req.body;

  try {
    const stmt = db.prepare(`
      UPDATE users 
      SET notify_email = ?,
          notify_sms = ?,
          notify_push = ?,
          alert_email = ?,
          alert_phone = ?
      WHERE id = ?
    `);

    stmt.run(
      notifyEmail ? 1 : 0,
      notifySms ? 1 : 0,
      notifyPush ? 1 : 0,
      alertEmail ? alertEmail.trim() : null,
      alertPhone ? alertPhone.trim() : null,
      userId
    );

    res.json({ success: true, message: 'Notification preferences updated successfully' });
  } catch (err) {
    console.error('Update notification preferences failed:', err);
    res.status(500).json({ error: 'Failed to update notification preferences' });
  }
});

// POST /api/notifications/subscribe - Save browser Web Push subscription credentials
router.post('/subscribe', authMiddleware, (req, res) => {
  const userId = getRequestUserId(req);
  const { subscription } = req.body;

  if (!subscription || !subscription.endpoint || !subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
    return res.status(400).json({ error: 'Invalid Web Push subscription structure.' });
  }

  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      userId,
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      Date.now()
    );

    console.log(`🔔 Registered new browser push subscription for user: ${userId}`);
    res.json({ success: true, message: 'Browser enrolled in push notifications successfully' });
  } catch (err) {
    console.error('Enroll push subscription failed:', err);
    res.status(500).json({ error: 'Failed to enroll browser in push notifications' });
  }
});

// POST /api/notifications/test-push - Send a test Web Push alert
router.post('/test-push', authMiddleware, async (req, res) => {
  const userId = getRequestUserId(req);

  try {
    await sendWebPushAlert(
      userId,
      'SafeBox Alert Test',
      'This is a test notification confirming browser push subscription works successfully!'
    );
    res.json({ success: true, message: 'Test push notification fired' });
  } catch (err) {
    console.error('Test push notification failed:', err);
    res.status(500).json({ error: 'Failed to send test push notification' });
  }
});

module.exports = router;
