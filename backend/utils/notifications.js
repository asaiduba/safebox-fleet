const webpush = require('web-push');
const nodemailer = require('nodemailer');
const { db } = require('../db');

// --- Real-time SMS & Web Push Notifications Utility ---

// 1. Configure Web Push VAPID Keys
let vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
let vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:support@safebox-fleet.com';

if (!vapidPublicKey || !vapidPrivateKey) {
  console.log('🔑 No VAPID keys provided. Generating transient keys for this session...');
  const keys = webpush.generateVAPIDKeys();
  vapidPublicKey = keys.publicKey;
  vapidPrivateKey = keys.privateKey;
  console.log(`👉 VAPID PUBLIC KEY (configure in frontend): ${vapidPublicKey}`);
}

webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

/**
 * Send an email alert
 */
async function sendEmailAlert(email, subject, text) {
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; background: #0f172a; color: white;">
      <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #ef4444; margin-top: 10px;">🚨 SafeBox Telematics Alert</h2>
      </div>
      <p>Hello,</p>
      <p style="font-size: 1.1rem; line-height: 1.5; color: #f8fafc;">${text}</p>
      <hr style="border: 0; border-top: 1px solid #334155; margin: 30px 0;" />
      <p style="font-size: 0.75rem; color: #64748b; text-align: center;">SafeBox Fleet — Real-Time Fleet Security Engine</p>
    </div>
  `;

  // 1. Try Resend HTTP API (Primary)
  if (process.env.RESEND_API_KEY) {
    try {
      const fromEmail = process.env.RESEND_FROM_EMAIL || 'SafeBox Fleet <alerts@resend.dev>';
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

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
        console.log(`✉️ Email alert sent via Resend to: ${email}`);
        return;
      }
    } catch (err) {
      console.error('❌ Resend API exception for alert email:', err.message);
    }
  }

  // 2. Try SMTP Nodemailer (Secondary)
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (smtpHost && smtpUser && smtpPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(smtpPort) || 587,
        secure: parseInt(smtpPort) === 465,
        auth: { user: smtpUser, pass: smtpPass },
        connectionTimeout: 3000
      });

      await transporter.sendMail({
        from: `"SafeBox Fleet Alert" <${smtpUser}>`,
        to: email,
        subject,
        text,
        html: htmlContent
      });
      console.log(`✉️ Email alert sent via SMTP to: ${email}`);
      return;
    } catch (smtpErr) {
      console.error('❌ SMTP dispatch failed for alert email:', smtpErr.message);
    }
  }

  console.log(`✉️ [MOCK EMAIL ALERT] Sent to ${email} - Subject: ${subject}`);
}

/**
 * Send an SMS alert using Termii or Twilio
 */
async function sendSMSAlert(phone, message) {
  const termiiApiKey = process.env.TERMII_API_KEY;
  const termiiSenderId = process.env.TERMII_SENDER_ID || 'SafeBox';
  const termiiUrl = process.env.TERMII_API_URL || 'https://api.ng.termii.com';

  // 1. Try Termii API (Primary local choice for Nigeria/West Africa)
  if (termiiApiKey) {
    try {
      console.log(`📱 Attempting to send Termii SMS to ${phone}...`);
      const response = await fetch(`${termiiUrl}/api/sms/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: phone,
          from: termiiSenderId,
          sms: message,
          type: 'plain',
          channel: 'generic',
          api_key: termiiApiKey
        })
      });
      if (response.ok) {
        console.log(`📱 SMS sent successfully via Termii to: ${phone}`);
        return;
      } else {
        const errText = await response.text();
        console.error(`❌ Termii API error:`, errText);
      }
    } catch (err) {
      console.error('❌ Termii SMS exception:', err.message);
    }
  }

  // 2. Try Twilio API (Fallback global choice)
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioPhone = process.env.TWILIO_PHONE_NUMBER;

  if (twilioSid && twilioAuthToken && twilioPhone) {
    try {
      console.log(`📱 Attempting to send Twilio SMS to ${phone}...`);
      const basicAuth = Buffer.from(`${twilioSid}:${twilioAuthToken}`).toString('base64');
      const params = new URLSearchParams();
      params.append('To', phone);
      params.append('From', twilioPhone);
      params.append('Body', message);

      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      });

      if (response.ok) {
        console.log(`📱 SMS sent successfully via Twilio to: ${phone}`);
        return;
      } else {
        const errText = await response.text();
        console.error(`❌ Twilio API error:`, errText);
      }
    } catch (err) {
      console.error('❌ Twilio SMS exception:', err.message);
    }
  }

  console.log(`📱 [MOCK SMS ALERT] Sent to ${phone} - Message: "${message}"`);
}

