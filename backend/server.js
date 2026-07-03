const express = require('express');
const http = require('http');
const path = require('path');

// --- Memory logs interceptor for remote super admin diagnostics ---
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
global.serverLogs = [];
console.log = (...args) => {
  global.serverLogs.push({ type: 'log', time: new Date().toISOString(), message: args.join(' ') });
  if (global.serverLogs.length > 200) global.serverLogs.shift();
  originalConsoleLog.apply(console, args);
};
console.error = (...args) => {
  global.serverLogs.push({ type: 'error', time: new Date().toISOString(), message: args.join(' ') });
  if (global.serverLogs.length > 200) global.serverLogs.shift();
  originalConsoleError.apply(console, args);
};
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { db, initDb } = require('./db');
const mqtt = require('mqtt');
const net = require('net');
const nodemailer = require('nodemailer');
require('dotenv').config();

// Initialize DB
initDb();

const app = express();
app.set('trust proxy', 1); // trust first proxy for accurate rate limiting behind Railway's reverse proxy
const server = http.createServer(app);

// --- SECURITY: CORS origin restriction ---
const ALLOWED_ORIGINS = process.env.NODE_ENV === 'production'
  ? (process.env.ALLOWED_ORIGINS || 'https://safebox.onrender.com,https://safeboxfleet.com,https://safebox-fleet-production.up.railway.app').split(',')
  : ['http://localhost:5173', 'http://localhost:3000'];

const io = socketIo(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"]
  }
});

// --- SECURITY: Socket.io JWT Authentication Middleware ---
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error('Authentication error: Token required'));
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    

    
    socket.user = decoded; // { id, username, role }
    next();
  } catch (err) {
    return next(new Error('Authentication error: Invalid token'));
  }
});

// --- SECURITY: JWT Secret ---
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Server cannot start safely.');
  process.exit(1);
}
const JWT_EXPIRES_IN = '7d';

// Middleware
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());

// --- SECURITY: Rate Limiting ---
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // max 15 login attempts per window
  message: { error: 'Too many attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // max 5 registrations per hour
  message: { error: 'Too many accounts created. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 10, // max 10 OTP attempts per 10 minutes per IP
  message: { error: 'Too many verification attempts. Please wait 10 minutes before trying again.' },
  standardHeaders: true,
  legacyHeaders: false
});

// --- SECURITY: JWT Authentication Middleware ---
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Check if user is suspended in the database
    const user = db.prepare('SELECT subscription_status, role FROM users WHERE id = ?').get(decoded.id);
    req.user = decoded; // { id, username, role }

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

// Serve static frontend files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'public')));
}

// --- SECURITY: Nodemailer / Resend Email Sender helper ---
async function sendVerificationEmail(email, username, code, type = 'registration') {
  const subject = type === 'password_change' 
    ? 'SafeBox Fleet Password Change Verification' 
    : type === 'password_reset'
    ? 'Reset Your SafeBox Fleet Password'
    : 'Verify Your SafeBox Fleet Account';

  const introText = type === 'password_change'
    ? 'A request was made to change your SafeBox Fleet password. Please use the verification code below to authorize this change:'
    : type === 'password_reset'
    ? 'We received a request to reset your SafeBox Fleet password. Please use the verification code below to complete the reset:'
    : 'Thank you for signing up with SafeBox Fleet. Please use the verification code below to activate your account:';

  const bodyText = type === 'password_change'
    ? `Hello ${username},\n\nYour SafeBox Fleet password change verification code is: ${code}\n\nThis code will expire in 10 minutes.\n\nThank you,\nSafeBox Fleet Team`
    : type === 'password_reset'
    ? `Hello ${username},\n\nYour SafeBox Fleet password reset verification code is: ${code}\n\nThis code will expire in 10 minutes.\n\nThank you,\nSafeBox Fleet Team`
    : `Hello ${username},\n\nYour SafeBox Fleet verification code is: ${code}\n\nThis code will expire in 15 minutes.\n\nThank you,\nSafeBox Fleet Team`;

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; background: #0f172a; color: white;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #3b82f6; margin-top: 10px;">SafeBox Fleet</h2>
      </div>
      <p>Hello <strong>${username}</strong>,</p>
      <p>${introText}</p>
      <div style="text-align: center; margin: 30px 0; padding: 15px; background: rgba(59, 130, 246, 0.1); border: 2px dashed #3b82f6; border-radius: 6px; font-size: 2rem; font-weight: bold; letter-spacing: 0.25em; color: #3b82f6;">
        ${code}
      </div>
      <p style="font-size: 0.875rem; color: #94a3b8;">This code will expire in ${type === 'password_change' ? '10' : '15'} minutes. If you did not request this, you can safely ignore this email.</p>
      <hr style="border: 0; border-top: 1px solid #334155; margin: 30px 0;" />
      <p style="font-size: 0.75rem; color: #64748b; text-align: center;">SafeBox Fleet — Secure Vehicle Tracking & Telematics Engine</p>
    </div>
  `;

  // 1. Try Resend API (Primary - HTTPS port 443, not blocked)
  if (process.env.RESEND_API_KEY) {
    try {
      console.log(`✉️ Attempting to send email via Resend to ${email}...`);
      const fromEmail = process.env.RESEND_FROM_EMAIL || 'SafeBox Fleet <onboarding@resend.dev>';
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 seconds timeout

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: fromEmail,
          to: email,
          subject: subject,
          html: htmlContent
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        console.log(`✉️ Real verification email (${type}) sent via Resend to: ${email}`);
        return { success: true };
      } else {
        const errText = await response.text();
        console.error(`❌ Resend API failed (${response.status}):`, errText);
      }
    } catch (err) {
      console.error('❌ Resend API exception:', err.message);
    }
  }

  // 2. Try SMTP Nodemailer (Secondary/Backup - will timeout/fail fast if blocked)
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (smtpHost && smtpUser && smtpPass) {
    try {
      console.log(`✉️ Attempting to send email via SMTP to ${email}...`);
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(smtpPort) || 587,
        secure: parseInt(smtpPort) === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass
        },
        connectionTimeout: 3000,
        greetingTimeout: 3000,
        socketTimeout: 3000
      });

      const mailOptions = {
        from: `"SafeBox Fleet Support" <${smtpUser}>`,
        to: email,
        subject: subject,
        text: bodyText,
        html: htmlContent
      };

      await transporter.sendMail(mailOptions);
      console.log(`✉️ Real verification email (${type}) sent via SMTP to: ${email}`);
      return { success: true };
    } catch (smtpErr) {
      console.error('❌ SMTP dispatch failed:', smtpErr.message);
    }
  }

  // 3. Fallback: Log to console
  console.log(`\n======================================================`);
  console.log(`✉️  [MOCK EMAIL] Password/Verification Code for ${username} (${email}) - Type: ${type}`);
  console.log(`👉  CODE: ${code}`);
  console.log(`⏳  Expires: in ${type === 'password_change' ? '10' : '15'} minutes`);
  console.log(`======================================================\n`);
  return { success: false, fallback: true };
}

async function sendMaintenanceEmail(email, username, vehicleName, reminder, odometer) {
  const limit = (reminder.last_service_km || 0) + (reminder.threshold_km || 0);
  const subject = `SafeBox Fleet: Maintenance Due for ${vehicleName}`;
  const text = `Hello ${username},\n\nThis is an automated alert that vehicle ${vehicleName} requires a scheduled ${reminder.type}.\n\nCurrent Odometer: ${Math.round(odometer)} km\nService Threshold: ${Math.round(limit)} km\nNotes: ${reminder.notes || 'None'}\n\nPlease schedule a service soon.\n\nBest regards,\nSafeBox Fleet Team`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; background: #0f172a; color: white;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #ef4444; margin-top: 10px;">🛠️ Maintenance Alert</h2>
      </div>
      <p>Hello <strong>${username}</strong>,</p>
      <p>Vehicle <strong>${vehicleName}</strong> requires a scheduled <strong>${reminder.type}</strong>.</p>
      
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0; color: white;">
        <tr style="border-bottom: 1px solid #334155;">
          <td style="padding: 8px 0; color: #94a3b8;">Current Odometer</td>
          <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #f8fafc;">${Math.round(odometer)} km</td>
        </tr>
        <tr style="border-bottom: 1px solid #334155;">
          <td style="padding: 8px 0; color: #94a3b8;">Service Limit</td>
          <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #ef4444;">${Math.round(limit)} km</td>
        </tr>
        ${reminder.notes ? `
        <tr style="border-bottom: 1px solid #334155;">
          <td style="padding: 8px 0; color: #94a3b8;">Notes</td>
          <td style="padding: 8px 0; text-align: right; color: #cbd5e1;">${reminder.notes}</td>
        </tr>
        ` : ''}
      </table>
      
      <p style="font-size: 0.875rem; color: #94a3b8;">Please perform the service and update the reminder status to COMPLETED in the Safebox console to reset this alert.</p>
      <hr style="border: 0; border-top: 1px solid #334155; margin: 30px 0;" />
      <p style="font-size: 0.75rem; color: #64748b; text-align: center;">SafeBox Fleet — Secure Vehicle Tracking & Telematics Engine</p>
    </div>
  `;

  // 1. Try Resend HTTP API (Primary/Preferred - runs on HTTPS port 443)
  if (process.env.RESEND_API_KEY) {
    try {
      console.log(`✉️ Attempting to send maintenance email via Resend to ${email}...`);
      const fromEmail = process.env.RESEND_FROM_EMAIL || 'SafeBox Fleet Alert <onboarding@resend.dev>';
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 seconds timeout

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: fromEmail,
          to: email,
          subject: subject,
          html: html
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        console.log(`✉️ Real maintenance email sent via Resend to: ${email}`);
        return;
      } else {
        const errText = await response.text();
        console.error(`❌ Resend API failed for maintenance email (${response.status}):`, errText);
      }
    } catch (err) {
      console.error('❌ Resend API exception for maintenance email:', err.message);
    }
  }

  // 2. Try SMTP Nodemailer (Secondary/Backup - will timeout/fail fast if blocked)
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (smtpHost && smtpUser && smtpPass) {
    try {
      console.log(`✉️ Attempting to send maintenance email via SMTP to ${email}...`);
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(smtpPort) || 587,
        secure: parseInt(smtpPort) === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass
        },
        connectionTimeout: 3000,
        greetingTimeout: 3000,
        socketTimeout: 3000
      });

      await transporter.sendMail({
        from: `"SafeBox Fleet Alert" <${smtpUser}>`,
        to: email,
        subject,
        text,
        html
      });
      console.log(`✉️ Real maintenance email sent via SMTP to: ${email}`);
      return;
    } catch (smtpErr) {
      console.error('❌ Maintenance SMTP failed, falling back to console log:', smtpErr.message);
    }
  }

  // 3. Fallback: Log to console
  console.log(`\n======================================================`);
  console.log(`✉️  [MOCK EMAIL] Maintenance Alert for ${username} (${email})`);
  console.log(`👉  VEHICLE: ${vehicleName}`);
  console.log(`👉  REMINDER: ${reminder.type}`);
  console.log(`👉  ODOMETER: ${Math.round(odometer)} km / LIMIT: ${Math.round(limit)} km`);
  console.log(`======================================================\n`);
}

