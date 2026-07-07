const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const https = require('https');
const { db } = require('../db');
const { authMiddleware, getRequestUserId } = require('../middleware/auth');

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || 'sk_test_mock_paystack_secret_key_123456';
const PLAN_PRICE_MONTHLY = 3000; 
const PLAN_PRICE_ANNUAL = 30000; 
const PLAN_PRICE_PER_VEHICLE = PLAN_PRICE_MONTHLY;

function paystackRequest(method, path, bodyData = null) {
  return new Promise((resolve, reject) => {
    const dataString = bodyData ? JSON.stringify(bodyData) : '';
    
    const options = {
      hostname: 'api.paystack.co',
      port: 443,
      path: path,
      method: method,
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type': 'application/json'
      }
    };
    
    if (bodyData) {
      options.headers['Content-Length'] = Buffer.byteLength(dataString);
    }
    
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ data: parsed });
          } else {
            reject({ response: { data: parsed, status: res.statusCode }, message: parsed.message || 'Request failed' });
          }
        } catch (e) {
          reject({ message: 'Failed to parse JSON response', error: e });
        }
      });
    });
    
    req.on('error', (err) => {
      reject({ message: err.message, error: err });
    });
    
    if (bodyData) {
      req.write(dataString);
    }
    req.end();
  });
}

// POST Initialize bulk payment
router.post('/initialize-bulk', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { vehicleIds, billingCycle } = req.body;
  if (!vehicleIds || !Array.isArray(vehicleIds) || vehicleIds.length === 0) {
    return res.status(400).json({ error: 'An array of Vehicle IDs is required.' });
  }

  const cycle = billingCycle === 'annual' ? 'annual' : 'monthly';
  const price = cycle === 'annual' ? PLAN_PRICE_ANNUAL : PLAN_PRICE_MONTHLY;

  try {
    const placeholders = vehicleIds.map(() => '?').join(',');
    const count = db.prepare(`SELECT COUNT(*) as count FROM vehicles WHERE owner_id = ? AND id IN (${placeholders})`).get(userId, ...vehicleIds);
    if (count.count !== vehicleIds.length) {
      return res.status(403).json({ error: 'One or more vehicle IDs are invalid or not owned by you.' });
    }

    const user = db.prepare('SELECT username, email FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const email = user.email || `${user.username}@safebox-fleet.com`;
    const totalAmountKobo = vehicleIds.length * price * 100;

    if (PAYSTACK_SECRET.startsWith('sk_test_mock_')) {
      const mockReference = `ref_mock_${Date.now()}`;
      return res.json({
        authorization_url: `http://localhost:5173/?mock_checkout=true&ref=${mockReference}&userId=${userId}&vehicles=${vehicleIds.join(',')}&cycle=${cycle}`,
        reference: mockReference
      });
    }

    const referer = req.headers.referer || 'http://localhost:5173/';
    const callback_url = referer.split('?')[0];

    const response = await paystackRequest('POST', '/transaction/initialize', {
      email,
      amount: totalAmountKobo,
      callback_url,
      metadata: {
        userId,
        vehicleIds,
        billingCycle: cycle,
        type: 'BULK_SUBSCRIPTION'
      }
    });

    res.json(response.data.data);
  } catch (err) {
    console.error('Paystack initialization failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to initialize payment gateway' });
  }
});