/**
 * Send browser Web Push notification to all active user subscriptions
 */
async function sendWebPushAlert(userId, title, body) {
  try {
    const subscriptions = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
    if (subscriptions.length === 0) return;

    console.log(`🔔 Sending Web Push alert to ${subscriptions.length} browser clients for user ${userId}`);

    const payload = JSON.stringify({
      title,
      body,
      icon: '/logo.png',
      badge: '/badge.png',
      url: '/'
    });

    const promises = subscriptions.map(sub => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth
        }
      };

      return webpush.sendNotification(pushSubscription, payload)
        .catch(err => {
          // If subscription is expired or inactive, prune it from database
          if (err.statusCode === 404 || err.statusCode === 410) {
            console.log(`🧹 Pruning expired browser push subscription: ${sub.endpoint}`);
            db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
          } else {
            console.error('❌ Web Push dispatch failed:', err.message);
          }
        });
    });

    await Promise.all(promises);
  } catch (err) {
    console.error('❌ Web Push notification task failed:', err.message);
  }
}

/**
 * Unified Notification Dispatcher
 */
async function dispatchAlertNotification(vehicleId, alertType, alertMessage) {
  try {
    const vehicle = db.prepare('SELECT name, owner_id FROM vehicles WHERE id = ?').get(vehicleId);
    if (!vehicle) return;

    const owner = db.prepare('SELECT username, email, phone, notify_email, notify_sms, notify_push, alert_email, alert_phone FROM users WHERE id = ?').get(vehicle.owner_id);
    if (!owner) return;

    const vehicleName = vehicle.name;
    const title = `SafeBox Alert: ${alertType}`;
    const body = `Vehicle "${vehicleName}": ${alertMessage}`;

    const recipientEmail = owner.alert_email || owner.email;
    const recipientPhone = owner.alert_phone || owner.phone;

    console.log(`📢 Dispatching Alert [${alertType}] for ${vehicleName} (Owner: ${owner.username})`);

    // 1. Dispatch Email
    if (owner.notify_email !== 0 && recipientEmail) {
      sendEmailAlert(recipientEmail, title, body).catch(e => console.error('Email notify error:', e.message));
    }

    // 2. Dispatch SMS
    if (owner.notify_sms !== 0 && recipientPhone) {
      sendSMSAlert(recipientPhone, body).catch(e => console.error('SMS notify error:', e.message));
    }

    // 3. Dispatch Web Push
    if (owner.notify_push !== 0) {
      sendWebPushAlert(owner.id, title, body).catch(e => console.error('Web Push notify error:', e.message));
    }
  } catch (err) {
    console.error('❌ Unified notification dispatch failed:', err.message);
  }
}

/**
 * Save alert to database and trigger notification dispatch to active channels
 */
function saveAndNotifyAlert(vehicleId, type, message, timestamp = Date.now()) {
  try {
    db.prepare(`
      INSERT INTO vehicle_alerts (vehicle_id, type, message, timestamp, status)
      VALUES (?, ?, ?, ?, 'UNREAD')
    `).run(vehicleId, type, message, timestamp);
    console.log(`💾 Saved [${type}] alert to database for ${vehicleId}`);
  } catch (err) {
    console.error('❌ Failed to save alert to DB:', err.message);
  }
  dispatchAlertNotification(vehicleId, type, message);
}

module.exports = {
  dispatchAlertNotification,
  saveAndNotifyAlert,
  sendEmailAlert,
  sendSMSAlert,
  sendWebPushAlert,
  vapidPublicKey
};
