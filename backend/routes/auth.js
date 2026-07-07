const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { db } = require('../db');
const { sendVerificationEmail } = require('../utils/helpers');
const { authMiddleware, JWT_SECRET } = require('../middleware/auth');

const JWT_EXPIRES_IN = '7d';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: 'Too many attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many accounts created. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { error: 'Too many verification attempts. Please wait 10 minutes before trying again.' },
  standardHeaders: true,
  legacyHeaders: false
});

router.post('/register', registerLimiter, async (req, res) => {
  const { username, password, role, companyName, email, phone } = req.body;

  if (!username || !password || !role || !email || !phone) {
    return res.status(400).json({ error: 'Username, password, role, email, and phone are required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  if (!['individual', 'company'].includes(role)) {
    return res.status(400).json({ error: 'Role must be individual or company.' });
  }
  if (role === 'company' && !companyName) {
    return res.status(400).json({ error: 'Company Name is required for company accounts.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email address format.' });
  }

  try {
    const existingUser = db.prepare('SELECT id, username, email, phone FROM users WHERE username = ? OR email = ? OR phone = ?').get(username, email, phone);
    if (existingUser) {
      if (existingUser.username.toLowerCase() === username.toLowerCase()) {
        return res.status(400).json({ error: 'Username is already taken.' });
      }
      if (existingUser.email.toLowerCase() === email.toLowerCase()) {
        return res.status(400).json({ error: 'Email address is already in use.' });
      }
      if (existingUser.phone === phone) {
        return res.status(400).json({ error: 'Phone number is already in use.' });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationExpires = Date.now() + 15 * 60 * 1000;

    const stmt = db.prepare('INSERT INTO users (username, password, role, company_name, email, phone, is_verified, verification_code, verification_expires) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)');
    stmt.run(username, hashedPassword, role, role === 'company' ? companyName : null, email, phone, verificationCode, verificationExpires);

    const emailResult = await sendVerificationEmail(email, username, verificationCode);

    res.json({
      success: true,
      needsVerification: true,
      email,
      devVerificationCode: (emailResult && emailResult.success) ? null : verificationCode
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', authLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.is_verified === 0) {
      let verificationCode = user.verification_code;
      let expires = user.verification_expires;
      let emailSent = false;

      if (!verificationCode || Date.now() > expires) {
        verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        expires = Date.now() + 15 * 60 * 1000;
        db.prepare('UPDATE users SET verification_code = ?, verification_expires = ? WHERE id = ?').run(verificationCode, expires, user.id);
      }

      const emailResult = await sendVerificationEmail(user.email, user.username, verificationCode);
      emailSent = emailResult && emailResult.success;

      return res.status(403).json({ 
        error: 'Please verify your email address. A verification code has been sent.', 
        needsVerification: true, 
        email: user.email,
        devVerificationCode: emailSent ? null : verificationCode
      });
    }

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({ id: user.id, username: user.username, role: user.role, token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/verify-email', otpLimiter, async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) {
    return res.status(400).json({ error: 'Email and verification code are required.' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (user.is_verified === 1) {
      return res.status(400).json({ error: 'Account is already verified.' });
    }

    if (user.verification_code !== code) {
      return res.status(400).json({ error: 'Invalid verification code.' });
    }

    if (Date.now() > user.verification_expires) {
      return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
    }

    db.prepare('UPDATE users SET is_verified = 1, verification_code = NULL, verification_expires = NULL WHERE id = ?').run(user.id);

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({ id: user.id, username: user.username, role: user.role, token });
  } catch (err) {
    console.error('Email verification failed:', err);
    res.status(500).json({ error: 'Verification failed.' });
  }
});

router.post('/resend-verification', otpLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (user.is_verified === 1) {
      return res.status(400).json({ error: 'Account is already verified.' });
    }

    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationExpires = Date.now() + 15 * 60 * 1000;

    db.prepare('UPDATE users SET verification_code = ?, verification_expires = ? WHERE id = ?').run(verificationCode, verificationExpires, user.id);

    const emailResult = await sendVerificationEmail(email, user.username, verificationCode);

    res.json({
      success: true,
      message: 'Verification code resent successfully.',
      devVerificationCode: (emailResult && emailResult.success) ? null : verificationCode
    });
  } catch (err) {
    console.error('Failed to resend verification code:', err);
    res.status(500).json({ error: 'Failed to resend verification code.' });
  }
});

router.post('/forgot-password', otpLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(404).json({ error: 'No account found with this email address.' });
    }

    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationExpires = Date.now() + 10 * 60 * 1000;

    db.prepare('UPDATE users SET verification_code = ?, verification_expires = ? WHERE id = ?')
      .run(verificationCode, verificationExpires, user.id);

    const emailResult = await sendVerificationEmail(email, user.username, verificationCode, 'password_reset');

    res.json({
      success: true,
      message: 'Password reset code sent to your email.',
      devVerificationCode: (emailResult && emailResult.success) ? null : verificationCode
    });
  } catch (err) {
    console.error('Forgot password request failed:', err);
    res.status(500).json({ error: 'Failed to send reset code.' });
  }
});

router.post('/reset-password', otpLimiter, async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) {
    return res.status(400).json({ error: 'Email, verification code, and new password are required.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (user.verification_code !== code) {
      return res.status(400).json({ error: 'Invalid verification code.' });
    }

    if (Date.now() > user.verification_expires) {
      return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    db.prepare('UPDATE users SET password = ?, verification_code = NULL, verification_expires = NULL WHERE id = ?')
      .run(hashedPassword, user.id);

    res.json({ success: true, message: 'Password has been reset successfully. You can now log in.' });
  } catch (err) {
    console.error('Password reset failed:', err);
    res.status(500).json({ error: 'Failed to reset password.' });
  }
});

router.post('/profile/request-password-change-otp', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { oldPassword } = req.body;

  if (!oldPassword) {
    return res.status(400).json({ error: 'Current password is required.' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const passwordMatch = await bcrypt.compare(oldPassword, user.password);
    if (!passwordMatch) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }

    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationExpires = Date.now() + 10 * 60 * 1000;

    db.prepare('UPDATE users SET verification_code = ?, verification_expires = ? WHERE id = ?')
      .run(verificationCode, verificationExpires, userId);

    const emailResult = await sendVerificationEmail(user.email, user.username, verificationCode, 'password_change');

    res.json({
      success: true,
      message: 'Verification OTP sent to your email.',
      devVerificationCode: (emailResult && emailResult.success) ? null : verificationCode
    });
  } catch (err) {
    console.error('Failed to request password change OTP:', err);
    res.status(500).json({ error: 'Failed to request verification code.' });
  }
});

router.post('/profile/update', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { email, phone, companyName, currency, password, oldPassword, otpCode } = req.body;
  const mqttClient = req.app.get('mqttClient');

  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    let query = 'UPDATE users SET email = ?, phone = ?, company_name = ?, currency = ?';
    const params = [email, phone, companyName, currency || 'NGN'];

    if (password) {
      if (!oldPassword || !otpCode) {
        return res.status(400).json({ error: 'Current password and verification code are required to change your password.' });
      }

      if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters.' });
      }

      const passwordMatch = await bcrypt.compare(oldPassword, user.password);
      if (!passwordMatch) {
        return res.status(400).json({ error: 'Current password is incorrect.' });
      }

      if (user.verification_code !== otpCode) {
        return res.status(400).json({ error: 'Invalid verification code.' });
      }

      if (Date.now() > user.verification_expires) {
        return res.status(400).json({ error: 'Verification code has expired. Please request a new code.' });
      }

      query += ', password = ?, verification_code = NULL, verification_expires = NULL';
      const hashedPassword = await bcrypt.hash(password, 12);
      params.push(hashedPassword);
    }

    query += ' WHERE id = ?';
    params.push(userId);

    const stmt = db.prepare(query);
    stmt.run(...params);

    const vehicles = db.prepare('SELECT id FROM vehicles WHERE owner_id = ?').all(userId);
    if (mqttClient) {
      vehicles.forEach(v => {
        const topic = `/device/${v.id}/command`;
        mqttClient.publish(topic, `CONFIG_PHONE:${phone}`);
      });
    }

    res.json({ success: true, message: 'Profile updated successfully' });
  } catch (err) {
    console.error('Profile update failed:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// POST Generate diagnostic support code
router.post('/support/generate-code', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  try {
    const digits = Math.floor(1000 + Math.random() * 9000).toString();
    const code = `SUP-${digits}`;
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

    const stmt = db.prepare('INSERT OR REPLACE INTO support_codes (code, user_id, expires_at) VALUES (?, ?, ?)');
    stmt.run(code, userId, expiresAt);

    res.json({ code, expiresAt });
  } catch (err) {
    console.error('Generate support code error:', err);
    res.status(500).json({ error: 'Failed to generate support code' });
  }
});

// GET Verify diagnostic support code and fetch diagnostics (unauthenticated)
router.get('/support/verify/:code', async (req, res) => {
  const { code } = req.params;

  try {
    const record = db.prepare('SELECT * FROM support_codes WHERE code = ?').get(code);
    if (!record) {
      return res.status(404).json({ error: 'Invalid support code.' });
    }

    if (Date.now() > record.expires_at) {
      db.prepare('DELETE FROM support_codes WHERE code = ?').run(code);
      return res.status(410).json({ error: 'Support code has expired.' });
    }

    const userId = record.user_id;

    const user = db.prepare('SELECT id, username, role, company_name, email, phone, plan_id, subscription_status FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User associated with support code not found.' });
    }

    const vehicles = db.prepare('SELECT * FROM vehicles WHERE owner_id = ?').all(userId);

    const vehicleDiagnostics = vehicles.map(vehicle => {
      const history = db.prepare('SELECT timestamp, speed, battery_level, fuel_level, lat, lng FROM vehicle_history WHERE vehicle_id = ? ORDER BY timestamp DESC LIMIT 15').all(vehicle.id);
      const geofences = db.prepare('SELECT id, lat, lng, radius FROM geofences WHERE vehicle_id = ?').all(vehicle.id);
      const maintenance = db.prepare('SELECT id, type, custom_name, threshold_km, last_service_km, due_date, notes, status FROM maintenance_reminders WHERE vehicle_id = ?').all(vehicle.id);

      return {
        id: vehicle.id,
        name: vehicle.name,
        plate_number: vehicle.plate_number,
        driver_name: vehicle.driver_name,
        subscription_status: vehicle.subscription_status,
        next_billing_date: vehicle.next_billing_date,
        grace_period_expires: vehicle.grace_period_expires,
        last_seen: vehicle.last_seen,
        battery_level: vehicle.battery_level,
        fuel_level: vehicle.fuel_level,
        gsm_signal_dbm: vehicle.gsm_signal_dbm,
        sat_lock_count: vehicle.sat_lock_count,
        is_locked: vehicle.is_locked,
        cloud_locked: vehicle.cloud_locked,
        geofences,
        maintenance,
        history
      };
    });

    res.json({
      support_code: code,
      generated_for_user: {
        id: user.id,
        username: user.username,
        role: user.role,
        company_name: user.company_name,
        email: user.email,
        phone: user.phone,
        plan_id: user.plan_id,
        subscription_status: user.subscription_status
      },
      system_diagnostics: {
        server_time: Date.now(),
        vehicle_count: vehicles.length,
        vehicles: vehicleDiagnostics
      }
    });
  } catch (err) {
    console.error('Verify support code error:', err);
    res.status(500).json({ error: 'Failed to retrieve support diagnostics' });
  }
});

module.exports = router;