// GET Verify transaction
router.get('/verify/:reference', authMiddleware, async (req, res) => {
  const { reference } = req.params;
  const tokenUserId = req.user.id;
  const io = req.app.get('io');

  try {
    let userId, vehicleIds, cycle;

    const isMockKey = PAYSTACK_SECRET.startsWith('sk_test_mock_');
    if (reference.startsWith('ref_mock_') || isMockKey) {
      const mockQuery = req.query;
      userId = tokenUserId;
      if (mockQuery.vehicles) {
        vehicleIds = mockQuery.vehicles.split(',');
      } else {
        const userVehicles = db.prepare('SELECT id FROM vehicles WHERE owner_id = ?').all(userId);
        vehicleIds = userVehicles.map(v => v.id);
      }
      cycle = mockQuery.cycle === 'annual' ? 'annual' : 'monthly';

      if (vehicleIds.length === 0) {
        return res.status(400).json({ error: 'No vehicles selected for renewal' });
      }

      const placeholders = vehicleIds.map(() => '?').join(',');
      const count = db.prepare(`SELECT COUNT(*) as count FROM vehicles WHERE owner_id = ? AND id IN (${placeholders})`).get(userId, ...vehicleIds);
      if (count.count !== vehicleIds.length) {
        return res.status(403).json({ error: 'One or more vehicle IDs are invalid or not owned by you.' });
      }
    } else {
      try {
        const response = await paystackRequest('GET', `/transaction/verify/${reference}`);
        const data = response.data.data;
        if (data.status !== 'success') {
          return res.status(400).json({ error: 'Payment was not successful' });
        }

        userId = data.metadata.userId;
        vehicleIds = data.metadata.vehicleIds;
        cycle = data.metadata.billingCycle === 'annual' ? 'annual' : 'monthly';

        if (Number(userId) !== Number(tokenUserId)) {
          return res.status(403).json({ error: 'Payment user mismatch' });
        }
      } catch (paystackErr) {
        if (PAYSTACK_SECRET.startsWith('sk_test_') || process.env.NODE_ENV !== 'production') {
          console.warn(`⚠️ Paystack API verification failed: ${paystackErr.message || 'unknown error'}. Falling back to mock verification in development mode.`);
          userId = tokenUserId;
          const userVehicles = db.prepare('SELECT id FROM vehicles WHERE owner_id = ?').all(userId);
          vehicleIds = userVehicles.map(v => v.id);
          cycle = 'monthly';
        } else {
          throw paystackErr;
        }
      }
    }

    const isAnnual = cycle === 'annual';
    const durationDays = isAnnual ? 365 : 30;
    const pricePerVehicle = isAnnual ? PLAN_PRICE_ANNUAL : PLAN_PRICE_MONTHLY;
    const nextExpirationDate = Date.now() + (durationDays * 24 * 60 * 60 * 1000);

    const updateStmt = db.prepare(`
      UPDATE vehicles 
      SET subscription_status = 'ACTIVE', 
          next_billing_date = ?, 
          grace_period_expires = NULL 
      WHERE id = ? AND owner_id = ?
    `);

    const insertPaymentStmt = db.prepare(`
      INSERT OR REPLACE INTO payments (id, user_id, amount, timestamp, status, reference)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction(() => {
      vehicleIds.forEach(vid => {
        updateStmt.run(nextExpirationDate, vid, userId);
      });

      const totalAmount = vehicleIds.length * pricePerVehicle;
      insertPaymentStmt.run(reference, userId, totalAmount, Date.now(), 'SUCCESS', reference);
    });

    transaction();

    if (io) {
      io.to(`user_${userId}`).emit('billing-updated', { userId, status: 'ACTIVE', vehicleIds });
    }

    res.json({ success: true, vehicleIds });
  } catch (err) {
    console.error('Paystack verification failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to verify transaction' });
  }
});

// POST Paystack webhook
router.post('/webhook', (req, res) => {
  const io = req.app.get('io');
  const signature = req.headers['x-paystack-signature'];
  if (!signature && !PAYSTACK_SECRET.startsWith('sk_test_mock_')) {
    return res.status(401).json({ error: 'Signature header is missing' });
  }

  const hash = crypto.createHmac('sha512', PAYSTACK_SECRET).update(JSON.stringify(req.body)).digest('hex');
  if (signature !== hash && !PAYSTACK_SECRET.startsWith('sk_test_mock_')) {
    return res.status(401).json({ error: 'Invalid signature validation' });
  }

  const event = req.body;
  const data = event.data;

  console.log(`🔔 Paystack Webhook Received: ${event.event}`);

  try {
    if (event.event === 'charge.success') {
      const { userId, vehicleIds, billingCycle, type } = data.metadata || {};
      if (type === 'BULK_SUBSCRIPTION' && vehicleIds && Array.isArray(vehicleIds)) {
        const durationDays = billingCycle === 'annual' ? 365 : 30;
        const nextExpirationDate = Date.now() + (durationDays * 24 * 60 * 60 * 1000);
        
        const updateStmt = db.prepare(`
          UPDATE vehicles 
          SET subscription_status = 'ACTIVE', 
              next_billing_date = ?, 
              grace_period_expires = NULL 
          WHERE id = ? AND owner_id = ?
        `);
        
        const transaction = db.transaction(() => {
          vehicleIds.forEach(vid => {
            updateStmt.run(nextExpirationDate, vid, userId);
          });
        });
        transaction();

        if (io) {
          io.to(`user_${userId}`).emit('billing-updated', { userId, status: 'ACTIVE', vehicleIds });
        }
      }
    } 
    else if (event.event === 'invoice.payment_failed' || event.event === 'charge.failed') {
      const { userId, vehicleIds, type } = data.metadata || {};
      if (type === 'BULK_SUBSCRIPTION' && vehicleIds && Array.isArray(vehicleIds)) {
        const fiveDaysLater = Date.now() + (5 * 24 * 60 * 60 * 1000);
        
        const updateStmt = db.prepare(`
          UPDATE vehicles 
          SET subscription_status = 'GRACE_PERIOD', 
              grace_period_expires = ? 
          WHERE id = ? AND owner_id = ?
        `);
        
        const transaction = db.transaction(() => {
          vehicleIds.forEach(vid => {
            updateStmt.run(fiveDaysLater, vid, userId);
          });
        });
        transaction();

        if (io) {
          io.to(`user_${userId}`).emit('billing-updated', { userId, status: 'GRACE_PERIOD', vehicleIds, graceExpires: fiveDaysLater });
        }
      }
    }
    else if (event.event === 'subscription.disable') {
      const { userId, vehicleIds, type } = data.metadata || {};
      if (type === 'BULK_SUBSCRIPTION' && vehicleIds && Array.isArray(vehicleIds)) {
        const updateStmt = db.prepare(`
          UPDATE vehicles 
          SET subscription_status = 'SUSPENDED' 
          WHERE id = ? AND owner_id = ?
        `);
        
        const transaction = db.transaction(() => {
          vehicleIds.forEach(vid => {
            updateStmt.run(vid, userId);
          });
        });
        transaction();

        if (io) {
          io.to(`user_${userId}`).emit('billing-updated', { userId, status: 'SUSPENDED', vehicleIds });
        }
      }
    }

    res.status(200).send('Webhook Processed');
  } catch (err) {
    console.error('Webhook processing failed:', err);
    res.status(500).send('Webhook Processing Error');
  }
});

// POST Simulate Paystack webhook
router.post('/simulate-webhook', authMiddleware, (req, res) => {
  const io = req.app.get('io');
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  const { eventType, userId, vehicleIds } = req.body;
  if (!eventType || !userId || !vehicleIds || !Array.isArray(vehicleIds)) {
    return res.status(400).json({ error: 'eventType, userId, and vehicleIds are required.' });
  }

  console.log(`🔌 Simulated Webhook Triggered: ${eventType}`);

  try {
    if (eventType === 'charge.success') {
      const thirtyDaysLater = Date.now() + (30 * 24 * 60 * 60 * 1000);
      const updateStmt = db.prepare(`
        UPDATE vehicles 
        SET subscription_status = 'ACTIVE', 
            next_billing_date = ?, 
            grace_period_expires = NULL 
        WHERE id = ? AND owner_id = ?
      `);
      
      const transaction = db.transaction(() => {
        vehicleIds.forEach(vid => {
          updateStmt.run(thirtyDaysLater, vid, userId);
        });
      });
      transaction();

      if (io) {
        io.to(`user_${userId}`).emit('billing-updated', { userId, status: 'ACTIVE', vehicleIds });
      }
    } 
    else if (eventType === 'invoice.payment_failed' || eventType === 'charge.failed') {
      const fiveDaysLater = Date.now() + (5 * 24 * 60 * 60 * 1000);
      const updateStmt = db.prepare(`
        UPDATE vehicles 
        SET subscription_status = 'GRACE_PERIOD', 
            grace_period_expires = ? 
        WHERE id = ? AND owner_id = ?
      `);
      
      const transaction = db.transaction(() => {
        vehicleIds.forEach(vid => {
          updateStmt.run(fiveDaysLater, vid, userId);
        });
      });
      transaction();

      if (io) {
        io.to(`user_${userId}`).emit('billing-updated', { userId, status: 'GRACE_PERIOD', vehicleIds, graceExpires: fiveDaysLater });
      }
    }
    else if (eventType === 'subscription.disable') {
      const updateStmt = db.prepare(`
        UPDATE vehicles 
        SET subscription_status = 'SUSPENDED' 
        WHERE id = ? AND owner_id = ?
      `);
      
      const transaction = db.transaction(() => {
        vehicleIds.forEach(vid => {
          updateStmt.run(vid, userId);
        });
      });
      transaction();

      if (io) {
        io.to(`user_${userId}`).emit('billing-updated', { userId, status: 'SUSPENDED', vehicleIds });
      }
    }

    res.json({ success: true, status: 'Mock event processed internally' });
  } catch (err) {
    console.error('Simulated webhook processing failed:', err);
    res.status(500).json({ error: 'Simulator internal routing failed', message: err.message });
  }
});

// GET Payment status
router.get('/status', authMiddleware, (req, res) => {
  const userId = getRequestUserId(req);

  try {
    const history = db.prepare('SELECT * FROM payments WHERE user_id = ? ORDER BY timestamp DESC LIMIT 20').all(userId);
    const vehicleBilling = db.prepare('SELECT id, name, plate_number, subscription_status, grace_period_expires, next_billing_date, curfew_enabled, curfew_start, curfew_end, cloud_locked, ble_beacon_id, ble_beacon_rssi_threshold, beacon_rssi, driver_present FROM vehicles WHERE owner_id = ?').all(userId);

    const mappedVehicles = vehicleBilling.map(v => ({
      ...v,
      beaconRssi: v.beacon_rssi,
      driverPresent: v.driver_present !== 0
    }));

    res.json({
      pricePerVehicle: PLAN_PRICE_PER_VEHICLE,
      vehicles: mappedVehicles,
      history
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve payment details' });
  }
});

module.exports = router;