// Auth Routes
app.post('/api/register', registerLimiter, async (req, res) => {
  const { username, password, role, companyName, email, phone } = req.body;

  // Input validation
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

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email address format.' });
  }

  try {
    // Check uniqueness manually for username, email and phone numbers
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
    
    // Generate OTP
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationExpires = Date.now() + 15 * 60 * 1000; // 15 mins

    const stmt = db.prepare('INSERT INTO users (username, password, role, company_name, email, phone, is_verified, verification_code, verification_expires) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)');
    stmt.run(username, hashedPassword, role, role === 'company' ? companyName : null, email, phone, verificationCode, verificationExpires);

    // Send verification email
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

app.post('/api/login', authLimiter, async (req, res) => {
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



    // Check verification status
    if (user.is_verified === 0) {
      // Generate new OTP on block if expired, otherwise keep existing
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

    // Issue JWT token
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({ id: user.id, username: user.username, role: user.role, token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Verify Email Code
app.post('/api/verify-email', otpLimiter, async (req, res) => {
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

    // Mark as verified
    db.prepare('UPDATE users SET is_verified = 1, verification_code = NULL, verification_expires = NULL WHERE id = ?').run(user.id);

    // Issue JWT token
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.json({ id: user.id, username: user.username, role: user.role, token });
  } catch (err) {
    console.error('Email verification failed:', err);
    res.status(500).json({ error: 'Verification failed.' });
  }
});

// Resend Verification Code
app.post('/api/resend-verification', otpLimiter, async (req, res) => {
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

    // Generate new code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationExpires = Date.now() + 15 * 60 * 1000;

    db.prepare('UPDATE users SET verification_code = ?, verification_expires = ? WHERE id = ?').run(verificationCode, verificationExpires, user.id);

    // Resend email
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

// Request Password Reset OTP (Forgot Password)
app.post('/api/forgot-password', otpLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(404).json({ error: 'No account found with this email address.' });
    }

    // Generate new code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationExpires = Date.now() + 10 * 60 * 1000; // 10 mins

    db.prepare('UPDATE users SET verification_code = ?, verification_expires = ? WHERE id = ?')
      .run(verificationCode, verificationExpires, user.id);

    // Send email
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

// Reset Password with OTP
app.post('/api/reset-password', otpLimiter, async (req, res) => {
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

    // Hash and update password
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    db.prepare('UPDATE users SET password = ?, verification_code = NULL, verification_expires = NULL WHERE id = ?')
      .run(hashedPassword, user.id);

    res.json({ success: true, message: 'Password has been reset successfully. You can now log in.' });
  } catch (err) {
    console.error('Password reset failed:', err);
    res.status(500).json({ error: 'Failed to reset password.' });
  }
});

// --- Apply auth middleware to all protected routes ---
app.use('/api/vehicles', authMiddleware);
app.use('/api/geofences', authMiddleware);
app.use('/api/profile', authMiddleware);
app.use('/api/analytics', authMiddleware);
app.use('/api/payments/status', authMiddleware);
app.use('/api/payments/initialize-bulk', authMiddleware);
app.use('/api/payments/simulate-webhook', authMiddleware);
app.use('/api/payments/verify', authMiddleware);

// Request Password Change OTP
app.post('/api/profile/request-password-change-otp', authMiddleware, async (req, res) => {
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

    // Generate 6-digit OTP
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationExpires = Date.now() + 10 * 60 * 1000; // 10 mins

    db.prepare('UPDATE users SET verification_code = ?, verification_expires = ? WHERE id = ?')
      .run(verificationCode, verificationExpires, userId);

    // Send verification email
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

// Profile Update with MQTT device sync
app.post('/api/profile/update', authMiddleware, async (req, res) => {
  const userId = req.user.id; // SECURE: Use token user ID, not request body
  const { email, phone, companyName, currency, password, oldPassword, otpCode } = req.body;

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

      // Verify current password
      const passwordMatch = await bcrypt.compare(oldPassword, user.password);
      if (!passwordMatch) {
        return res.status(400).json({ error: 'Current password is incorrect.' });
      }

      // Verify verification code
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

    // Sync new phone to all vehicles owned by this user via MQTT
    const vehicles = db.prepare('SELECT id FROM vehicles WHERE owner_id = ?').all(userId);
    vehicles.forEach(v => {
      const topic = `/device/${v.id}/command`;
      mqttClient.publish(topic, `CONFIG_PHONE:${phone}`);
      // NOTE: Do not push a hardcoded passcode. Device passcode management is handled via the Settings panel per-vehicle.
    });

    res.json({ success: true, message: 'Profile updated successfully' });
  } catch (err) {
    console.error('Profile update failed:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// MQTT Broker Setup — Private HiveMQ Cloud (TLS + Credentials)
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://broker.emqx.io'; // fallback for local dev only
const mqttOptions = process.env.MQTT_BROKER_USER ? {
  username: process.env.MQTT_BROKER_USER,
  password: process.env.MQTT_BROKER_PASS,
  rejectUnauthorized: true // enforce TLS certificate validation
} : {};

console.log(`🔌 Connecting to MQTT Broker: ${MQTT_BROKER_URL}`);
const mqttClient = mqtt.connect(MQTT_BROKER_URL, mqttOptions);

mqttClient.on('connect', () => {
  console.log('✅ Connected to Public MQTT Broker');
  mqttClient.subscribe('/device/+/status'); // Subscribe to all device statuses
  mqttClient.subscribe('/device/+/alert');  // Subscribe to all device alerts
});

mqttClient.on('error', (err) => {
  console.error('❌ MQTT Connection Error:', err.message);
});

mqttClient.on('reconnect', () => {
  console.log('🔄 MQTT Reconnecting...');
});

mqttClient.on('offline', () => {
  console.warn('⚠️ MQTT Broker Offline — telemetry paused');
});

// MQTT Publish Event (Handle Telemetry & Alerts)
mqttClient.on('message', (topic, message) => {
  const payloadStr = message.toString();
  console.log(`Received MQTT: ${topic}`);

  // 1. Handle Telemetry
  if (topic.startsWith('/device/') && topic.endsWith('/status')) {
    try {
      const payload = JSON.parse(payloadStr);

      // Verify the vehicle exists and find its owner
      const vehicle = db.prepare(`
        SELECT v.owner_id, v.name, v.lat, v.lng, v.odometer_km, v.curfew_enabled, v.curfew_start, v.curfew_end, v.curfew_days, v.curfew_allow_override, v.curfew_holiday_mode, v.override_status, v.override_expires, v.cloud_locked, v.ble_beacon_id, v.ble_beacon_rssi_threshold, v.subscription_status, u.subscription_status AS user_subscription_status
        FROM vehicles v
        LEFT JOIN users u ON v.owner_id = u.id
        WHERE v.id = ?
      `).get(payload.deviceId);
      if (!vehicle) {
        console.warn(`⚠️ Received telemetry for unregistered device: ${payload.deviceId}`);
        return;
      }
      const ownerId = vehicle.owner_id;

      if (vehicle.subscription_status === 'SUSPENDED' || vehicle.user_subscription_status === 'SUSPENDED') {
        console.log(`[Subscription Policy] Suspended vehicle or owner for ${payload.deviceId} telemetry ignored.`);
        return;
      }

      // Curfew lock state calculation
      let curfewLocked = false;
      if (vehicle.curfew_enabled === 1) {
        const now = new Date();
        const isAllowed = isWithinAllowedHours(now, vehicle.curfew_start, vehicle.curfew_end, vehicle.curfew_days, vehicle.curfew_holiday_mode);
        if (!isAllowed) {
          let hasOverride = false;
          if (vehicle.override_status === 'APPROVED_MIDNIGHT' || vehicle.override_status === 'APPROVED_ONCE') {
            if (Date.now() < vehicle.override_expires) {
              hasOverride = true;
            }
          }
          if (!hasOverride) {
            curfewLocked = true;
          }
        }
      }

      // BLE Proximity check (driver presence)
      const bleBeacons = [];
      if (payload.rawBleList) {
        payload.rawBleList.split(';').forEach(pair => {
          const [mac, rssi] = pair.split(':');
          if (mac && rssi) {
            bleBeacons.push({ mac: mac.trim(), rssi: parseInt(rssi.trim()) });
          }
        });
      }

      let driverPresent = false;
      if (vehicle.ble_beacon_id) {
        const normalizedBeaconId = vehicle.ble_beacon_id.replace(/:/g, '').toUpperCase();
        const matchedTag = bleBeacons.find(b => b.mac.replace(/:/g, '').toUpperCase() === normalizedBeaconId);
        if (matchedTag && matchedTag.rssi >= vehicle.ble_beacon_rssi_threshold) {
          driverPresent = true;
        }
      } else {
        driverPresent = true;
      }

      const shouldBeLocked = (vehicle.cloud_locked === 1 || curfewLocked || !driverPresent);

      // Enforce the calculated security policy state
      if (shouldBeLocked) {
        // Enforce lock (if stationary and currently unlocked)
        if (payload.speed === 0 && !payload.locked) {
          console.log(`[Security Policy] Enforcing LOCK for vehicle ${payload.deviceId}. Reason: cloud_locked=${vehicle.cloud_locked}, curfew=${curfewLocked}, driverAbsent=${!driverPresent}`);
          mqttClient.publish(`/device/${payload.deviceId}/command`, JSON.stringify({ command: 'BLOCK_START' }));
          mqttClient.publish(`/device/${payload.deviceId}/command`, JSON.stringify({ command: 'LOCK' }));
          payload.locked = true;
        }
        
        // Warn if running outside allowed hours
        if (curfewLocked && payload.speed > 0) {
          if (!global.curfewRunningAlerts) global.curfewRunningAlerts = new Map();
          const lastAlertTime = global.curfewRunningAlerts.get(payload.deviceId);
          if (!lastAlertTime || (Date.now() - lastAlertTime > 300000)) { // 5 min cooldown
            const alertMsg = `Warning: Vehicle ${payload.deviceId} is running outside authorized hours!`;
            io.to(`user_${ownerId}`).emit('notification', {
              id: Date.now() + 10,
              type: 'CURFEW_VIOLATION',
              severity: 'warning',
              message: alertMsg,
              timestamp: Date.now(),
              is_read: false
            });
            global.curfewRunningAlerts.set(payload.deviceId, Date.now());
          }
        }

        // Curfew override tracking
        if (curfewLocked && vehicle.override_status === 'APPROVED_ONCE' && payload.speed > 0) {
          console.log(`[Curfew Override] Vehicle ${payload.deviceId} has started. Expiring APPROVED_ONCE override.`);
          db.prepare("UPDATE vehicles SET override_status = 'NONE', override_expires = 0 WHERE id = ?").run(payload.deviceId);
        }
      } else {
        // Clear curfew override if back inside allowed hours
        if (vehicle.override_status !== 'NONE' && !curfewLocked) {
          db.prepare("UPDATE vehicles SET override_status = 'NONE', override_expires = 0 WHERE id = ?").run(payload.deviceId);
        }
        
        // Auto-unlock: If the device is currently locked but security policy says it should be unlocked
        if (payload.locked) {
          console.log(`[Security Policy] Auto-unlocking vehicle ${payload.deviceId} (Inside hours, driver present, no cloud lock).`);
          mqttClient.publish(`/device/${payload.deviceId}/command`, JSON.stringify({ command: 'ALLOW_START' }));
          mqttClient.publish(`/device/${payload.deviceId}/command`, JSON.stringify({ command: 'UNLOCK' }));
          payload.locked = false;
        }
      }

      // Calculate distance delta and update odometer
      let newOdometer = vehicle.odometer_km || 0;
      if (vehicle.lat !== null && vehicle.lng !== null && vehicle.lat !== 0 && vehicle.lng !== 0 &&
          payload.lat !== null && payload.lng !== null && payload.lat !== 0 && payload.lng !== 0) {
        const delta = getDistanceFromLatLonInKm(vehicle.lat, vehicle.lng, payload.lat, payload.lng);
        // Filter out GPS jumps (e.g. > 2km in 3 seconds)
        if (delta > 0 && delta <= 2) {
          newOdometer += delta;
        }
      }

      // Update last_seen, battery_level, fuel_level, and is_locked in DB.
      // IMPORTANT: We do NOT update cloud_locked here — it is a web-only command
      // and must only change when the user presses LOCK/UNLOCK on the dashboard.
      // If we let the device overwrite it, the dashboard lock button would revert
      // every time the device sends a telemetry packet (every 2 seconds).
      try {
        const stmt = db.prepare('UPDATE vehicles SET last_seen = ?, battery_level = ?, fuel_level = ?, is_locked = ?, lat = ?, lng = ?, odometer_km = ? WHERE id = ?');
        stmt.run(Date.now(), payload.battery || 100, payload.fuel || 100, payload.locked ? 1 : 0, payload.lat || 0, payload.lng || 0, newOdometer, payload.deviceId);

        // Insert into vehicle_history
        const historyStmt = db.prepare(`
              INSERT INTO vehicle_history (vehicle_id, timestamp, speed, battery_level, fuel_level, lat, lng)
              VALUES (?, ?, ?, ?, ?, ?, ?)
          `);
        historyStmt.run(
          payload.deviceId,
          Date.now(),
          payload.speed || 0,
          payload.battery || 100,
          payload.fuel || 100,
          payload.lat || 0,
          payload.lng || 0
        );

        // --- Maintenance Alerts Notification Check ---
        try {
          const reminders = db.prepare(`
            SELECT * FROM maintenance_reminders
            WHERE vehicle_id = ? AND status = 'PENDING' AND alerted = 0
          `).all(payload.deviceId);

          for (const reminder of reminders) {
            let isDue = false;
            let limitStr = '';

            // Check distance threshold
            if (reminder.threshold_km !== null) {
              const limit = (reminder.last_service_km || 0) + reminder.threshold_km;
              if (newOdometer >= limit) {
                isDue = true;
                limitStr = `Limit: ${Math.round(limit)} km`;
              }
            }

            // Check date threshold (due_date)
            if (reminder.due_date !== null && Date.now() >= reminder.due_date) {
              isDue = true;
              const dateStr = new Date(reminder.due_date).toLocaleDateString();
              limitStr = limitStr ? `${limitStr}, Date: ${dateStr}` : `Date: ${dateStr}`;
            }

            if (isDue) {
              const limit = (reminder.last_service_km || 0) + (reminder.threshold_km || 0);

              // 1. Mark as alerted in database
              db.prepare('UPDATE maintenance_reminders SET alerted = 1 WHERE id = ?').run(reminder.id);

              // 2. Format alert message
              const alertMsg = `Maintenance Alert: ${reminder.type} is due on ${vehicle.name || payload.deviceId}! Current Odometer: ${Math.round(newOdometer)} km (${limitStr}).`;

              // 3. Persist alert
              db.prepare('INSERT INTO vehicle_alerts (vehicle_id, type, message, timestamp) VALUES (?, ?, ?, ?)').run(
                payload.deviceId, 'MAINTENANCE_DUE', alertMsg, Date.now()
              );

              // 4. Emit WebSocket notifications
              io.to(`user_${ownerId}`).emit('notification', {
                id: Date.now() + Math.floor(Math.random() * 1000),
                type: 'MAINTENANCE',
                message: alertMsg,
                timestamp: Date.now(),
                is_read: false
              });

              io.to(`user_${ownerId}`).emit('geofence-alert', {
                vehicleId: payload.deviceId,
                message: alertMsg,
                timestamp: Date.now()
              });

              // 5. Dispatch email notification to owner
              const owner = db.prepare('SELECT username, email FROM users WHERE id = ?').get(ownerId);
              if (owner && owner.email) {
                sendMaintenanceEmail(owner.email, owner.username, vehicle.name || payload.deviceId, reminder, newOdometer);
              }
            }
          }
        } catch (maintErr) {
          console.error("Maintenance check failed:", maintErr);
        }

        // --- Live Alerts Broker (Speeding, Low Battery, Low Fuel) ---
        if (!global.alertCooldowns) global.alertCooldowns = new Map();
        const now = Date.now();

        // 1. Speeding Check (>100 km/h)
        if (payload.speed > 100) {
          const speedKey = `${payload.deviceId}-speeding`;
          const lastSpeedAlert = global.alertCooldowns.get(speedKey);
          if (!lastSpeedAlert || (now - lastSpeedAlert > 300000)) { // 5 min cooldown
            const alertMsg = `Vehicle ${payload.deviceId} is speeding at ${payload.speed} km/h!`;
            
            io.to(`user_${ownerId}`).emit('notification', {
              id: now + 1,
              type: 'SPEED',
              message: alertMsg,
              timestamp: now,
              is_read: false
            });

            io.to(`user_${ownerId}`).emit('geofence-alert', {
              vehicleId: payload.deviceId,
              message: alertMsg,
              timestamp: now
            });

            global.alertCooldowns.set(speedKey, now);

            // Persist to vehicle_alerts
            try {
              db.prepare('INSERT INTO vehicle_alerts (vehicle_id, type, message, timestamp) VALUES (?, ?, ?, ?)').run(
                payload.deviceId, 'SPEEDING', alertMsg, now
              );
            } catch (e) { /* ignore */ }
          }
        }

        // 2. Low Battery Check (<20%)
        if (payload.battery && payload.battery < 20) {
          const battKey = `${payload.deviceId}-low-battery`;
          const lastBattAlert = global.alertCooldowns.get(battKey);
          if (!lastBattAlert || (now - lastBattAlert > 600000)) { // 10 min cooldown
            const alertMsg = `Warning: Vehicle ${payload.deviceId} battery is critical at ${payload.battery}%!`;
            
            io.to(`user_${ownerId}`).emit('notification', {
              id: now + 2,
              type: 'BATTERY',
              message: alertMsg,
              timestamp: now,
              is_read: false
            });

            io.to(`user_${ownerId}`).emit('geofence-alert', {
              vehicleId: payload.deviceId,
              message: alertMsg,
              timestamp: now
            });

            global.alertCooldowns.set(battKey, now);

            // Persist to vehicle_alerts
            try {
              db.prepare('INSERT INTO vehicle_alerts (vehicle_id, type, message, timestamp) VALUES (?, ?, ?, ?)').run(
                payload.deviceId, 'LOW_BATTERY', alertMsg, now
              );
            } catch (e) { /* ignore */ }
          }
        }

        // 3. Low Fuel Check (<15%)
        if (payload.fuel && payload.fuel < 15) {
          const fuelKey = `${payload.deviceId}-low-fuel`;
          const lastFuelAlert = global.alertCooldowns.get(fuelKey);
          if (!lastFuelAlert || (now - lastFuelAlert > 600000)) { // 10 min cooldown
            const alertMsg = `Warning: Vehicle ${payload.deviceId} fuel is low at ${payload.fuel}%!`;
            
            io.to(`user_${ownerId}`).emit('notification', {
              id: now + 3,
              type: 'FUEL',
              message: alertMsg,
              timestamp: now,
              is_read: false
            });

            io.to(`user_${ownerId}`).emit('geofence-alert', {
              vehicleId: payload.deviceId,
              message: alertMsg,
              timestamp: now
            });

            global.alertCooldowns.set(fuelKey, now);

            // Persist to vehicle_alerts
            try {
              db.prepare('INSERT INTO vehicle_alerts (vehicle_id, type, message, timestamp) VALUES (?, ?, ?, ?)').run(
                payload.deviceId, 'LOW_FUEL', alertMsg, now
              );
            } catch (e) { /* ignore */ }
          }
        }

        // 4. Dynamic Fuel Theft Detection (>10% drop in <60s while stopped)
        if (!global.fuelTracker) global.fuelTracker = new Map();
        const fuelRecord = global.fuelTracker.get(payload.deviceId);
        if (fuelRecord && payload.speed === 0 && fuelRecord.speed === 0) {
          const fuelDrop = fuelRecord.fuel - (payload.fuel || 100);
          const timeDiff = now - fuelRecord.timestamp;
          if (fuelDrop > 10 && timeDiff < 60000) {
            const theftKey = `${payload.deviceId}-fuel-theft-server`;
            const lastTheftAlert = global.alertCooldowns.get(theftKey);
            if (!lastTheftAlert || (now - lastTheftAlert > 120000)) { // 2 min cooldown
              const theftMsg = `Critical: Possible fuel theft on ${payload.deviceId}! Fuel dropped ${Math.round(fuelDrop)}% in ${Math.round(timeDiff / 1000)}s while stopped.`;
              io.to(`user_${ownerId}`).emit('notification', {
                id: now + 4,
                type: 'FUEL_THEFT',
                message: theftMsg,
                timestamp: now,
                is_read: false
              });
              io.to(`user_${ownerId}`).emit('geofence-alert', {
                vehicleId: payload.deviceId,
                message: theftMsg,
                timestamp: now
              });
              global.alertCooldowns.set(theftKey, now);
              try {
                db.prepare('INSERT INTO vehicle_alerts (vehicle_id, type, message, timestamp) VALUES (?, ?, ?, ?)').run(
                  payload.deviceId, 'FUEL_THEFT', theftMsg, now
                );
              } catch (e) { /* ignore */ }
            }
          }
        }
        global.fuelTracker.set(payload.deviceId, { fuel: payload.fuel || 100, speed: payload.speed || 0, timestamp: now });

        // Check Geofences (supports both circle and polygon types)
        if (payload.lat && payload.lng) {
          const geofences = db.prepare('SELECT * FROM geofences WHERE vehicle_id = ?').all(payload.deviceId);

          if (!global.alertCooldowns) global.alertCooldowns = new Map();

          geofences.forEach(geo => {
            const alertKey = `${payload.deviceId}-${geo.id}`;
            let isOutside = false;

            if (geo.type === 'polygon' && geo.coordinates) {
              // Polygon geofence: use ray-casting
              try {
                const polygon = JSON.parse(geo.coordinates);
                isOutside = !isPointInPolygon({ lat: payload.lat, lng: payload.lng }, polygon);
              } catch (e) {
                console.error(`Invalid polygon coordinates for geofence ${geo.id}:`, e.message);
              }
            } else {
              // Circle geofence: use haversine distance
              const distance = getDistanceFromLatLonInKm(geo.lat, geo.lng, payload.lat, payload.lng) * 1000; // meters
              isOutside = distance > geo.radius;
            }

            if (isOutside) {
              // OUTSIDE
              const lastAlert = global.alertCooldowns.get(alertKey);
              const geoNow = Date.now();

              // Alert only if never alerted or > 60 seconds ago
              if (!lastAlert || (geoNow - lastAlert > 60000)) {
                const breachMsg = `Vehicle ${payload.deviceId} has left the safe zone!`;
                io.to(`user_${ownerId}`).emit('geofence-alert', {
                  vehicleId: payload.deviceId,
                  message: breachMsg,
                  timestamp: geoNow
                });

                // Emit Notification for Bell Icon
                io.to(`user_${ownerId}`).emit('notification', {
                  id: geoNow,
                  type: 'GEOFENCE',
                  message: `Vehicle ${payload.deviceId} left safe zone`,
                  timestamp: geoNow,
                  is_read: false
                });
                console.log(`Geofence Breach: ${payload.deviceId}`);
                global.alertCooldowns.set(alertKey, geoNow);

                // Persist to vehicle_alerts
                try {
                  db.prepare('INSERT INTO vehicle_alerts (vehicle_id, type, message, timestamp) VALUES (?, ?, ?, ?)').run(
                    payload.deviceId, 'GEOFENCE_BREACH', breachMsg, geoNow
                  );
                } catch (e) { /* ignore */ }
              }
            } else {
              // INSIDE - Reset cooldown so we alert immediately if they leave again
              if (global.alertCooldowns.has(alertKey)) {
                global.alertCooldowns.delete(alertKey);
                console.log(`Vehicle ${payload.deviceId} re-entered safe zone ${geo.id}`);
              }
            }
          });
        }

      } catch (dbErr) {
        console.error("DB Update/History Insert failed", dbErr);
      }

      io.to(`user_${ownerId}`).emit('device-data', { topic: topic, payload });

      // Broadcast to any active shared tracking viewers
      broadcastToSharedTrackers(payload.deviceId, payload.lat, payload.lng, payload.speed, payload.timestamp || Date.now());
    } catch (e) {
      console.error("Failed to parse MQTT payload", e);
    }
  }

  // 2. Handle Device Alerts from MQTT
  if (topic.startsWith('/device/') && topic.endsWith('/alert')) {
    try {
      const parts = topic.split('/');
      const deviceId = parts[2];
      const payload = JSON.parse(payloadStr);

      // Verify the vehicle exists and find its owner
      const vehicle = db.prepare(`
        SELECT v.owner_id, v.name, v.subscription_status, u.subscription_status AS user_subscription_status
        FROM vehicles v
        LEFT JOIN users u ON v.owner_id = u.id
        WHERE v.id = ?
      `).get(deviceId);
      if (!vehicle) {
        console.warn(`⚠️ Received alert for unregistered device: ${deviceId}`);
        return;
      }
      if (vehicle.subscription_status === 'SUSPENDED' || vehicle.user_subscription_status === 'SUSPENDED') {
        console.log(`[Subscription Policy] Suspended vehicle or owner for ${deviceId} alert ignored.`);
        return;
      }
      const ownerId = vehicle.owner_id;

      let notifType = payload.type || 'ALERT';

      // Cooldown Check: Ignore identical alert types from the same device within 5 minutes (300,000 ms)
      if (!global.alertCooldowns) global.alertCooldowns = new Map();
      const cooldownKey = `${deviceId}-${notifType}`;
      const lastAlertTime = global.alertCooldowns.get(cooldownKey);
      const nowMs = Date.now();
      if (lastAlertTime && (nowMs - lastAlertTime < 300000)) {
        console.log(`[Alert Broker] Cooldown active for ${notifType} on ${deviceId}. Skipping notification.`);
        return;
      }
      global.alertCooldowns.set(cooldownKey, nowMs);

      let alertMsg = payload.message || `Alert from device ${deviceId}: ${notifType}`;
      if (notifType === 'FUEL_THEFT') {
        alertMsg = `Warning: Fuel theft detected on vehicle ${deviceId}!`;
      } else if (notifType === 'DEVICE_TAMPERING') {
        alertMsg = `Critical: Device tampering detected on vehicle ${deviceId}!`;
      } else if (notifType === 'UNAUTHORIZED_START') {
        alertMsg = `Critical: Unauthorized start detected on vehicle ${deviceId}!`;
      } else if (notifType === 'START_ATTEMPT_BLOCKED') {
        // Double check: Is curfew actually active right now?
        const vCurfew = db.prepare('SELECT curfew_enabled, curfew_start, curfew_end, curfew_days, curfew_holiday_mode FROM vehicles WHERE id = ?').get(deviceId);
        
        let curfewActive = false;
        if (vCurfew && vCurfew.curfew_enabled === 1) {
          const now = new Date();
          const isAllowed = isWithinAllowedHours(now, vCurfew.curfew_start, vCurfew.curfew_end, vCurfew.curfew_days, vCurfew.curfew_holiday_mode);
          if (!isAllowed) {
            curfewActive = true;
          }
        }
        
        if (!curfewActive) {
          // Curfew is NOT active! Auto-correct by sending ALLOW_START and UNLOCK
          console.log(`[Curfew Policy] Received START_ATTEMPT_BLOCKED for ${deviceId} during allowed operating hours. Auto-unblocking.`);
          mqttClient.publish(`/device/${deviceId}/command`, JSON.stringify({ command: 'ALLOW_START' }));
          mqttClient.publish(`/device/${deviceId}/command`, JSON.stringify({ command: 'UNLOCK' }));
          return;
        }

        alertMsg = `Security: Engine start blocked outside authorized hours for vehicle ${deviceId}!`;
        
        // Log pending override request in override_requests table!
        // Get vehicle's driver_name
        const vInfo = db.prepare('SELECT driver_name, curfew_allow_override FROM vehicles WHERE id = ?').get(deviceId);
        const driverName = vInfo ? (vInfo.driver_name || 'Driver') : 'Driver';
        const allowOverride = vInfo ? vInfo.curfew_allow_override : 1;

        if (allowOverride === 1) {
          // Check if there is already a PENDING request for this vehicle to avoid duplicates
          const existing = db.prepare("SELECT id FROM override_requests WHERE vehicle_id = ? AND status = 'PENDING'").get(deviceId);
          if (!existing) {
            const stmt = db.prepare(`
              INSERT INTO override_requests (vehicle_id, driver_name, requested_at, status)
              VALUES (?, ?, ?, 'PENDING')
            `);
            const res = stmt.run(deviceId, driverName, Date.now());
            
            // Broadcast the override-request event to the manager
            io.to(`user_${ownerId}`).emit('override-request', {
              id: res.lastInsertRowid,
              vehicle_id: deviceId,
              vehicle_name: vehicle.name || deviceId,
              driver_name: driverName,
              requested_at: Date.now(),
              status: 'PENDING'
            });
          }
        }
      }

      const now = Date.now();

      // Emit Notification for Bell Icon
      io.to(`user_${ownerId}`).emit('notification', {
        id: now,
        type: notifType,
        message: alertMsg,
        timestamp: now,
        is_read: false
      });

      // Emit specific alert socket event
      io.to(`user_${ownerId}`).emit('device-alert', {
        vehicleId: deviceId,
        type: notifType,
        message: alertMsg,
        timestamp: now
      });

      // Persist alert to vehicle_alerts table for safety scoring
      try {
        db.prepare('INSERT INTO vehicle_alerts (vehicle_id, type, message, timestamp) VALUES (?, ?, ?, ?)').run(
          deviceId, notifType, alertMsg, now
        );
      } catch (dbErr) {
        console.error('Failed to persist alert to vehicle_alerts:', dbErr.message);
      }

      console.log(`Alert processed for ${deviceId}: ${notifType}`);
    } catch (e) {
      console.error("Failed to parse MQTT alert payload", e);
    }
  }
});

// --- Multi-Protocol TCP Helper Functions ---

function reflect(val, bits) {
  let res = 0;
  for (let i = 0; i < bits; i++) {
    if ((val & (1 << i)) !== 0) {
      res |= (1 << (bits - 1 - i));
    }
  }
  return res;
}

function calculateGT06CRC(data) {
  let crc = 0xFFFF;
  const polynomial = 0x1021;

  for (let i = 0; i < data.length; i++) {
    let byte = data[i];
    byte = reflect(byte, 8);
    
    crc ^= (byte << 8);
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ polynomial) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return reflect(crc, 16) ^ 0xFFFF;
}

function handleIncomingTelemetry(deviceId, lat, lng, speed, battery, fuel, ignition, rawBleList = '') {
  const nowMs = Date.now();
  const vehicle = db.prepare(`
    SELECT v.owner_id, v.name, v.lat, v.lng, v.odometer_km, v.curfew_enabled, v.curfew_start, v.curfew_end, v.curfew_days, v.curfew_allow_override, v.curfew_holiday_mode, v.override_status, v.override_expires, v.cloud_locked, v.ble_beacon_id, v.ble_beacon_rssi_threshold, v.subscription_status, u.subscription_status AS user_subscription_status
    FROM vehicles v
    LEFT JOIN users u ON v.owner_id = u.id
    WHERE v.id = ?
  `).get(deviceId);

  if (!vehicle) return null;
  const ownerId = vehicle.owner_id;

  if (vehicle.subscription_status === 'SUSPENDED' || vehicle.user_subscription_status === 'SUSPENDED') {
    console.log(`[Subscription Policy] Suspended vehicle or owner for ${deviceId} TCP telemetry ignored.`);
    return null;
  }

  // Parse BLE Beacons if provided
  const bleBeacons = [];
  if (rawBleList) {
    rawBleList.split(';').forEach(pair => {
      const [mac, rssi] = pair.split(':');
      if (mac && rssi) {
        bleBeacons.push({ mac: mac.trim(), rssi: parseInt(rssi.trim()) });
      }
    });
  }

  // Proximity check (driver presence)
  let driverPresent = false;
  if (vehicle.ble_beacon_id) {
    const normalizedBeaconId = vehicle.ble_beacon_id.replace(/:/g, '').toUpperCase();
    const matchedTag = bleBeacons.find(b => b.mac.replace(/:/g, '').toUpperCase() === normalizedBeaconId);
    if (matchedTag && matchedTag.rssi >= vehicle.ble_beacon_rssi_threshold) {
      driverPresent = true;
    }
  } else {
    driverPresent = true;
  }

  // Curfew validation
  let curfewLocked = false;
  if (vehicle.curfew_enabled === 1) {
    const now = new Date();
    const isAllowed = isWithinAllowedHours(now, vehicle.curfew_start, vehicle.curfew_end, vehicle.curfew_days, vehicle.curfew_holiday_mode);
    if (!isAllowed) {
      let hasOverride = false;
      if (vehicle.override_status === 'APPROVED_MIDNIGHT' || vehicle.override_status === 'APPROVED_ONCE') {
        if (Date.now() < vehicle.override_expires) {
          hasOverride = true;
        }
      }
      if (!hasOverride) {
        curfewLocked = true;
      }
    }
  }

  const shouldBeLocked = (vehicle.cloud_locked === 1 || curfewLocked || !driverPresent);
  const isLocked = shouldBeLocked ? 1 : 0;

  // Hotwiring Detection Alert
  if (ignition === 1 && vehicle.cloud_locked === 1) {
    if (!global.alertCooldowns) global.alertCooldowns = new Map();
    const hotwireKey = `${deviceId}-hotwire`;
    const lastHotwire = global.alertCooldowns.get(hotwireKey);
    if (!lastHotwire || (nowMs - lastHotwire > 300000)) {
      const alertMsg = `Critical Security: Hotwiring / Ignition Bypass detected on vehicle ${vehicle.name || deviceId}! ACC turned ON while vehicle is cloud locked.`;
      console.warn(`[SECURITY ALERT] ${alertMsg}`);
      
      try {
        db.prepare('INSERT INTO vehicle_alerts (vehicle_id, type, message, timestamp) VALUES (?, ?, ?, ?)').run(
          deviceId, 'THEFT_HOTWIRE', alertMsg, nowMs
        );
      } catch (e) {}

      io.to(`user_${ownerId}`).emit('notification', {
        id: nowMs + 10,
        type: 'THEFT',
        severity: 'error',
        message: alertMsg,
        timestamp: nowMs,
        is_read: false
      });
      io.to(`user_${ownerId}`).emit('device-alert', {
        vehicleId: deviceId,
        type: 'DEVICE_TAMPERING',
        message: alertMsg,
        timestamp: nowMs
      });

      global.alertCooldowns.set(hotwireKey, nowMs);
    }
  }

  // Towing Detection Alert
  if (ignition === 0 && speed > 2) {
    if (!global.alertCooldowns) global.alertCooldowns = new Map();
    const towingKey = `${deviceId}-towing`;
    const lastTowing = global.alertCooldowns.get(towingKey);
    if (!lastTowing || (nowMs - lastTowing > 300000)) {
      const alertMsg = `Critical Alert: Towing / Unauthorized vehicle movement detected on vehicle ${vehicle.name || deviceId}! Vehicle moving (${speed} km/h) with ignition OFF.`;
      console.warn(`[SECURITY ALERT] ${alertMsg}`);

      try {
        db.prepare('INSERT INTO vehicle_alerts (vehicle_id, type, message, timestamp) VALUES (?, ?, ?, ?)').run(
          deviceId, 'THEFT_TOWING', alertMsg, nowMs
        );
      } catch (e) {}

      io.to(`user_${ownerId}`).emit('notification', {
        id: nowMs + 11,
        type: 'THEFT',
        severity: 'error',
        message: alertMsg,
        timestamp: nowMs,
        is_read: false
      });
      io.to(`user_${ownerId}`).emit('device-alert', {
        vehicleId: deviceId,
        type: 'DEVICE_TAMPERING',
        message: alertMsg,
        timestamp: nowMs
      });

      global.alertCooldowns.set(towingKey, nowMs);
    }
  }

  // Odometer calculation
  let newOdometer = vehicle.odometer_km || 0;
  if (vehicle.lat !== null && vehicle.lng !== null && vehicle.lat !== 0 && vehicle.lng !== 0 &&
      lat !== null && lng !== null && lat !== 0 && lng !== 0) {
    const delta = getDistanceFromLatLonInKm(vehicle.lat, vehicle.lng, lat, lng);
    if (delta > 0 && delta <= 2) {
      newOdometer += delta;
    }
  }

  // Update database
  try {
    db.prepare('UPDATE vehicles SET last_seen = ?, battery_level = ?, fuel_level = ?, is_locked = ?, lat = ?, lng = ?, odometer_km = ? WHERE id = ?')
      .run(nowMs, battery || 100, fuel || 100, isLocked, lat || 0, lng || 0, newOdometer, deviceId);

    db.prepare(`
      INSERT INTO vehicle_history (vehicle_id, timestamp, speed, battery_level, fuel_level, lat, lng)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(deviceId, nowMs, speed || 0, battery || 100, fuel || 100, lat || 0, lng || 0);
  } catch (dbErr) {
    console.error('[TCP DB] Failed to save telematics record:', dbErr.message);
  }

  // Update frontend
  io.to(`user_${ownerId}`).emit('device-data', {
    topic: `/device/${deviceId}/status`,
    payload: {
      deviceId,
      lat,
      lng,
      speed,
      battery,
      fuel,
      locked: isLocked === 1,
      timestamp: nowMs
    }
  });

  // Broadcast to any active shared tracking viewers
  broadcastToSharedTrackers(deviceId, lat, lng, speed, nowMs);

  return { isLocked };
}

// --- TCP Telematics Ingestion Server (Multi-Protocol support) ---
const activeTcpSockets = new Map(); // Maps deviceId -> net.Socket

const TCP_PORT = process.env.PORT_TCP || 5000;
const tcpServer = net.createServer((socket) => {
  let authenticatedDeviceId = null;
  let deviceType = null; // 'custom', 'gt06', 'teltonika'
  let buffer = Buffer.alloc(0);

  console.log(`🔌 New TCP connection from: ${socket.remoteAddress}:${socket.remotePort}`);

  socket.on('data', (data) => {
    buffer = Buffer.concat([buffer, data]);
    let processedLength = 0;

    while (buffer.length - processedLength >= 2) {
      // 1. Custom ASCII simulator protocol ($$)
      if (buffer[processedLength] === 0x24 && buffer[processedLength + 1] === 0x24) {
        const newlineIndex = buffer.indexOf('\n', processedLength);
        if (newlineIndex === -1) break; // wait for full line

        const rawLine = buffer.subarray(processedLength, newlineIndex).toString().trim();
        processedLength = newlineIndex + 1;

        if (!rawLine) continue;

        const parts = rawLine.substring(2).split(',');
        const packetType = parts[0];
        const deviceId = parts[1];

        if (!deviceId) {
          console.warn(`[TCP Parser] Missing DeviceID in packet: ${rawLine}`);
          continue;
        }

        if (packetType === 'LOGIN') {
          const password = parts[2];
          const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(deviceId);
          if (!vehicle) {
            console.warn(`[TCP Auth] Connection attempt for unregistered Device: ${deviceId}`);
            socket.write(`$$LOGIN,FAIL,Unregistered\r\n`);
            socket.destroy();
            return;
          }

          authenticatedDeviceId = deviceId;
          deviceType = 'custom';
          activeTcpSockets.set(deviceId, socket);
          console.log(`[TCP Auth] Custom Device ${deviceId} authenticated.`);
          socket.write(`$$LOGIN,OK\r\n`);

          const currentConfig = db.prepare('SELECT cloud_locked, ble_beacon_id, ble_beacon_rssi_threshold FROM vehicles WHERE id = ?').get(deviceId);
          if (currentConfig) {
            socket.write(`$$CMD,${deviceId},SET_CLOUDLOCKED,${currentConfig.cloud_locked}\r\n`);
            if (currentConfig.ble_beacon_id) {
              socket.write(`$$CMD,${deviceId},SET_BLE_BEACON,${currentConfig.ble_beacon_id},${currentConfig.ble_beacon_rssi_threshold}\r\n`);
            }
          }
        } 
        
        else if (packetType === 'DATA') {
          if (authenticatedDeviceId !== deviceId) {
            console.warn(`[TCP Security] Data packet from unauthenticated socket for Device: ${deviceId}`);
            socket.write(`$$ERROR,Unauthenticated\r\n`);
            socket.destroy();
            return;
          }

          const lat = parseFloat(parts[2]);
          const lng = parseFloat(parts[3]);
          const speed = parseFloat(parts[4]);
          const battery = parseInt(parts[5]);
          const fuel = parseInt(parts[6]);
          const ignition = parseInt(parts[7]);
          const rawBleList = parts[8] || '';

          handleIncomingTelemetry(deviceId, lat, lng, speed, battery, fuel, ignition, rawBleList);
          socket.write(`$$DATA,OK\r\n`);
        }
      }

      // 2. Concox GT06 protocol (0x78 0x78 or 0x79 0x79)
      else if ((buffer[processedLength] === 0x78 && buffer[processedLength + 1] === 0x78) ||
               (buffer[processedLength] === 0x79 && buffer[processedLength + 1] === 0x79)) {
        
        if (buffer.length - processedLength < 6) break;

        const isExtended = buffer[processedLength] === 0x79;
        const length = isExtended 
          ? buffer.readUInt16BE(processedLength + 2) 
          : buffer[processedLength + 2];
        const packetLength = length + (isExtended ? 6 : 5);

        if (buffer.length - processedLength < packetLength) break;

        const packet = buffer.subarray(processedLength, processedLength + packetLength);
        processedLength += packetLength;

        try {
          const lengthOffset = isExtended ? 4 : 3;
          const protocolNumber = packet[lengthOffset];
          const serialNumber = packet.readUInt16BE(packetLength - 4);

          // 0x01: Login Message
          if (protocolNumber === 0x01) {
            let imei = "";
            const imeiOffset = isExtended ? 1 : 0;
            for (let i = 0; i < 8; i++) {
              const byte = packet[4 + imeiOffset + i];
              imei += ((byte >> 4) & 0x0F).toString(16) + (byte & 0x0F).toString(16);
            }
            if (imei.startsWith('0')) imei = imei.substring(1);

            console.log(`[GT06 TCP] Login attempt from IMEI: ${imei}`);
            const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(imei);
            if (!vehicle) {
              console.warn(`[GT06 TCP] Login rejected: IMEI ${imei} not registered.`);
              socket.destroy();
              return;
            }

            authenticatedDeviceId = imei;
            deviceType = 'gt06';
            activeTcpSockets.set(imei, socket);
            console.log(`[GT06 TCP] Device ${imei} authenticated.`);

            // Response ACK
            const response = Buffer.from([0x78, 0x78, 0x05, 0x01, packet[packetLength - 4], packet[packetLength - 3], 0x00, 0x00, 0x0D, 0x0A]);
            const responseCrc = calculateGT06CRC(response.subarray(2, 6));
            response.writeUInt16BE(responseCrc, 6);
            socket.write(response);
          }

          // 0x12, 0x16, 0x22: Location Data / Alarm Data Message
          else if (protocolNumber === 0x12 || protocolNumber === 0x16 || protocolNumber === 0x22) {
            if (!authenticatedDeviceId) {
              console.warn(`[GT06 TCP] Location/Alarm packet received before Login.`);
              socket.destroy();
              return;
            }

            const offset = isExtended ? 1 : 0;
            const rawLat = packet.readUInt32BE(11 + offset);
            const rawLng = packet.readUInt32BE(15 + offset);
            let lat = rawLat / 1800000.0;
            let lng = rawLng / 1800000.0;
            const speed = packet[19 + offset];

            const byteCourseStatus = packet[20 + offset];
            const isNorth = (byteCourseStatus & 0x04) !== 0;
            const isWest = (byteCourseStatus & 0x08) !== 0;

            if (!isNorth) lat = -lat;
            if (isWest) lng = -lng;

            // Determine if ignition is ON/OFF
            let ignition = 1; // Default to ON for basic location updates
            
            // For alarm packets (0x16), the terminal information status byte is often at offset 31 + offset
            if (protocolNumber === 0x16 && packet.length > 31 + offset) {
              const terminalInfo = packet[31 + offset];
              ignition = (terminalInfo & 0x02) !== 0 ? 1 : 0;
            }

            console.log(`[GT06 TCP] Location for ${authenticatedDeviceId} (Protocol 0x${protocolNumber.toString(16)}): Lat=${lat}, Lng=${lng}, Speed=${speed}, Ignition=${ignition}`);
            handleIncomingTelemetry(authenticatedDeviceId, lat, lng, speed, 100, 100, ignition);

            // Response ACK
            const response = Buffer.from([0x78, 0x78, 0x05, protocolNumber, packet[packetLength - 4], packet[packetLength - 3], 0x00, 0x00, 0x0D, 0x0A]);
            const responseCrc = calculateGT06CRC(response.subarray(2, 6));
            response.writeUInt16BE(responseCrc, 6);
            socket.write(response);
          }

          // 0x13: Status / Heartbeat Message
          else if (protocolNumber === 0x13) {
            if (authenticatedDeviceId) {
              const offset = isExtended ? 1 : 0;
              const terminalInfo = packet[4 + offset];
              const ignition = (terminalInfo & 0x02) !== 0 ? 1 : 0;
              const batLevel = packet[5 + offset];
              const battery = Math.min(100, Math.round((batLevel / 6.0) * 100));

              // Fetch last known lat/lng from database to avoid overwriting with 0
              const vehicle = db.prepare('SELECT lat, lng FROM vehicles WHERE id = ?').get(authenticatedDeviceId);
              const lastLat = vehicle ? vehicle.lat : 0;
              const lastLng = vehicle ? vehicle.lng : 0;

              console.log(`[GT06 TCP] Heartbeat status for ${authenticatedDeviceId}: Ignition=${ignition}, Battery=${battery}%`);
              handleIncomingTelemetry(authenticatedDeviceId, lastLat, lastLng, 0, battery, 100, ignition);
            }

            // Response ACK
            const response = Buffer.from([0x78, 0x78, 0x05, 0x13, packet[packetLength - 4], packet[packetLength - 3], 0x00, 0x00, 0x0D, 0x0A]);
            const responseCrc = calculateGT06CRC(response.subarray(2, 6));
            response.writeUInt16BE(responseCrc, 6);
            socket.write(response);
          }
        } catch (gtErr) {
          console.error(`[GT06 TCP] Packet parse error:`, gtErr.message);
        }
      }

      // 3. Teltonika IMEI Login packet (starts with 0x00, followed by length 10-20)
      else if (!authenticatedDeviceId && 
               buffer[processedLength] === 0x00 && 
               buffer[processedLength + 1] >= 10 && 
               buffer[processedLength + 1] <= 20 &&
               buffer.length - processedLength >= buffer[processedLength + 1] + 2) {
        
        const imeiLen = buffer[processedLength + 1];
        const packetLength = imeiLen + 2;
        const imeiStr = buffer.subarray(processedLength + 2, processedLength + packetLength).toString('ascii');

        if (/^\d+$/.test(imeiStr)) {
          processedLength += packetLength;
          console.log(`[Teltonika TCP] Login attempt from IMEI: ${imeiStr}`);

          const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(imeiStr);
          if (!vehicle) {
            console.warn(`[Teltonika TCP] Login rejected: IMEI ${imeiStr} not registered.`);
            socket.write(Buffer.from([0x00]));
            socket.destroy();
            return;
          }

          authenticatedDeviceId = imeiStr;
          deviceType = 'teltonika';
          activeTcpSockets.set(imeiStr, socket);
          console.log(`[Teltonika TCP] Device ${imeiStr} authenticated.`);
          socket.write(Buffer.from([0x01])); // Accept connection
        } else {
          processedLength += 1;
        }
      }

      // 4. Teltonika Codec 8 / 8E binary data packets (4 zeros + 4 length)
      else if (buffer.length - processedLength >= 12 && 
               buffer.readUInt32BE(processedLength) === 0x00000000) {
        
        const dataLength = buffer.readUInt32BE(processedLength + 4);
        const packetLength = dataLength + 12;

        if (buffer.length - processedLength < packetLength) break; // wait for full packet

        const packet = buffer.subarray(processedLength, processedLength + packetLength);
        processedLength += packetLength;

        try {
          if (!authenticatedDeviceId) {
            console.warn(`[Teltonika TCP] Data packet received before login.`);
            socket.destroy();
            return;
          }

          const codecId = packet[8];
          const numRecords = packet[9];
          console.log(`[Teltonika TCP] Parsing ${numRecords} records (Codec ${codecId})`);

          let offset = 10;
          let lastLat = null;
          let lastLng = null;
          let lastSpeed = null;
          let lastIgnition = 1;

          for (let r = 0; r < numRecords; r++) {
            if (offset + 15 > packet.length) break;

            // Timestamp (8 bytes)
            const tsMs = Number(packet.readBigUInt64BE(offset));
            offset += 8;

            // Priority (1 byte)
            const priority = packet[offset];
            offset += 1;

            // GPS Element (15 bytes)
            const rawLng = packet.readInt32BE(offset);
            const rawLat = packet.readInt32BE(offset + 4);
            const altitude = packet.readInt16BE(offset + 8);
            const angle = packet.readInt16BE(offset + 10);
            const satellites = packet[offset + 12];
            const speed = packet.readInt16BE(offset + 13);

            lastLng = rawLng / 10000000.0;
            lastLat = rawLat / 10000000.0;
            lastSpeed = speed;

            offset += 15;

            // I/O Element (Variable length)
            const isExtended = codecId === 0x8E;
            const eventId = isExtended ? packet.readUInt16BE(offset) : packet[offset];
            offset += isExtended ? 2 : 1;

            const totalIoCount = isExtended ? packet.readUInt16BE(offset) : packet[offset];
            offset += isExtended ? 2 : 1;

            // 1-byte properties
            const io1Count = isExtended ? packet.readUInt16BE(offset) : packet[offset];
            offset += isExtended ? 2 : 1;
            for (let i = 0; i < io1Count; i++) {
              const propId = isExtended ? packet.readUInt16BE(offset) : packet[offset];
              offset += isExtended ? 2 : 1;
              const val = packet[offset];
              offset += 1;

              if (propId === 239 || propId === 1) { // ACC/Ignition
                lastIgnition = val;
              }
            }

            // 2-byte properties
            const io2Count = isExtended ? packet.readUInt16BE(offset) : packet[offset];
            offset += isExtended ? 2 : 1;
            for (let i = 0; i < io2Count; i++) {
              const propId = isExtended ? packet.readUInt16BE(offset) : packet[offset];
              offset += isExtended ? 2 : 1;
              offset += 2;
            }

            // 4-byte properties
            const io4Count = isExtended ? packet.readUInt16BE(offset) : packet[offset];
            offset += isExtended ? 2 : 1;
            for (let i = 0; i < io4Count; i++) {
              const propId = isExtended ? packet.readUInt16BE(offset) : packet[offset];
              offset += isExtended ? 2 : 1;
              offset += 4;
            }

            // 8-byte properties
            const io8Count = isExtended ? packet.readUInt16BE(offset) : packet[offset];
            offset += isExtended ? 2 : 1;
            for (let i = 0; i < io8Count; i++) {
              const propId = isExtended ? packet.readUInt16BE(offset) : packet[offset];
              offset += isExtended ? 2 : 1;
              offset += 8;
            }
          }

          if (lastLat !== null && lastLng !== null) {
            console.log(`[Teltonika TCP] Telemetry parsed: Lat=${lastLat}, Lng=${lastLng}, Speed=${lastSpeed}`);
            handleIncomingTelemetry(authenticatedDeviceId, lastLat, lastLng, lastSpeed, 100, 100, lastIgnition);
          }

          // ACK response: 4-byte UInt32BE count of records
          const ack = Buffer.alloc(4);
          ack.writeUInt32BE(numRecords, 0);
          socket.write(ack);
        } catch (telErr) {
          console.error(`[Teltonika TCP] Parse error:`, telErr.message);
        }
      }

      // 5. Unrecognized header - advance by 1 byte to find next valid packet
      else {
        processedLength += 1;
      }
    }

    if (processedLength > 0) {
      buffer = buffer.subarray(processedLength);
    }
  });

  socket.on('close', () => {
    if (authenticatedDeviceId) {
      console.log(`🔌 Connection closed for Device: ${authenticatedDeviceId} (${deviceType})`);
      activeTcpSockets.delete(authenticatedDeviceId);
    } else {
      console.log('🔌 Unauthenticated TCP socket closed.');
    }
  });

  socket.on('error', (err) => {
    console.error(`❌ Socket error on Device: ${authenticatedDeviceId || 'unknown'}:`, err.message);
  });
});

// Vehicle Routes
app.get('/api/vehicles', (req, res) => {
  const userId = getRequestUserId(req);
  try {
    const user = db.prepare('SELECT subscription_status, role FROM users WHERE id = ?').get(userId);
    const isUserSuspended = user && user.subscription_status === 'SUSPENDED' && user.role !== 'admin';

    const vehicles = db.prepare('SELECT * FROM vehicles WHERE owner_id = ?').all(userId);

    const processed = vehicles.map(v => {
      if (isUserSuspended || v.subscription_status === 'SUSPENDED') {
        return {
          ...v,
          lat: 0.0,
          lng: 0.0,
          speed: 0,
          odometer_km: 0
        };
      }
      return v;
    });

    res.json(processed);
  } catch (err) {
    console.error('Get vehicles error:', err);
    res.status(500).json({ error: 'Failed to retrieve vehicles: ' + err.message });
  }
});

app.post('/api/vehicles', async (req, res) => {
  const { id, name, plateNumber, driverName, vehicleType } = req.body;
  const ownerId = getRequestUserId(req); // SECURE: Use resolved user ID
  try {
    // 1. Validate Format (Must be MOTO_XXX, SAFEBOX_XXX, or 15-digit IMEI)
    const idPattern = /^((MOTO|SAFEBOX)_\d{3}|\d{15})$/;
    if (!idPattern.test(id)) {
      return res.status(400).json({ error: 'Invalid ID Format. Must be MOTO_XXX, SAFEBOX_XXX, or a 15-digit IMEI number.' });
    }

    // 2. Validate Whitelist Authorization (SafeBox Company inventory verification)
    const isAuthorized = db.prepare('SELECT 1 FROM authorized_devices WHERE id = ?').get(id);
    if (!isAuthorized) {
      return res.status(400).json({ error: 'Unauthorized Device ID. This tracker is not registered in the SafeBox system. Please contact Support to authorize your hardware.' });
    }

    // 3. Register in Traccar automatically if it is a physical 15-digit IMEI (Non-blocking background call)
    if (/^\d{15}$/.test(id)) {
      const traccarUrl = process.env.TRACCAR_URL || 'https://traccar-production-e4f0.up.railway.app';
      const traccarUser = process.env.TRACCAR_USER || 'admin@safebox.com';
      const traccarPass = process.env.TRACCAR_PASS || 'adminpassword';

      if (traccarUrl && traccarUser && traccarPass) {
        // Run in background without await so it never blocks SafeBox registration
        (async () => {
          try {
            const auth = 'Basic ' + Buffer.from(`${traccarUser}:${traccarPass}`).toString('base64');
            const traccarRes = await fetch(`${traccarUrl}/api/devices`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': auth
              },
              body: JSON.stringify({ name: name || `Vehicle ${id}`, uniqueId: id })
            });

            if (traccarRes.status !== 200 && traccarRes.status !== 400) {
              console.error(`[Traccar Sync] Failed to register device ${id} in Traccar. Status: ${traccarRes.status}`);
            } else {
              console.log(`[Traccar Sync] Successfully registered/verified device ${id} in Traccar.`);
            }
          } catch (traccarErr) {
            console.error('[Traccar Sync] Background error connecting to Traccar API:', traccarErr.message);
          }
        })();
      }
    }

    const typeToSave = vehicleType || 'car';
    const stmt = db.prepare('INSERT INTO vehicles (id, name, owner_id, plate_number, driver_name, vehicle_type, is_locked) VALUES (?, ?, ?, ?, ?, ?, 1)');
    stmt.run(id, name, ownerId, plateNumber || null, driverName || null, typeToSave);
    res.json({ success: true });
  } catch (err) {
    console.error("Add vehicle error:", err);
    res.status(400).json({ error: 'Vehicle ID already claimed or invalid' });
  }
});

// PUT /api/vehicles/:id - Edit registered vehicle details (Auth required)
app.put('/api/vehicles/:id', authMiddleware, (req, res) => {
  const userId = getRequestUserId(req);
  const vehicleId = req.params.id;
  const { name, plateNumber, driverName, vehicleType } = req.body;

  try {
    // 1. Verify owner owns this vehicle
    const vehicle = db.prepare('SELECT 1 FROM vehicles WHERE id = ? AND owner_id = ?').get(vehicleId, userId);
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found or you do not own this vehicle.' });
    }

    // 2. Update details
    const typeToSave = vehicleType || 'car';
    db.prepare('UPDATE vehicles SET name = ?, plate_number = ?, driver_name = ?, vehicle_type = ? WHERE id = ?')
      .run(name || `Vehicle ${vehicleId}`, plateNumber || null, driverName || null, typeToSave, vehicleId);

    console.log(`🚗 Vehicle ${vehicleId} updated by owner ${userId}`);
    res.json({ success: true });
  } catch (err) {
    console.error("Update vehicle error:", err);
    res.status(500).json({ error: 'Failed to update vehicle details: ' + err.message });
  }
});

// HTTP-to-MQTT Webhook Bridge for Traccar (Ingesting SinoTrack, Teltonika, etc.)
app.post('/api/telematics-webhook', (req, res) => {
  try {
    const data = req.body;
    console.log('[Webhook Bridge] Received Traccar payload:', JSON.stringify(data));

    // Create a mapping from internal Traccar ID to actual IMEI (uniqueId)
    const deviceMap = new Map();
    if (data.devices && Array.isArray(data.devices)) {
      for (const dev of data.devices) {
        deviceMap.set(dev.id, dev.uniqueId);
      }
    } else if (data.device) {
      deviceMap.set(data.device.id, data.device.uniqueId);
    }

    const positionsToProcess = [];
    if (data.positions && Array.isArray(data.positions)) {
      positionsToProcess.push(...data.positions);
    } else if (data.position) {
      positionsToProcess.push(data.position);
    }

    for (const pos of positionsToProcess) {
      if (!pos.deviceId) continue;

      // Resolve the internal ID to the 15-digit IMEI (uniqueId)
      let deviceId = pos.deviceId.toString();
      if (deviceMap.has(pos.deviceId)) {
        deviceId = deviceMap.get(pos.deviceId);
      } else if (pos.uniqueId) {
        deviceId = pos.uniqueId.toString();
      } else if (data.device && data.device.id === pos.deviceId) {
        deviceId = data.device.uniqueId;
      }

      console.log(`[Webhook Bridge] Resolved deviceId/IMEI: ${deviceId}`);
      
      // Extract BLE Beacons if present from Traccar AVL elements
      let rawBleList = '';
      const bleParts = [];
      for (let b = 1; b <= 4; b++) {
        const idKey = `io${383 + b * 2}`; // io385, io387, io389, io391
        const rssiKey = `io${384 + b * 2}`; // io386, io388, io390, io392
        const altIdKey = `beacon${b}Id`;
        const altRssiKey = `beacon${b}Rssi`;
        const mac = pos.attributes?.[idKey] || pos.attributes?.[altIdKey];
        const rssi = pos.attributes?.[rssiKey] || pos.attributes?.[altRssiKey];
        if (mac && rssi !== undefined) {
          bleParts.push(`${mac}:${rssi}`);
        }
      }
      if (bleParts.length > 0) {
        rawBleList = bleParts.join(';');
      }

      // Convert battery voltage (Volts or millivolts) to percentage if needed
      let batteryPct = 100;
      if (pos.attributes?.batteryLevel !== undefined) {
        batteryPct = pos.attributes.batteryLevel;
      } else if (pos.attributes?.battery !== undefined) {
        const val = pos.attributes.battery;
        if (val > 100) {
          // sent in millivolts (e.g. 3787 mV)
          batteryPct = Math.round(Math.min(100, Math.max(0, ((val - 3600) / 230) * 100)));
        } else if (val > 1.0 && val < 6.0) {
          // sent in Volts (e.g. 3.787 V)
          batteryPct = Math.round(Math.min(100, Math.max(0, ((val - 3.6) / 0.23) * 100)));
        } else {
          batteryPct = val;
        }
      }

      // Normalize the payload to match the SafeBox MQTT status schema
      const normalizedPayload = {
        deviceId: deviceId,
        lat: pos.latitude || 0,
        lng: pos.longitude || 0,
        speed: pos.speed ? Math.round(pos.speed * 1.852) : 0, // Knots to km/h conversion
        battery: batteryPct,
        fuel: pos.attributes?.fuel || 100,
        locked: pos.attributes?.ignition === false, // If ignition is false, engine start is blocked/locked
        rawBleList: rawBleList
      };

      // Publish to MQTT broker (HiveMQ / EMQX)
      const topic = `/device/${deviceId}/status`;
      mqttClient.publish(topic, JSON.stringify(normalizedPayload), { qos: 1 }, (mqttErr) => {
        if (mqttErr) {
          console.error(`[Webhook Bridge] Failed to publish MQTT status for ${deviceId}:`, mqttErr.message);
        } else {
          console.log(`[Webhook Bridge] Published status to MQTT for ${deviceId}`);
        }
      });
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('[Webhook Bridge] Error processing webhook:', err.message);
    res.status(500).json({ error: 'Failed to process telematics payload: ' + err.message });
  }
});

// Admin Route: Whitelist/Authorize new tracker IMEIs (SafeBox Super Admin functionality)
app.post('/api/admin/authorize-device', (req, res) => {
  const { id, secret } = req.body;
  const adminSecret = process.env.SUPERADMIN_SECRET || 'safebox_superadmin_secret_key';

  if (!id) {
    return res.status(400).json({ error: 'Device ID/IMEI is required.' });
  }

  // Simple token/secret check for secure API access
  if (secret !== adminSecret) {
    return res.status(403).json({ error: 'Unauthorized. Invalid Super Admin secret.' });
  }

  try {
    const idPattern = /^((MOTO|SAFEBOX)_\d{3}|\d{15})$/;
    if (!idPattern.test(id)) {
      return res.status(400).json({ error: 'Invalid ID format. Must be MOTO_XXX, SAFEBOX_XXX, or a 15-digit IMEI.' });
    }

    db.prepare('INSERT OR IGNORE INTO authorized_devices (id) VALUES (?)').run(id);
    console.log(`🛡️ Whitelisted new device IMEI: ${id}`);
    res.json({ success: true, message: `Device ${id} has been successfully whitelisted in SafeBox inventory.` });
  } catch (err) {
    console.error('Super Admin authorize-device error:', err);
    res.status(500).json({ error: 'Failed to whitelist device' });
  }
});

// --- SECURITY: Super Admin Middleware ---
function adminMiddleware(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Forbidden. Super Admin access required.' });
  }
}

// Helper: Resolve the target user ID for query operations (enables impersonation)
function getRequestUserId(req) {
  if (req.user && req.user.role === 'admin' && req.headers['x-impersonate-user-id']) {
    return parseInt(req.headers['x-impersonate-user-id'], 10);
  }
  return req.user.id;
}

// --- SUPER ADMIN: Dashboard KPI & System Metrics ---
app.get('/api/admin/metrics', authMiddleware, adminMiddleware, (req, res) => {
  try {
    // 1. Total Tenants (Companies / Organizations)
    const totalTenants = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'company'").get().count;

    // 2. Total Vehicles (Active vs Suspended)
    const vehicles = db.prepare("SELECT subscription_status, COUNT(*) as count FROM vehicles GROUP BY subscription_status").all();
    let totalVehicles = 0;
    let activeVehicles = 0;
    vehicles.forEach(v => {
      totalVehicles += v.count;
      if (v.subscription_status === 'ACTIVE') {
        activeVehicles += v.count;
      }
    });

    // 3. Total Whitelisted Devices vs Claimed (Available in inventory)
    const totalWhitelisted = db.prepare("SELECT COUNT(*) as count FROM authorized_devices").get().count;
    const claimedTrackers = db.prepare("SELECT COUNT(DISTINCT id) as count FROM vehicles").get().count;
    const availableTrackers = Math.max(0, totalWhitelisted - claimedTrackers);

    // 4. Total Collected Payments (Revenue)
    const totalRev = db.prepare("SELECT SUM(amount) as sum FROM payments WHERE status = 'SUCCESS'").get().sum || 0;

    // 5. Active connection sessions (connected WebSocket client instances)
    const activeClients = io.sockets.sockets.size;

    // 6. Database storage utilization (size of sqlite file)
    const fs = require('fs');
    const path = require('path');
    const dbPath = path.join(__dirname, 'database.sqlite');
    let dbSize = '0 MB';
    if (fs.existsSync(dbPath)) {
      const stats = fs.statSync(dbPath);
      dbSize = (stats.size / (1024 * 1024)).toFixed(2) + ' MB';
    }

    res.json({
      totalTenants,
      totalVehicles,
      activeVehicles,
      totalWhitelisted,
      claimedTrackers,
      availableTrackers,
      totalRevenue: totalRev,
      activeClients,
      databaseSize: dbSize
    });
  } catch (err) {
    console.error("Super Admin metrics error:", err);
    res.status(500).json({ error: 'Failed to fetch admin metrics: ' + err.message });
  }
});

// --- SUPER ADMIN: Global Alerts Feed ---
app.get('/api/admin/alerts', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const alerts = db.prepare(`
      SELECT a.*, v.name as vehicle_name, u.username as owner_username, u.company_name
      FROM vehicle_alerts a
      JOIN vehicles v ON a.vehicle_id = v.id
      JOIN users u ON v.owner_id = u.id
      ORDER BY a.timestamp DESC
      LIMIT 30
    `).all();
    res.json(alerts);
  } catch (err) {
    console.error("Super Admin alerts fetch error:", err);
    res.status(500).json({ error: 'Failed to fetch global alerts feed: ' + err.message });
  }
});

// --- SUPER ADMIN: Tenants List & Detailed Counts ---
app.get('/api/admin/tenants', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const tenants = db.prepare(`
      SELECT id, username, company_name, email, phone, plan_id, subscription_status, currency
      FROM users
      WHERE role IN ('company', 'individual')
      ORDER BY id DESC
    `).all();

    // Enrich with statistics
    const enrichedTenants = tenants.map(t => {
      const vehiclesCount = db.prepare("SELECT COUNT(*) as count FROM vehicles WHERE owner_id = ?").get(t.id).count;
      const paymentsCount = db.prepare("SELECT COUNT(*) as count FROM payments WHERE user_id = ? AND status = 'SUCCESS'").get(t.id).count;
      const totalPaid = db.prepare("SELECT SUM(amount) as sum FROM payments WHERE user_id = ? AND status = 'SUCCESS'").get(t.id).sum || 0;
      
      return {
        ...t,
        vehiclesCount,
        paymentsCount,
        totalPaid
      };
    });

    res.json(enrichedTenants);
  } catch (err) {
    console.error("Super Admin tenants fetch error:", err);
    res.status(500).json({ error: 'Failed to fetch tenants list: ' + err.message });
  }
});

// --- SUPER ADMIN: Toggle Tenant Subscription Status (Suspend/Activate) ---
app.post('/api/admin/tenants/:id/toggle-status', authMiddleware, adminMiddleware, (req, res) => {
  const { id } = req.params;
  try {
    const user = db.prepare("SELECT subscription_status, role FROM users WHERE id = ?").get(id);
    if (!user) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const newStatus = user.subscription_status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    
    db.transaction(() => {
      // 1. Update user
      db.prepare("UPDATE users SET subscription_status = ? WHERE id = ?").run(newStatus, id);
      // 2. Propagate to vehicles (Also force remote lock state if suspended)
      if (newStatus === 'SUSPENDED') {
        db.prepare("UPDATE vehicles SET subscription_status = 'SUSPENDED', cloud_locked = 1, is_locked = 1 WHERE owner_id = ?").run(id);
      } else {
        db.prepare("UPDATE vehicles SET subscription_status = 'ACTIVE', cloud_locked = 0, is_locked = 0 WHERE owner_id = ?").run(id);
      }
    })();

    // 3. Send commands to active trackers (MQTT / TCP)
    const vehicles = db.prepare("SELECT id FROM vehicles WHERE owner_id = ?").all(id);
    vehicles.forEach(v => {
      if (newStatus === 'SUSPENDED') {
        mqttClient.publish(`/device/${v.id}/command`, JSON.stringify({ command: 'BLOCK_START' }));
        mqttClient.publish(`/device/${v.id}/command`, JSON.stringify({ command: 'LOCK' }));
        if (activeTcpSockets.has(v.id)) {
          activeTcpSockets.get(v.id).write(`$$CMD,${v.id},SET_CLOUDLOCKED,1\r\n`);
        }
      } else {
        mqttClient.publish(`/device/${v.id}/command`, JSON.stringify({ command: 'ALLOW_START' }));
        mqttClient.publish(`/device/${v.id}/command`, JSON.stringify({ command: 'UNLOCK' }));
        if (activeTcpSockets.has(v.id)) {
          activeTcpSockets.get(v.id).write(`$$CMD,${v.id},SET_CLOUDLOCKED,0\r\n`);
        }
      }
    });

    if (newStatus === 'SUSPENDED') {
      try {
        io.in(`user_${id}`).disconnectSockets(true);
        console.log(`🔌 Terminated active WebSocket connections for suspended user ID: ${id}`);
      } catch (e) {
        console.error(`Failed to disconnect sockets for suspended user ID: ${id}`, e);
      }
    }

    console.log(`🛡️ Super Admin changed subscription status of user ${id} to ${newStatus}`);
    res.json({ success: true, newStatus });
  } catch (err) {
    console.error("Super Admin toggle tenant status error:", err);
    res.status(500).json({ error: 'Failed to toggle tenant subscription status' });
  }
});

// --- SUPER ADMIN: Delete Tenant Account ---
app.delete('/api/admin/tenants/:id', authMiddleware, adminMiddleware, (req, res) => {
  const { id } = req.params;
  try {
    const user = db.prepare("SELECT username, role FROM users WHERE id = ?").get(id);
    if (!user) {
      return res.status(404).json({ error: 'Tenant not found' });
    }
    if (user.role === 'admin') {
      return res.status(400).json({ error: 'Cannot delete an administrator account' });
    }

    db.transaction(() => {
      // Get all vehicles owned by this tenant
      const vehicles = db.prepare("SELECT id FROM vehicles WHERE owner_id = ?").all(id);
      const vehicleIds = vehicles.map(v => v.id);

      if (vehicleIds.length > 0) {
        const placeholders = vehicleIds.map(() => '?').join(',');
        
        // 1. Delete from vehicle_history
        db.prepare(`DELETE FROM vehicle_history WHERE vehicle_id IN (${placeholders})`).run(...vehicleIds);
        // 2. Delete from vehicle_alerts
        db.prepare(`DELETE FROM vehicle_alerts WHERE vehicle_id IN (${placeholders})`).run(...vehicleIds);
        // 3. Delete from geofences
        db.prepare(`DELETE FROM geofences WHERE vehicle_id IN (${placeholders})`).run(...vehicleIds);
        // 4. Delete from maintenance_reminders
        db.prepare(`DELETE FROM maintenance_reminders WHERE vehicle_id IN (${placeholders})`).run(...vehicleIds);
        // 5. Delete from override_requests
        db.prepare(`DELETE FROM override_requests WHERE vehicle_id IN (${placeholders})`).run(...vehicleIds);
        
        // Check if fuel_settings table exists
        try {
          db.prepare(`DELETE FROM fuel_settings WHERE vehicle_id IN (${placeholders})`).run(...vehicleIds);
        } catch (e) { /* ignore if table doesn't exist */ }

        // 6. Delete from vehicles
        db.prepare(`DELETE FROM vehicles WHERE owner_id = ?`).run(id);
      }

      // 7. Delete payments
      db.prepare(`DELETE FROM payments WHERE user_id = ?`).run(id);
      // 8. Delete report schedules
      db.prepare(`DELETE FROM report_schedules WHERE user_id = ?`).run(id);
      // 9. Delete report history
      db.prepare(`DELETE FROM report_history WHERE generated_by = ?`).run(id);
      // 10. Delete reports
      db.prepare(`DELETE FROM reports WHERE user_id = ?`).run(id);
      // 11. Delete support codes
      db.prepare(`DELETE FROM support_codes WHERE user_id = ?`).run(id);
      // 12. Delete subscriptions
      db.prepare(`DELETE FROM subscriptions WHERE user_id = ?`).run(id);
      // 13. Finally delete the user
      db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
    })();

    console.log(`🛡️ Super Admin deleted user ${user.username} (ID: ${id}) and all associated fleet data.`);
    res.json({ success: true, message: 'Tenant and all associated data deleted successfully.' });
  } catch (err) {
    console.error("Super Admin delete tenant error:", err);
    res.status(500).json({ error: 'Failed to delete tenant: ' + err.message });
  }
});


// --- SUPER ADMIN: Get Running Server Logs ---
app.get('/api/admin/logs', authMiddleware, adminMiddleware, (req, res) => {
  res.json(global.serverLogs || []);
});


// --- SUPER ADMIN: Device Inventory List ---
app.get('/api/admin/devices', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const devices = db.prepare(`
      SELECT ad.id, ad.created_at, v.name as vehicle_name, u.username as owner_username, u.company_name
      FROM authorized_devices ad
      LEFT JOIN vehicles v ON v.id = ad.id
      LEFT JOIN users u ON u.id = v.owner_id
      ORDER BY ad.created_at DESC
    `).all();

    res.json(devices);
  } catch (err) {
    console.error("Super Admin devices fetch error:", err);
    res.status(500).json({ error: 'Failed to fetch device inventory: ' + err.message });
  }
});

// --- SUPER ADMIN: Bulk Whitelist Tracker Devices ---
app.post('/api/admin/devices/whitelist', authMiddleware, adminMiddleware, (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Array of device IDs/IMEIs (ids) is required.' });
  }

  try {
    const idPattern = /^((MOTO|SAFEBOX)_\d{3}|\d{15})$/;
    const invalidIds = ids.filter(id => !idPattern.test(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({ error: `Invalid ID formats: ${invalidIds.join(', ')}. Must be MOTO_XXX, SAFEBOX_XXX, or a 15-digit IMEI.` });
    }

    const insertStmt = db.prepare('INSERT OR IGNORE INTO authorized_devices (id) VALUES (?)');
    let addedCount = 0;
    
    db.transaction(() => {
      for (const id of ids) {
        const info = insertStmt.run(id);
        if (info.changes > 0) {
          addedCount++;
        }
      }
    })();

    console.log(`🛡️ Whitelisted ${addedCount} new devices in inventory via Super Admin bulk whitelist.`);
    res.json({ success: true, message: `Successfully whitelisted ${addedCount} new devices.` });
  } catch (err) {
    console.error('Super Admin bulk whitelist error:', err);
    res.status(500).json({ error: 'Failed to whitelist devices' });
  }
});

// --- SUPER ADMIN: Delete Whitelisted Device IMEI ---
app.delete('/api/admin/devices/:id', authMiddleware, adminMiddleware, (req, res) => {
  const deviceId = req.params.id;
  try {
    // 1. Delete from vehicles first (if registered) to prevent orphan records
    db.prepare('DELETE FROM vehicles WHERE id = ?').run(deviceId);
    
    // 2. Delete from authorized_devices whitelist
    const info = db.prepare('DELETE FROM authorized_devices WHERE id = ?').run(deviceId);

    if (info.changes === 0) {
      return res.status(404).json({ error: 'Device not found in whitelist.' });
    }

    console.log(`🛡️ Whitelisted device ${deviceId} removed by admin`);
    res.json({ success: true });
  } catch (err) {
    console.error("Super Admin device delete error:", err);
    res.status(500).json({ error: 'Failed to delete device: ' + err.message });
  }
});

// --- SUPER ADMIN: Transaction Payment Logs ---
app.get('/api/admin/payments', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const payments = db.prepare(`
      SELECT p.id, p.amount, p.timestamp, p.status, p.reference, u.username, u.company_name
      FROM payments p
      JOIN users u ON u.id = p.user_id
      ORDER BY p.timestamp DESC
    `).all();

    res.json(payments);
  } catch (err) {
    console.error("Super Admin payments fetch error:", err);
    res.status(500).json({ error: 'Failed to fetch payment logs: ' + err.message });
  }
});

app.delete('/api/vehicles/:id', (req, res) => {
  const userId = getRequestUserId(req);
  const vehicleId = req.params.id;
  try {
    // Verify ownership
    const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(vehicleId);
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }
    if (vehicle.owner_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized to delete this vehicle' });
    }

    // Delete related records first to avoid foreign key constraint
    db.prepare('DELETE FROM geofences WHERE vehicle_id = ?').run(vehicleId);
    db.prepare('DELETE FROM vehicle_history WHERE vehicle_id = ?').run(vehicleId);

    // Now delete the vehicle
    db.prepare('DELETE FROM vehicles WHERE id = ?').run(vehicleId);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete vehicle error:', err);
    res.status(500).json({ error: 'Failed to delete vehicle' });
  }
});

// Update BLE keyless entry settings for a vehicle
app.post('/api/vehicles/ble-settings', (req, res) => {
  const userId = req.user.id;
  const { vehicleId, bleBeaconId, bleBeaconRssiThreshold } = req.body;

  if (!vehicleId) {
    return res.status(400).json({ error: 'Vehicle ID is required.' });
  }

  try {
    const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(vehicleId);
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found.' });
    }
    if (vehicle.owner_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized to modify settings for this vehicle.' });
    }

    const rssi = bleBeaconRssiThreshold !== undefined ? parseInt(bleBeaconRssiThreshold) : -80;

    db.prepare('UPDATE vehicles SET ble_beacon_id = ?, ble_beacon_rssi_threshold = ? WHERE id = ?')
      .run(bleBeaconId || null, rssi, vehicleId);

    // Sync to device over TCP
    if (activeTcpSockets.has(vehicleId)) {
      const socket = activeTcpSockets.get(vehicleId);
      socket.write(`$$CMD,${vehicleId},SET_BLE_BEACON,${bleBeaconId || ''},${rssi}\r\n`);
      console.log(`[BLE Config Sync] Pushed new BLE configuration to TCP socket for ${vehicleId}`);
    }

    res.json({ success: true, message: 'BLE Keyless Entry configurations saved successfully.' });
  } catch (err) {
    console.error('Save BLE settings failed:', err);
    res.status(500).json({ error: 'Failed to save BLE configurations.' });
  }
});

// Helper: Check if current time is within operation allowed hours
function isWithinAllowedHours(now, startStr, endStr, daysJson, holidayMode) {
  // 1. Check Holiday Mode
  if (holidayMode) {
    const todayStr = now.toISOString().split('T')[0]; // "YYYY-MM-DD"
    const PUBLIC_HOLIDAYS = ['2026-01-01', '2026-06-04', '2026-12-25'];
    if (PUBLIC_HOLIDAYS.includes(todayStr)) {
      return false; // Public holiday is restricted
    }
  }

  // 2. Check Day of Week
  const daysMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const currentDay = daysMap[now.getDay()];
  
  let allowedDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  if (daysJson) {
    try {
      const parsed = typeof daysJson === 'string' ? JSON.parse(daysJson) : daysJson;
      if (Array.isArray(parsed) && parsed.length > 0) {
        allowedDays = parsed;
      }
    } catch (e) {
      console.error('Failed to parse allowed days JSON:', e.message);
    }
  }

  if (!allowedDays.includes(currentDay)) {
    return false; // Day is restricted
  }

  // 3. Check Hours
  if (!startStr || !endStr) return true;
  const nowStr = now.toTimeString().substring(0, 5); // "HH:MM"
  if (startStr <= endStr) {
    return nowStr >= startStr && nowStr < endStr;
  } else {
    return nowStr >= startStr || nowStr < endStr;
  }
}

// Vehicle Access Policy Settings Update (Curfew Scheduling)
app.post('/api/vehicles/curfew', (req, res) => {
  const userId = req.user.id;
  let { vehicleIds, applyTo, curfewEnabled, curfewStart, curfewEnd, curfewDays, curfewAllowOverride, curfewHolidayMode } = req.body;

  if (applyTo === 'all') {
    const list = db.prepare('SELECT id FROM vehicles WHERE owner_id = ?').all(userId);
    vehicleIds = list.map(v => v.id);
  }

  if (!vehicleIds || !Array.isArray(vehicleIds) || vehicleIds.length === 0) {
    return res.status(400).json({ error: 'No vehicles selected or found.' });
  }

  if (curfewEnabled && (!curfewStart || !curfewEnd)) {
    return res.status(400).json({ error: 'Curfew start and end times are required when curfew is enabled.' });
  }

  // Validate start and end time format (HH:MM)
  const timePattern = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
  if (curfewStart && !timePattern.test(curfewStart)) {
    return res.status(400).json({ error: 'Invalid start time format. Use HH:MM.' });
  }
  if (curfewEnd && !timePattern.test(curfewEnd)) {
    return res.status(400).json({ error: 'Invalid end time format. Use HH:MM.' });
  }

  const daysJson = JSON.stringify(curfewDays || ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']);
  const allowOverride = curfewAllowOverride ? 1 : 0;
  const holidayMode = curfewHolidayMode ? 1 : 0;

  try {
    // 1. Verify all vehicleIds are owned by the user
    const placeholders = vehicleIds.map(() => '?').join(',');
    const count = db.prepare(`SELECT COUNT(*) as count FROM vehicles WHERE owner_id = ? AND id IN (${placeholders})`).get(userId, ...vehicleIds);
    if (count.count !== vehicleIds.length) {
      return res.status(403).json({ error: 'One or more vehicle IDs are invalid or not owned by you.' });
    }

    // 2. Perform updates in a transaction
    const updateStmt = db.prepare(`
      UPDATE vehicles
      SET curfew_enabled = ?,
          curfew_start = ?,
          curfew_end = ?,
          curfew_days = ?,
          curfew_allow_override = ?,
          curfew_holiday_mode = ?
      WHERE id = ? AND owner_id = ?
    `);

    const updateCurfewLockStmt = db.prepare(`
      UPDATE vehicles
      SET curfew_enabled = ?,
          curfew_start = ?,
          curfew_end = ?,
          curfew_days = ?,
          curfew_allow_override = ?,
          curfew_holiday_mode = ?,
          is_locked = ?
      WHERE id = ? AND owner_id = ?
    `);

    const now = new Date();
    const isCurfew = !isWithinAllowedHours(now, curfewStart, curfewEnd, daysJson, holidayMode);

    const transaction = db.transaction(() => {
      vehicleIds.forEach(vid => {
        if (curfewEnabled) {
          if (isCurfew) {
            // Curfew is active right now! Force lock state in DB and send BLOCK_START
            updateCurfewLockStmt.run(1, curfewStart, curfewEnd, daysJson, allowOverride, holidayMode, 1, vid, userId);
            mqttClient.publish(`/device/${vid}/command`, JSON.stringify({ command: 'BLOCK_START' }));
            if (activeTcpSockets.has(vid)) {
              activeTcpSockets.get(vid).write(`$$CMD,${vid},SET_CLOUDLOCKED,1\r\n`);
            }
            console.log(`[Curfew API] Applied curfew (active) to ${vid}: Block Start sent`);
          } else {
            // Curfew is enabled but operations are allowed. Update settings only.
            // Also ensure the vehicle is unblocked in the DB and receive unblock commands.
            updateCurfewLockStmt.run(1, curfewStart, curfewEnd, daysJson, allowOverride, holidayMode, 0, vid, userId);
            mqttClient.publish(`/device/${vid}/command`, JSON.stringify({ command: 'ALLOW_START' }));
            mqttClient.publish(`/device/${vid}/command`, JSON.stringify({ command: 'UNLOCK' }));
            if (activeTcpSockets.has(vid)) {
              activeTcpSockets.get(vid).write(`$$CMD,${vid},SET_CLOUDLOCKED,0\r\n`);
            }
            console.log(`[Curfew API] Applied curfew (inactive) to ${vid}: Settings updated, Allow Start sent`);
          }
        } else {
          // Curfew is disabled! Transition vehicles out of start-blocked state.
          updateCurfewLockStmt.run(0, curfewStart || '06:00', curfewEnd || '18:00', daysJson, allowOverride, holidayMode, 0, vid, userId);
          mqttClient.publish(`/device/${vid}/command`, JSON.stringify({ command: 'ALLOW_START' }));
          if (activeTcpSockets.has(vid)) {
            activeTcpSockets.get(vid).write(`$$CMD,${vid},SET_CLOUDLOCKED,0\r\n`);
          }
          console.log(`[Curfew API] Disabled curfew for ${vid}: Allow Start sent`);
        }
      });
    });

    transaction();

    // Broadcast update to the frontend
    io.to(`user_${userId}`).emit('billing-updated', { userId, vehicleIds });

    res.json({ success: true, message: 'Vehicle Access Policy applied successfully.' });
  } catch (err) {
    console.error('Curfew settings update failed:', err);
    res.status(500).json({ error: 'Failed to update curfew settings' });
  }
});

// GET Pending Override Requests
app.get('/api/override/pending', authMiddleware, (req, res) => {
  const userId = getRequestUserId(req);
  try {
    const user = db.prepare('SELECT subscription_status, role FROM users WHERE id = ?').get(userId);
    if (user && user.subscription_status === 'SUSPENDED' && user.role !== 'admin') {
      return res.json([]);
    }

    const list = db.prepare(`
      SELECT o.*, v.name as vehicle_name, v.plate_number
      FROM override_requests o
      JOIN vehicles v ON o.vehicle_id = v.id
      WHERE v.owner_id = ? AND o.status = 'PENDING'
      ORDER BY o.requested_at DESC
    `).all(userId);
    res.json(list);
  } catch (err) {
    console.error('Failed to fetch pending overrides:', err);
    res.status(500).json({ error: 'Failed to fetch pending overrides' });
  }
});

// POST Resolve Override Request (Approve/Deny)
app.post('/api/override/resolve', authMiddleware, (req, res) => {
  const userId = getRequestUserId(req);
  const { requestId, status } = req.body; // 'APPROVED_ONCE', 'APPROVED_MIDNIGHT', 'DENIED'

  if (!requestId || !['APPROVED_ONCE', 'APPROVED_MIDNIGHT', 'DENIED'].includes(status)) {
    return res.status(400).json({ error: 'Valid Request ID and resolution status are required.' });
  }

  try {
    // Verify override request belongs to user's vehicle
    const request = db.prepare(`
      SELECT o.*, v.id as vehicle_id, v.owner_id
      FROM override_requests o
      JOIN vehicles v ON o.vehicle_id = v.id
      WHERE o.id = ?
    `).get(requestId);

    if (!request) {
      return res.status(404).json({ error: 'Override request not found.' });
    }
    if (request.owner_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized to resolve this request.' });
    }

    let expiresAt = 0;
    if (status === 'APPROVED_ONCE') {
      expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes to start
    } else if (status === 'APPROVED_MIDNIGHT') {
      // Until midnight today
      const midnight = new Date();
      midnight.setHours(23, 59, 59, 999);
      expiresAt = midnight.getTime();
    }

    // Update override request status in requests table
    db.prepare(`
      UPDATE override_requests
      SET status = ?, resolved_at = ?
      WHERE id = ?
    `).run(status, Date.now(), requestId);

    // Update vehicle override status
    db.prepare(`
      UPDATE vehicles
      SET override_status = ?, override_expires = ?, is_locked = ?
      WHERE id = ?
    `).run(status, expiresAt, status === 'DENIED' ? 1 : 0, request.vehicle_id);

    // Sync command to TCP device if online
    const tcpLockVal = status !== 'DENIED' ? 0 : 1;
    if (activeTcpSockets.has(request.vehicle_id)) {
      activeTcpSockets.get(request.vehicle_id).write(`$$CMD,${request.vehicle_id},SET_CLOUDLOCKED,${tcpLockVal}\r\n`);
    }

    // If approved, send ALLOW_START and UNLOCK via MQTT
    if (status !== 'DENIED') {
      mqttClient.publish(`/device/${request.vehicle_id}/command`, JSON.stringify({ command: 'ALLOW_START' }));
      mqttClient.publish(`/device/${request.vehicle_id}/command`, JSON.stringify({ command: 'UNLOCK' }));
    } else {
      mqttClient.publish(`/device/${request.vehicle_id}/command`, JSON.stringify({ command: 'BLOCK_START' }));
    }

    // Emit override-resolved event to all manager sessions
    io.to(`user_${userId}`).emit('override-resolved', {
      requestId,
      vehicleId: request.vehicle_id,
      status,
      expiresAt
    });

    res.json({ success: true, message: `Request successfully ${status.toLowerCase().replace('_', ' ')}.` });
  } catch (err) {
    console.error('Failed to resolve override:', err);
    res.status(500).json({ error: 'Failed to resolve override request' });
  }
});


// --- DYNAMIC MAINTENANCE REMINDERS API ---

// Get all maintenance reminders for a vehicle
app.get('/api/vehicles/:vehicleId/maintenance', async (req, res) => {
  const userId = getRequestUserId(req);
  const { vehicleId } = req.params;

  try {
    // Verify ownership of the vehicle
    const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(vehicleId);
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }
    if (vehicle.owner_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized to access maintenance for this vehicle' });
    }

    const reminders = db.prepare('SELECT * FROM maintenance_reminders WHERE vehicle_id = ?').all(vehicleId);
    res.json(reminders);
  } catch (err) {
    console.error('Fetch maintenance reminders error:', err);
    res.status(500).json({ error: 'Failed to retrieve maintenance reminders' });
  }
});

// Create or update a maintenance reminder
app.post('/api/vehicles/:vehicleId/maintenance', async (req, res) => {
  const userId = getRequestUserId(req);
  const { vehicleId } = req.params;
  const { id, type, custom_name, threshold_km, last_service_km, due_date, notes, status } = req.body;

  if (!type) {
    return res.status(400).json({ error: 'Reminder type is required' });
  }

  const validTypes = ['Oil Change', 'Brake Service', 'Tire Change', 'Insurance', 'Road Worthiness', 'Vehicle License', 'Custom'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `Invalid reminder type. Must be one of: ${validTypes.join(', ')}` });
  }

  try {
    // Verify ownership of the vehicle
    const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(vehicleId);
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }
    if (vehicle.owner_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized to manage maintenance for this vehicle' });
    }

    if (id) {
      // Update existing reminder
      const existing = db.prepare('SELECT vehicle_id FROM maintenance_reminders WHERE id = ?').get(id);
      if (!existing) {
        return res.status(404).json({ error: 'Reminder not found' });
      }
      if (existing.vehicle_id !== vehicleId) {
        return res.status(400).json({ error: 'Reminder does not belong to this vehicle' });
      }

      const stmt = db.prepare(`
        UPDATE maintenance_reminders 
        SET type = ?, custom_name = ?, threshold_km = ?, last_service_km = ?, due_date = ?, notes = ?, status = ?, alerted = 0
        WHERE id = ?
      `);
      stmt.run(type, custom_name || null, threshold_km || null, last_service_km || null, due_date || null, notes || null, status || 'PENDING', id);
      res.json({ success: true, id });
    } else {
      // Create new reminder
      const stmt = db.prepare(`
        INSERT INTO maintenance_reminders (vehicle_id, type, custom_name, threshold_km, last_service_km, due_date, notes, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const info = stmt.run(vehicleId, type, custom_name || null, threshold_km || null, last_service_km || null, due_date || null, notes || null, status || 'PENDING');
      res.json({ success: true, id: info.lastInsertRowid });
    }
  } catch (err) {
    console.error('Save maintenance reminder error:', err);
    res.status(500).json({ error: 'Failed to save maintenance reminder' });
  }
});

// Delete a maintenance reminder
app.delete('/api/vehicles/:vehicleId/maintenance/:reminderId', async (req, res) => {
  const userId = getRequestUserId(req);
  const { vehicleId, reminderId } = req.params;

  try {
    // Verify ownership of the vehicle
    const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(vehicleId);
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }
    if (vehicle.owner_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized to delete maintenance for this vehicle' });
    }

    // Verify reminder exists and belongs to the vehicle
    const reminder = db.prepare('SELECT vehicle_id FROM maintenance_reminders WHERE id = ?').get(reminderId);
    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found' });
    }
    if (reminder.vehicle_id !== vehicleId) {
      return res.status(400).json({ error: 'Reminder does not belong to this vehicle' });
    }

    db.prepare('DELETE FROM maintenance_reminders WHERE id = ?').run(reminderId);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete maintenance reminder error:', err);
    res.status(500).json({ error: 'Failed to delete maintenance reminder' });
  }
});

// --- DIAGNOSTIC SUPPORT MODE API ---

// Generate diagnostic support code (authenticated)
app.post('/api/support/generate-code', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  try {
    // Generate SUP-XXXX code
    const digits = Math.floor(1000 + Math.random() * 9000).toString();
    const code = `SUP-${digits}`;
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours from now

    // Save to DB
    const stmt = db.prepare('INSERT OR REPLACE INTO support_codes (code, user_id, expires_at) VALUES (?, ?, ?)');
    stmt.run(code, userId, expiresAt);

    res.json({ code, expiresAt });
  } catch (err) {
    console.error('Generate support code error:', err);
    res.status(500).json({ error: 'Failed to generate support code' });
  }
});

// Verify diagnostic support code and fetch diagnostics (unauthenticated)
app.get('/api/support/verify/:code', async (req, res) => {
  const { code } = req.params;

  try {
    // Find valid/unexpired support code
    const record = db.prepare('SELECT * FROM support_codes WHERE code = ?').get(code);
    if (!record) {
      return res.status(404).json({ error: 'Invalid support code.' });
    }

    if (Date.now() > record.expires_at) {
      // Clean up expired code
      db.prepare('DELETE FROM support_codes WHERE code = ?').run(code);
      return res.status(410).json({ error: 'Support code has expired.' });
    }

    const userId = record.user_id;

    // Fetch user profile info
    const user = db.prepare('SELECT id, username, role, company_name, email, phone, plan_id, subscription_status FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User associated with support code not found.' });
    }

    // Fetch vehicles
    const vehicles = db.prepare('SELECT * FROM vehicles WHERE owner_id = ?').all(userId);

    // Fetch details & history for each vehicle
    const vehicleDiagnostics = vehicles.map(vehicle => {
      // Get last 15 telemetry logs for support investigation
      const history = db.prepare('SELECT timestamp, speed, battery_level, fuel_level, lat, lng FROM vehicle_history WHERE vehicle_id = ? ORDER BY timestamp DESC LIMIT 15').all(vehicle.id);
      
      // Get geofences
      const geofences = db.prepare('SELECT id, lat, lng, radius FROM geofences WHERE vehicle_id = ?').all(vehicle.id);

      // Get active maintenance reminders
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


// Geofence Routes
app.get('/api/geofences', (req, res) => {
  const { vehicleId } = req.query;
  const userId = getRequestUserId(req);
  try {
    const user = db.prepare('SELECT subscription_status, role FROM users WHERE id = ?').get(userId);
    if (user && user.subscription_status === 'SUSPENDED' && user.role !== 'admin') {
      return res.json([]);
    }

    // Verify ownership of the vehicle
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

app.post('/api/geofences', (req, res) => {
  const { vehicleId, lat, lng, radius, type, coordinates } = req.body;
  const userId = getRequestUserId(req);
  try {
    // Verify ownership of the vehicle
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

app.put('/api/geofences/:id', (req, res) => {
  const { lat, lng, radius, type, coordinates } = req.body;
  const userId = getRequestUserId(req);
  try {
    // Verify ownership of the geofence
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

app.delete('/api/geofences/:id', (req, res) => {
  const userId = getRequestUserId(req);
  try {
    // Verify ownership of the geofence
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

// --- PAYSTACK ENTERPRISE BILLING ENGINE ---
const crypto = require('crypto');
const https = require('https');

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || 'sk_test_mock_paystack_secret_key_123456';
const PLAN_PRICE_MONTHLY = 3000; // ₦3,000 per vehicle per month
const PLAN_PRICE_ANNUAL = 30000; // ₦30,000 per vehicle per year (save 16%)
const PLAN_PRICE_PER_VEHICLE = PLAN_PRICE_MONTHLY;

// Built-in HTTPS utility to avoid external 'axios' dependencies
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

// 1. Initialize Bulk Subscription Transaction
app.post('/api/payments/initialize-bulk', async (req, res) => {
  const userId = req.user.id; // SECURE: Use token user ID, not request body
  const { vehicleIds, billingCycle } = req.body;
  if (!vehicleIds || !Array.isArray(vehicleIds) || vehicleIds.length === 0) {
    return res.status(400).json({ error: 'An array of Vehicle IDs is required.' });
  }

  const cycle = billingCycle === 'annual' ? 'annual' : 'monthly';
  const price = cycle === 'annual' ? PLAN_PRICE_ANNUAL : PLAN_PRICE_MONTHLY;

  try {
    // Verify all vehicleIds are owned by the user
    const placeholders = vehicleIds.map(() => '?').join(',');
    const count = db.prepare(`SELECT COUNT(*) as count FROM vehicles WHERE owner_id = ? AND id IN (${placeholders})`).get(userId, ...vehicleIds);
    if (count.count !== vehicleIds.length) {
      return res.status(403).json({ error: 'One or more vehicle IDs are invalid or not owned by you.' });
    }

    // Get user details
    const user = db.prepare('SELECT username, email FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const email = user.email || `${user.username}@safebox-fleet.com`;
    const totalAmountKobo = vehicleIds.length * price * 100; // Paystack expects amount in Kobo

    // If sandbox / mockup key, simulate initial checkout URL directly
    if (PAYSTACK_SECRET.startsWith('sk_test_mock_')) {
      const mockReference = `ref_mock_${Date.now()}`;
      return res.json({
        authorization_url: `http://localhost:5173/?mock_checkout=true&ref=${mockReference}&userId=${userId}&vehicles=${vehicleIds.join(',')}&cycle=${cycle}`,
        reference: mockReference
      });
    }

    // Call Paystack Transaction Initialize
    const referer = req.headers.referer || 'http://localhost:5173/';
    const callback_url = referer.split('?')[0]; // Strip off existing query parameters

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

// 2. Verify Transaction & Credit Selected Vehicles
app.get('/api/payments/verify/:reference', async (req, res) => {
  const { reference } = req.params;
  const tokenUserId = req.user.id; // SECURE: Use token user ID to prevent fraud

  try {
    let userId, vehicleIds, cycle;

    // Support simulated sandbox verification
    const isMockKey = PAYSTACK_SECRET.startsWith('sk_test_mock_');
    if (reference.startsWith('ref_mock_') || isMockKey) {
      // In sandbox mode, we parse mock references
      const mockQuery = req.query;
      userId = tokenUserId;
      if (mockQuery.vehicles) {
        vehicleIds = mockQuery.vehicles.split(',');
      } else {
        // Fallback: get all vehicles owned by this user
        const userVehicles = db.prepare('SELECT id FROM vehicles WHERE owner_id = ?').all(userId);
        vehicleIds = userVehicles.map(v => v.id);
      }
      cycle = mockQuery.cycle === 'annual' ? 'annual' : 'monthly';

      if (vehicleIds.length === 0) {
        return res.status(400).json({ error: 'No vehicles selected for renewal' });
      }

      // Verify all vehicleIds are owned by the user
      const placeholders = vehicleIds.map(() => '?').join(',');
      const count = db.prepare(`SELECT COUNT(*) as count FROM vehicles WHERE owner_id = ? AND id IN (${placeholders})`).get(userId, ...vehicleIds);
      if (count.count !== vehicleIds.length) {
        return res.status(403).json({ error: 'One or more vehicle IDs are invalid or not owned by you.' });
      }
    } else {
      // Verify via Paystack API (Server-to-Server Authentication Handoff)
      try {
        const response = await paystackRequest('GET', `/transaction/verify/${reference}`);

        const data = response.data.data;
        if (data.status !== 'success') {
          return res.status(400).json({ error: 'Payment was not successful' });
        }

        userId = data.metadata.userId;
        vehicleIds = data.metadata.vehicleIds;
        cycle = data.metadata.billingCycle === 'annual' ? 'annual' : 'monthly';

        // Verify the payment owner matches the logged in user
        if (Number(userId) !== Number(tokenUserId)) {
          return res.status(403).json({ error: 'Payment user mismatch' });
        }
      } catch (paystackErr) {
        // FALLBACK FOR DEVELOPMENT / TEST ENVIRONMENT
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

    // Process SQL updates inside a transaction
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

    // Broadcast update via Socket.io
    io.to(`user_${userId}`).emit('billing-updated', { userId, status: 'ACTIVE', vehicleIds });

    res.json({ success: true, vehicleIds });
  } catch (err) {
    console.error('Paystack verification failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to verify transaction' });
  }
});

// 3. Paystack Webhook Handler
app.post('/api/payments/webhook', (req, res) => {
  // Verify signature
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

        io.to(`user_${userId}`).emit('billing-updated', { userId, status: 'ACTIVE', vehicleIds });
      }
    } 
    else if (event.event === 'invoice.payment_failed' || event.event === 'charge.failed') {
      // Trigger the Grace Period system (5 days to update payment details)
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

        io.to(`user_${userId}`).emit('billing-updated', { userId, status: 'GRACE_PERIOD', vehicleIds, graceExpires: fiveDaysLater });
      }
    }
    else if (event.event === 'subscription.disable') {
      // Immediate cancellation
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

        io.to(`user_${userId}`).emit('billing-updated', { userId, status: 'SUSPENDED', vehicleIds });
      }
    }

    res.status(200).send('Webhook Processed');
  } catch (err) {
    console.error('Webhook processing failed:', err);
    res.status(500).send('Webhook Processing Error');
  }
});

// 4. Webhook Simulator Route (Development Only - Executes logic internally)
app.post('/api/payments/simulate-webhook', (req, res) => {
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

      io.to(`user_${userId}`).emit('billing-updated', { userId, status: 'ACTIVE', vehicleIds });
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

      io.to(`user_${userId}`).emit('billing-updated', { userId, status: 'GRACE_PERIOD', vehicleIds, graceExpires: fiveDaysLater });
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

      io.to(`user_${userId}`).emit('billing-updated', { userId, status: 'SUSPENDED', vehicleIds });
    }

    res.json({ success: true, status: 'Mock event processed internally' });
  } catch (err) {
    console.error('Simulated webhook processing failed:', err);
    res.status(500).json({ error: 'Simulator internal routing failed', message: err.message });
  }
});

// 5. Fetch Payment Status
app.get('/api/payments/status', (req, res) => {
  const userId = getRequestUserId(req);

  try {
    const history = db.prepare('SELECT * FROM payments WHERE user_id = ? ORDER BY timestamp DESC LIMIT 20').all(userId);
    const vehicleBilling = db.prepare('SELECT id, name, plate_number, subscription_status, grace_period_expires, next_billing_date, curfew_enabled, curfew_start, curfew_end, cloud_locked FROM vehicles WHERE owner_id = ?').all(userId);

    res.json({
      pricePerVehicle: PLAN_PRICE_PER_VEHICLE,
      vehicles: vehicleBilling,
      history
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve payment details' });
  }
});

// --- LIVE LOCATION SHARING API ---

// POST /api/vehicles/:id/share - Generate a temporary share link (Auth required)
app.post('/api/vehicles/:id/share', authMiddleware, (req, res) => {
  const userId = getRequestUserId(req);
  const vehicleId = req.params.id;
  const { durationMinutes } = req.body;

  if (!durationMinutes || durationMinutes < 1 || durationMinutes > 1440) {
    return res.status(400).json({ error: 'Duration must be between 1 and 1440 minutes (24 hours).' });
  }

  // Verify the user owns this vehicle
  const vehicle = db.prepare('SELECT id, name, plate_number, driver_name FROM vehicles WHERE id = ? AND owner_id = ?').get(vehicleId, userId);
  if (!vehicle) {
    return res.status(404).json({ error: 'Vehicle not found or you do not own this vehicle.' });
  }

  const token = crypto.randomBytes(16).toString('hex');
  const expiresAt = Date.now() + (durationMinutes * 60 * 1000);

  db.prepare('INSERT INTO shared_tracking_links (token, vehicle_id, created_by, expires_at, active) VALUES (?, ?, ?, ?, 1)')
    .run(token, vehicleId, userId, expiresAt);

  console.log(`🔗 Live share link created for vehicle ${vehicleId} by user ${userId}, expires in ${durationMinutes}m, token: ${token}`);

  res.json({
    token,
    expiresAt,
    durationMinutes,
    vehicleName: vehicle.name,
    plateNumber: vehicle.plate_number
  });
});

// GET /api/shared-track/:token - Public endpoint, no auth required
app.get('/api/shared-track/:token', (req, res) => {
  const { token } = req.params;
  const now = Date.now();

  const link = db.prepare('SELECT * FROM shared_tracking_links WHERE token = ? AND active = 1').get(token);

  if (!link) {
    return res.status(404).json({ error: 'Tracking link not found or has been revoked.' });
  }

  if (link.expires_at <= now) {
    // Mark as inactive
    db.prepare('UPDATE shared_tracking_links SET active = 0 WHERE token = ?').run(token);
    return res.status(410).json({ error: 'This tracking session has expired.', expired: true });
  }

  const vehicle = db.prepare('SELECT id, name, plate_number, driver_name, vehicle_type, lat, lng, battery_level, fuel_level, last_seen FROM vehicles WHERE id = ?').get(link.vehicle_id);

  if (!vehicle) {
    return res.status(404).json({ error: 'Vehicle no longer exists.' });
  }

  res.json({
    vehicleId: vehicle.id,
    name: vehicle.name,
    plateNumber: vehicle.plate_number,
    driverName: vehicle.driver_name,
    vehicleType: vehicle.vehicle_type,
    lat: vehicle.lat,
    lng: vehicle.lng,
    battery: vehicle.battery_level,
    fuel: vehicle.fuel_level,
    lastSeen: vehicle.last_seen,
    expiresAt: link.expires_at
  });
});

// DELETE /api/shared-track/:token - Revoke a share link (Auth required)
app.delete('/api/shared-track/:token', authMiddleware, (req, res) => {
  const userId = getRequestUserId(req);
  const { token } = req.params;

  const link = db.prepare('SELECT * FROM shared_tracking_links WHERE token = ? AND created_by = ?').get(token, userId);
  if (!link) {
    return res.status(404).json({ error: 'Link not found or you did not create it.' });
  }

  db.prepare('UPDATE shared_tracking_links SET active = 0 WHERE token = ?').run(token);
  console.log(`🔗 Share link ${token} revoked by user ${userId}`);
  res.json({ success: true });
});

// --- SHARED TRACKING Socket.io Namespace (Public, no JWT auth) ---
const sharedTrackingNs = io.of('/shared-tracking');
// No JWT auth middleware on this namespace — public access via token validation
sharedTrackingNs.on('connection', (socket) => {
  console.log(`📡 Shared tracking viewer connected: ${socket.id}`);

  socket.on('join-shared-track', (token) => {
    const now = Date.now();
    const link = db.prepare('SELECT vehicle_id FROM shared_tracking_links WHERE token = ? AND active = 1 AND expires_at > ?').get(token, now);
    if (link) {
      socket.join(`shared_track_${token}`);
      socket.sharedToken = token;
      socket.sharedVehicleId = link.vehicle_id;
      console.log(`📡 Viewer ${socket.id} joined shared room for token ${token} (vehicle: ${link.vehicle_id})`);
    } else {
      socket.emit('shared-track-error', { error: 'Link expired or invalid.' });
      console.log(`📡 Viewer ${socket.id} tried invalid/expired token: ${token}`);
    }
  });

  socket.on('disconnect', () => {
    console.log(`📡 Shared tracking viewer disconnected: ${socket.id}`);
  });
});

// Helper: Broadcast to all shared tracking viewers for a given vehicle
function broadcastToSharedTrackers(deviceId, lat, lng, speed, timestamp) {
  try {
    const now = Date.now();
    const activeLinks = db.prepare('SELECT token FROM shared_tracking_links WHERE vehicle_id = ? AND active = 1 AND expires_at > ?').all(deviceId, now);
    activeLinks.forEach(link => {
      sharedTrackingNs.to(`shared_track_${link.token}`).emit('shared-device-data', {
        deviceId,
        lat,
        lng,
        speed,
        timestamp
      });
    });
  } catch (e) {
    // Non-critical — don't crash telemetry pipeline
  }
}

// Socket.io Connection
io.on('connection', (socket) => {
  const userId = socket.user.id;
  console.log(`Web Client Connected: User ${userId}`);

  // Join the user's private room for isolated broadcasts
  socket.join(`user_${userId}`);

  socket.on('disconnect', () => {
    console.log(`Web Client Disconnected: User ${userId}`);
  });

  // Handle commands from frontend
  socket.on('send-command', (data) => {
    // data: { deviceId, command }
    try {
      // Check if user is suspended in the database
      const user = db.prepare('SELECT subscription_status FROM users WHERE id = ?').get(userId);
      if (user && user.subscription_status === 'SUSPENDED') {
        console.warn(`⚠️ Suspended User ${userId} attempted to send command on device ${data.deviceId}. Disconnecting socket.`);
        socket.disconnect(true);
        return;
      }

      // Verify ownership of the vehicle before letting them send commands
      const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(data.deviceId);
      if (!vehicle || vehicle.owner_id !== userId) {
        console.warn(`⚠️ User ${userId} attempted unauthorized command on device ${data.deviceId}`);
        return;
      }

      const topic = `/device/${data.deviceId}/command`;

      // 1. Update DB State
      const cloudLocked = data.command === 'LOCK' ? 1 : 0;
      const stmt = db.prepare('UPDATE vehicles SET cloud_locked = ?' + (data.command === 'LOCK' ? ', is_locked = 1' : '') + ' WHERE id = ?');
      stmt.run(cloudLocked, data.deviceId);

      // 2. Send command to TCP device if active
      if (activeTcpSockets.has(data.deviceId)) {
        activeTcpSockets.get(data.deviceId).write(`$$CMD,${data.deviceId},SET_CLOUDLOCKED,${cloudLocked}\r\n`);
        console.log(`[TCP Command] Dispatched SET_CLOUDLOCKED=${cloudLocked} to device ${data.deviceId}`);
      }

      // 3. Send to MQTT for legacy/simulator devices
      mqttClient.publish(topic, JSON.stringify({ command: data.command }));
      console.log(`Command sent to ${data.deviceId}: ${data.command} by user ${userId}`);
    } catch (e) {
      console.error("DB Update/MQTT Publish failed", e);
    }
  });
});

// --- ANALYTICS API ---

// Helper: Calculate Vehicle Scores from vehicle_alerts (7-day window)
function calculateVehicleScore(vehicle) {
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

  // Query alert counts by type in the last 7 days
  const alerts = db.prepare(`
    SELECT type, COUNT(*) as count FROM vehicle_alerts
    WHERE vehicle_id = ? AND timestamp > ?
    GROUP BY type
  `).all(vehicle.id, sevenDaysAgo);

  const alertMap = {};
  alerts.forEach(a => { alertMap[a.type] = a.count; });

  let safetyScore = 100;

  // Deductions per type
  const speeding = alertMap['SPEEDING'] || 0;
  const harshAccel = alertMap['HARSH_ACCEL'] || 0;
  const harshBrake = alertMap['HARSH_BRAKE'] || 0;
  const startBlocked = alertMap['START_ATTEMPT_BLOCKED'] || 0;
  const curfewViolation = alertMap['CURFEW_VIOLATION'] || 0;
  const geofenceBreach = alertMap['GEOFENCE_BREACH'] || 0;
  const fuelTheft = alertMap['FUEL_THEFT'] || 0;

  safetyScore -= (speeding * 5);        // -5 per speeding event
  safetyScore -= (harshAccel * 10);     // -10 per harsh acceleration
  safetyScore -= (harshBrake * 10);     // -10 per harsh braking
  safetyScore -= (startBlocked * 15);   // -15 per blocked start attempt
  safetyScore -= (curfewViolation * 15);// -15 per curfew violation
  safetyScore -= (geofenceBreach * 10); // -10 per geofence breach
  safetyScore -= (fuelTheft * 15);      // -15 per fuel theft event

  // --- EFFICIENCY SCORING (from vehicle_history, 7-day window) ---
  const history = db.prepare(`
    SELECT speed, fuel_level, battery_level, lat, lng, timestamp
    FROM vehicle_history WHERE vehicle_id = ? AND timestamp > ?
    ORDER BY timestamp ASC
  `).all(vehicle.id, sevenDaysAgo);

  let efficiencyScore = 100;
  let idleRatio = 0;
  let optimalSpeedRatio = 0;
  let fuelPerKm = 0;
  let kmPerLiter = 0;

  if (history.length >= 2) {
    // 1. Idle Time Ratio: entries with speed=0 / total entries
    const totalEntries = history.length;
    const idleEntries = history.filter(h => h.speed === 0).length;
    idleRatio = Math.round((idleEntries / totalEntries) * 100);

    // Penalize if idle ratio > 40% (too much time sitting with engine on)
    if (idleRatio > 60) efficiencyScore -= 25;
    else if (idleRatio > 40) efficiencyScore -= 15;
    else if (idleRatio > 30) efficiencyScore -= 5;

    // 2. Optimal Speed Adherence: % of MOVING entries in 20-80 km/h range
    const movingEntries = history.filter(h => h.speed > 0);
    if (movingEntries.length > 0) {
      const optimalEntries = movingEntries.filter(h => h.speed >= 20 && h.speed <= 80);
      optimalSpeedRatio = Math.round((optimalEntries.length / movingEntries.length) * 100);

      // Penalize if less than 60% of driving time in optimal range
      if (optimalSpeedRatio < 40) efficiencyScore -= 20;
      else if (optimalSpeedRatio < 60) efficiencyScore -= 10;
      else if (optimalSpeedRatio < 75) efficiencyScore -= 5;
    }

    // 3. Fuel Consumption Rate: total fuel consumed / total km driven
    let totalDistanceKm = 0;
    let totalFuelConsumed = 0;

    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1];
      const curr = history[i];

      // Accumulate GPS distance (only when moving)
      if (curr.speed > 0 && prev.lat && prev.lng && curr.lat && curr.lng) {
        totalDistanceKm += getDistanceFromLatLonInKm(prev.lat, prev.lng, curr.lat, curr.lng);
      }

      // Accumulate fuel consumed (only drops, ignore refuels)
      const fuelDiff = prev.fuel_level - curr.fuel_level;
      if (fuelDiff > 0 && fuelDiff < 10) { // Ignore large jumps (refuels)
        totalFuelConsumed += fuelDiff;
      }
    }

    // Calculate km/L (assume 1% fuel level drop consumes 0.1 Liters)
    if (totalDistanceKm > 0.5) { // At least 500m driven
      if (totalFuelConsumed > 0) {
        const litersConsumed = totalFuelConsumed * 0.1;
        kmPerLiter = totalDistanceKm / litersConsumed;
      } else {
        kmPerLiter = 15.0; // Excellent fallback economy
      }

      // Penalize high consumption (km/L — calibrated for sedan simulation)
      if (kmPerLiter < 3.0) efficiencyScore -= 20;
      else if (kmPerLiter < 5.0) efficiencyScore -= 10;
      else if (kmPerLiter < 8.0) efficiencyScore -= 5;
    }
  } else {
    // Not enough data — neutral score
    efficiencyScore = 100;
  }

  // Also penalize critically low current levels
  if (vehicle.fuel_level < 15) efficiencyScore -= 5;
  if (vehicle.battery_level < 15) efficiencyScore -= 5;

  return {
    safety: Math.max(0, Math.min(100, safetyScore)),
    efficiency: Math.max(0, Math.min(100, efficiencyScore)),
    breakdown: {
      speeding,
      harshAccel,
      harshBrake,
      startBlocked,
      curfewViolation,
      geofenceBreach,
      fuelTheft
    },
    efficiencyBreakdown: {
      idleRatio,           // % of time idle (lower is better)
      optimalSpeedRatio,   // % of driving in 20-80 km/h (higher is better)
      kmPerLiter: kmPerLiter > 0 ? (Math.round(kmPerLiter * 10) / 10) : 0, // km/L
      dataPoints: history.length
    }
  };
}

// Get aggregated stats
app.get('/api/analytics/stats', (req, res) => {
  const userId = getRequestUserId(req);
  try {
    let totalVehicles, activeVehicles, criticalAlerts, avgFuel, avgSafety;
    let vehiclesForStats = [];

    // Filter stats by user owned vehicles only for data isolation
    totalVehicles = db.prepare('SELECT COUNT(*) as count FROM vehicles WHERE owner_id = ?').get(userId).count;

    const fiveMinsAgo = Date.now() - 300000;
    activeVehicles = db.prepare('SELECT COUNT(*) as count FROM vehicles WHERE owner_id = ? AND last_seen > ?').get(userId, fiveMinsAgo).count;

    criticalAlerts = db.prepare('SELECT COUNT(*) as count FROM vehicles WHERE owner_id = ? AND (battery_level < 20 OR fuel_level < 15)').get(userId).count;

    avgFuel = db.prepare('SELECT AVG(fuel_level) as avg FROM vehicles WHERE owner_id = ?').get(userId).avg;

    vehiclesForStats = db.prepare('SELECT * FROM vehicles WHERE owner_id = ?').all(userId);

    // Calculate Avg Safety
    let totalSafety = 0;
    if (vehiclesForStats.length > 0) {
      vehiclesForStats.forEach(v => {
        totalSafety += calculateVehicleScore(v).safety;
      });
      avgSafety = Math.round(totalSafety / vehiclesForStats.length);
    } else {
      avgSafety = 100;
    }

    res.json({
      totalVehicles,
      activeVehicles,
      criticalAlerts,
      avgFuel: Math.round(avgFuel || 0),
      avgSafety
    });
  } catch (err) {
    console.error("Analytics Stats Error", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// Leaderboard API
app.get('/api/analytics/leaderboard', (req, res) => {
  const userId = getRequestUserId(req);
  try {
    // Only show vehicles owned by the authenticated user for data isolation
    const vehicles = db.prepare('SELECT * FROM vehicles WHERE owner_id = ?').all(userId);

    const leaderboard = vehicles.map(v => {
      const scores = calculateVehicleScore(v);
      return {
        id: v.id,
        name: v.name,
        driverName: v.driver_name || 'Unassigned',
        safetyScore: scores.safety,
        efficiencyScore: scores.efficiency,
        breakdown: scores.breakdown,
        efficiencyBreakdown: scores.efficiencyBreakdown,
        status: (Date.now() - v.last_seen < 300000) ? 'Online' : 'Offline'
      };
    });

    // Sort by Total Score (Safety + Efficiency) DESC
    leaderboard.sort((a, b) => (b.safetyScore + b.efficiencyScore) - (a.safetyScore + a.efficiencyScore));

    res.json(leaderboard);
  } catch (err) {
    console.error("Leaderboard Error", err);
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
});

// Get history for charts
app.get('/api/analytics/history/:vehicleId', (req, res) => {
  const userId = req.user.id;
  const { vehicleId } = req.params;
  const { range } = req.query; // '24h', '7d'

  // Verify ownership
  const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(vehicleId);
  if (!vehicle) {
    return res.status(404).json({ error: 'Vehicle not found' });
  }
  if (vehicle.owner_id !== userId) {
    return res.status(403).json({ error: 'Unauthorized to access history' });
  }

  let timeLimit = Date.now() - 86400000; // Default 24h
  if (range === '7d') timeLimit = Date.now() - (7 * 86400000);

  try {
    const rows = db.prepare(`
            SELECT timestamp, speed, fuel_level, battery_level 
            FROM vehicle_history 
            WHERE vehicle_id = ? AND timestamp > ? 
            ORDER BY timestamp ASC
        `).all(vehicleId, timeLimit);

    res.json(rows);
  } catch (err) {
    console.error("Analytics History Error", err);
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

// Get route replay points for custom date range
app.get('/api/analytics/route/:vehicleId', (req, res) => {
  const userId = req.user.id;
  const { vehicleId } = req.params;
  const { start, end } = req.query;

  if (!start || !end) {
    return res.status(400).json({ error: 'Start and end timestamps are required' });
  }

  const startTimestamp = parseInt(start);
  const endTimestamp = parseInt(end);

  if (isNaN(startTimestamp) || isNaN(endTimestamp)) {
    return res.status(400).json({ error: 'Invalid start or end timestamp' });
  }

  // Verify ownership
  const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(vehicleId);
  if (!vehicle) {
    return res.status(404).json({ error: 'Vehicle not found' });
  }
  if (vehicle.owner_id !== userId && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized to access history' });
  }

  try {
    const rows = db.prepare(`
      SELECT timestamp, speed, battery_level, fuel_level, lat, lng 
      FROM vehicle_history 
      WHERE vehicle_id = ? AND timestamp >= ? AND timestamp <= ? 
      ORDER BY timestamp ASC
    `).all(vehicleId, startTimestamp, endTimestamp);

    res.json(rows);
  } catch (err) {
    console.error("Fetch route replay error:", err);
    res.status(500).json({ error: "Failed to fetch route replay history" });
  }
});

// Get detailed daily travel history for route tracing
app.get('/api/vehicles/:vehicleId/history', (req, res) => {
  const userId = req.user.id;
  const { vehicleId } = req.params;
  const { date } = req.query; // YYYY-MM-DD

  if (!date) {
    return res.status(400).json({ error: "Date parameter is required (YYYY-MM-DD)" });
  }

  // Verify ownership
  const vehicle = db.prepare('SELECT owner_id FROM vehicles WHERE id = ?').get(vehicleId);
  if (!vehicle) {
    return res.status(404).json({ error: 'Vehicle not found' });
  }
  if (vehicle.owner_id !== userId) {
    return res.status(403).json({ error: 'Unauthorized to access history' });
  }

  try {
    // Create local timestamps for the selected date
    const startOfDay = new Date(`${date}T00:00:00`).getTime();
    const endOfDay = new Date(`${date}T23:59:59.999`).getTime();

    const rows = db.prepare(`
      SELECT timestamp, speed, battery_level, fuel_level, lat, lng 
      FROM vehicle_history 
      WHERE vehicle_id = ? AND timestamp >= ? AND timestamp <= ? 
      ORDER BY timestamp ASC
    `).all(vehicleId, startOfDay, endOfDay);

    res.json(rows);
  } catch (err) {
    console.error("Fetch vehicle history error:", err);
    res.status(500).json({ error: "Failed to fetch vehicle history" });
  }
});

// --- REPORTS & ANALYTICS ROUTES ---
const reportsService = require('./reportsService');
const analyticsService = require('./analyticsService');

// Serve static reports directory
app.use('/reports', express.static(path.join(__dirname, 'public', 'reports')));

// 1. Live Preview Analytics
app.get('/api/reports/analytics', authMiddleware, (req, res) => {
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

// 2. Generate Report Asynchronously
app.post('/api/reports/generate', authMiddleware, async (req, res) => {
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

    // Insert transient report record
    db.prepare(`
      INSERT INTO reports (id, user_id, status, progress, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(reportId, userId, 'PENDING', 0, Date.now());

    // Run in background without blocking response
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

// 3. Check Async Report Status
app.get('/api/reports/status/:id', authMiddleware, (req, res) => {
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

// 4. Retrieve Reports Archive History
app.get('/api/reports/history', authMiddleware, (req, res) => {
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

// 5. Get Report Schedules
app.get('/api/reports/schedules', authMiddleware, (req, res) => {
  const userId = getRequestUserId(req);
  try {
    const schedules = db.prepare('SELECT * FROM report_schedules WHERE user_id = ?').all(userId);
    res.json(schedules);
  } catch (err) {
    console.error('Fetch report schedules failed:', err);
    res.status(500).json({ error: 'Failed to load report schedules' });
  }
});

// 6. Create Report Schedule
app.post('/api/reports/schedules', authMiddleware, (req, res) => {
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

// 7. Delete Report Schedule
app.delete('/api/reports/schedules/:id', authMiddleware, (req, res) => {
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

// 8. Get Fuel & Cost Fleet Settings
app.get('/api/vehicles/fuel-settings', authMiddleware, (req, res) => {
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

// 9. Update Fuel & Cost Setting
app.post('/api/vehicles/fuel-settings', authMiddleware, (req, res) => {
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

    // Run inside transaction for safety
    const runTransaction = db.transaction((ids) => {
      for (const id of ids) {
        // Verify ownership
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

// --- SPA Catch-All Route (must be AFTER all API routes) ---
// In production, serve index.html for any route that isn't an API endpoint
// This enables proper SPA routing and ensures search engine crawlers receive the HTML document
if (process.env.NODE_ENV === 'production') {
  app.get('*splat', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  // Start TCP Telematics Server for COTS Trackers
  tcpServer.listen(TCP_PORT, () => {
    console.log(`🔋 TCP Telematics Ingestion Server running on port ${TCP_PORT}`);
  });

  // 🧹 Daily Cleanup: Prune vehicle_history older than 90 days
  const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
  const RETENTION_DAYS = 90;

  const runHistoryCleanup = () => {
    try {
      const cutoff = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const result = db.prepare('DELETE FROM vehicle_history WHERE timestamp < ?').run(cutoff);
      if (result.changes > 0) {
        console.log(`🧹 Pruned ${result.changes} vehicle_history records older than ${RETENTION_DAYS} days`);
      }
    } catch (err) {
      console.error('History cleanup failed:', err.message);
    }
  };

  // Run once on startup, then every 24 hours
  runHistoryCleanup();
  setInterval(runHistoryCleanup, CLEANUP_INTERVAL);

  // 🕒 Automatic Curfew Transitions & Warnings: Check every 60 seconds
  const checkCurfewTransitions = () => {
    try {
      const now = new Date();
      const nowStr = now.toTimeString().substring(0, 5); // "HH:MM"

      // Fetch all vehicles with curfew enabled
      const vehicles = db.prepare('SELECT id, owner_id, curfew_start, curfew_end, curfew_days, curfew_holiday_mode, cloud_locked FROM vehicles WHERE curfew_enabled = 1').all();

      vehicles.forEach(vehicle => {
        const isAllowed = isWithinAllowedHours(now, vehicle.curfew_start, vehicle.curfew_end, vehicle.curfew_days, vehicle.curfew_holiday_mode);

        // Check if operating window is ending in 30 minutes
        if (isAllowed && vehicle.curfew_end) {
          const [endH, endM] = vehicle.curfew_end.split(':').map(Number);
          const endMinutes = endH * 60 + endM;
          
          const currentMinutes = now.getHours() * 60 + now.getMinutes();
          if (endMinutes - currentMinutes === 30) {
            // Trigger 30 minute warning!
            const alertMsg = `Operating Window Warning: Vehicle ${vehicle.id} operating hours will end in 30 minutes!`;
            console.log(`[Curfew Warning] Emitting 30-min warning for ${vehicle.id}`);
            io.to(`user_${vehicle.owner_id}`).emit('notification', {
              id: Date.now() + Math.random(),
              type: 'CURFEW_WARNING',
              severity: 'warning',
              message: alertMsg,
              timestamp: Date.now(),
              is_read: false
            });
          }
        }

        // If curfew end is reached exactly, lock if stopped
        if (nowStr === vehicle.curfew_end) {
          // Transition to curfew: BLOCK_START
          console.log(`[Curfew Scheduler] Curfew end reached. Sending BLOCK_START to ${vehicle.id}`);
          mqttClient.publish(`/device/${vehicle.id}/command`, JSON.stringify({ command: 'BLOCK_START' }));
        } else if (nowStr === vehicle.curfew_start) {
          // Transition out of curfew: ALLOW_START
          console.log(`[Curfew Scheduler] Curfew start reached. Sending ALLOW_START to ${vehicle.id}`);
          db.prepare('UPDATE vehicles SET cloud_locked = 0, is_locked = 0, override_status = "NONE", override_expires = 0 WHERE id = ?').run(vehicle.id);
          mqttClient.publish(`/device/${vehicle.id}/command`, JSON.stringify({ command: 'ALLOW_START' }));
          mqttClient.publish(`/device/${vehicle.id}/command`, JSON.stringify({ command: 'UNLOCK' }));

          // Broadcast to frontend
          io.to(`user_${vehicle.owner_id}`).emit('device-data', {
            topic: `/device/${vehicle.id}/status`,
            payload: {
              deviceId: vehicle.id,
              locked: false,
              timestamp: Date.now()
            }
          });
        }
      });
    } catch (err) {
      console.error('Curfew transition check failed:', err.message);
    }
  };

  setInterval(checkCurfewTransitions, 60000);

  // 🕒 Scheduled Report Deliveries checking loop: check every 60 seconds
  const runScheduledReportsCheck = async () => {
    try {
      const now = new Date();
      const currentHM = now.toTimeString().substring(0, 5); // "HH:MM"
      
      const schedules = db.prepare('SELECT * FROM report_schedules').all();
      
      for (const s of schedules) {
        if (s.time_of_delivery !== currentHM) continue;

        // Check if schedule already ran today to avoid double triggers in the same minute
        if (s.last_run_at) {
          const lastRunDate = new Date(s.last_run_at).toLocaleDateString();
          if (lastRunDate === now.toLocaleDateString()) continue;
        }

        // Evaluate frequency rules
        let shouldRun = false;
        let rangeStr = 'Last 7 Days';
        
        if (s.frequency === 'daily') {
          shouldRun = true;
          rangeStr = 'Yesterday';
        } else if (s.frequency === 'weekly') {
          const daysSinceLast = s.last_run_at ? (Date.now() - s.last_run_at) / (24 * 60 * 60 * 1000) : 999;
          if (daysSinceLast >= 6.5) {
            shouldRun = true;
            rangeStr = 'Last 7 Days';
          }
        } else if (s.frequency === 'biweekly') {
          const daysSinceLast = s.last_run_at ? (Date.now() - s.last_run_at) / (24 * 60 * 60 * 1000) : 999;
          if (daysSinceLast >= 13.5) {
            shouldRun = true;
            rangeStr = 'Last 14 Days';
          }
        } else if (s.frequency === 'monthly') {
          const daysSinceLast = s.last_run_at ? (Date.now() - s.last_run_at) / (24 * 60 * 60 * 1000) : 999;
          if (daysSinceLast >= 27) {
            shouldRun = true;
            rangeStr = 'Last 30 Days';
          }
        }

        if (shouldRun) {
          console.log(`[Scheduler] Compiling scheduled ${s.frequency} report (Type: ${s.report_type}) for user ${s.user_id}`);
          
          const user = db.prepare('SELECT username, email FROM users WHERE id = ?').get(s.user_id);
          if (!user) continue;

          const owned = db.prepare('SELECT id FROM vehicles WHERE owner_id = ?').all(s.user_id);
          const vehicleIds = owned.map(o => o.id);
          if (vehicleIds.length === 0) continue;

          const { startTime, endTime } = reportsService.getDateRange(rangeStr);

          // Mark last run timestamp before generating to avoid race conditions
          db.prepare('UPDATE report_schedules SET last_run_at = ? WHERE id = ?').run(Date.now(), s.id);

          try {
            const dateRangeText = rangeStr === 'Yesterday' ? 'Yesterday' : rangeStr;
            const result = await reportsService.generatePDFReport(
              'sched_' + Date.now(),
              s.report_type,
              vehicleIds,
              [],
              startTime,
              endTime,
              user.username,
              dateRangeText
            );

            // Save to report_history
            db.prepare(`
              INSERT INTO report_history (generated_by, generated_at, report_type, file_path, name, period)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(s.user_id, Date.now(), s.report_type, result.relativePath, result.reportName, dateRangeText);

            // Send notification
            io.to(`user_${s.user_id}`).emit('notification', {
              id: Date.now() + Math.random(),
              type: 'REPORT_GENERATED',
              severity: 'info',
              message: `Your scheduled ${s.frequency} ${s.report_type} is ready for download.`,
              timestamp: Date.now(),
              is_read: false
            });

            // Dispatch Email
            if (s.delivery_method && s.delivery_method.includes('email')) {
              const recipientsList = s.recipients ? s.recipients.split(',').map(email => email.trim()) : [user.email];
              const subject = `Scheduled SafeBox Report: ${s.report_type} (${s.frequency.toUpperCase()})`;
              const text = `Hello,\n\nPlease find attached your scheduled ${s.frequency} SafeBox Fleet Report for ${dateRangeText}.\n\nSafeBox Fleet Team`;
              const html = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                  <h2>Scheduled SafeBox Fleet Report</h2>
                  <p>Hello,</p>
                  <p>Your scheduled <strong>${s.frequency}</strong> report (<strong>${s.report_type}</strong>) has been generated successfully.</p>
                  <p><strong>Report Period:</strong> ${dateRangeText}</p>
                  <p>Please find the compiled PDF document attached to this email.</p>
                  <hr style="border:0; border-top:1px solid #e2e8f0; margin:20px 0;" />
                  <p style="font-size:0.8rem; color:#64748b;">This is an automated delivery. You can manage your schedules directly inside the Reports module of your Safebox Dashboard.</p>
                </div>
              `;

              let emailSent = false;

              // 1. Try Resend API
              if (process.env.RESEND_API_KEY) {
                try {
                  console.log(`✉️ [Scheduler] Attempting to send report email via Resend...`);
                  const fromEmail = process.env.RESEND_FROM_EMAIL || 'SafeBox Fleet Intelligence <onboarding@resend.dev>';
                  
                  const fs = require('fs');
                  const fileContent = fs.readFileSync(result.filePath);
                  const base64Content = fileContent.toString('base64');

                  const controller = new AbortController();
                  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 seconds for attachment

                  const response = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                      from: fromEmail,
                      to: recipientsList,
                      subject: subject,
                      html: html,
                      attachments: [
                        {
                          content: base64Content,
                          filename: result.reportName
                        }
                      ]
                    }),
                    signal: controller.signal
                  });
                  clearTimeout(timeoutId);

                  if (response.ok) {
                    console.log(`✉️ [Scheduler] Dispatched email report ${result.reportName} via Resend to ${recipientsList.join(', ')}`);
                    emailSent = true;
                  } else {
                    const errText = await response.text();
                    console.error(`❌ [Scheduler] Resend API failed (${response.status}):`, errText);
                  }
                } catch (err) {
                  console.error('❌ [Scheduler] Resend API exception:', err.message);
                }
              }

              // 2. Try SMTP Nodemailer
              if (!emailSent) {
                const smtpHost = process.env.SMTP_HOST;
                const smtpPort = process.env.SMTP_PORT || 587;
                const smtpUser = process.env.SMTP_USER;
                const smtpPass = process.env.SMTP_PASS;

                if (smtpHost && smtpUser && smtpPass) {
                  try {
                    const transporter = nodemailer.createTransport({
                      host: smtpHost,
                      port: parseInt(smtpPort),
                      secure: parseInt(smtpPort) === 465,
                      auth: { user: smtpUser, pass: smtpPass },
                      connectionTimeout: 3000,
                      greetingTimeout: 3000,
                      socketTimeout: 3000
                    });
                    await transporter.sendMail({
                      from: `"SafeBox Fleet Intelligence" <${smtpUser}>`,
                      to: recipientsList.join(', '),
                      subject,
                      text,
                      html,
                      attachments: [
                        {
                          filename: result.reportName,
                          path: result.filePath
                        }
                      ]
                    });
                    console.log(`✉️ [Scheduler] Dispatched email report ${result.reportName} via SMTP to ${recipientsList.join(', ')}`);
                    emailSent = true;
                  } catch (smtpErr) {
                    console.error('❌ [Scheduler] SMTP failed:', smtpErr.message);
                  }
                }
              }

              // 3. Fallback Mock Log
              if (!emailSent) {
                console.log(`[SMTP MOCK] Dispatched email report ${result.reportName} to ${recipientsList.join(', ')}`);
              }
            }

          } catch (err) {
            console.error(`Scheduled report execution failed for schedule ${s.id}:`, err);
          }
        }
      }
    } catch (err) {
      console.error('Scheduled reports check failed:', err);
    }
  };

  setInterval(runScheduledReportsCheck, 60000);
});

// Helper: Haversine Distance
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  var R = 6371; // Radius of the earth in km
  var dLat = deg2rad(lat2 - lat1);
  var dLon = deg2rad(lon2 - lon1);
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
    ;
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  var d = R * c; // Distance in km
  return d;
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

// Helper: Ray-Casting Point-in-Polygon algorithm for polygon geofences
function isPointInPolygon(point, polygon) {
  let x = point.lat, y = point.lng;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    let xi = polygon[i].lat, yi = polygon[i].lng;
    let xj = polygon[j].lat, yj = polygon[j].lng;
    let intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Global fuel level tracking for dynamic fuel theft detection
if (!global.fuelTracker) global.fuelTracker = new Map();
