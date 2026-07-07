const nodemailer = require('nodemailer');

function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in km
  return d;
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

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
          <td style="padding: 8px; font-weight: bold; width: 40%;">Current Odometer:</td>
          <td style="padding: 8px;">${Math.round(odometer)} km</td>
        </tr>
        <tr style="border-bottom: 1px solid #334155;">
          <td style="padding: 8px; font-weight: bold;">Service Threshold:</td>
          <td style="padding: 8px;">${Math.round(limit)} km</td>
        </tr>
        <tr style="border-bottom: 1px solid #334155;">
          <td style="padding: 8px; font-weight: bold;">Notes:</td>
          <td style="padding: 8px;">${reminder.notes || 'None'}</td>
        </tr>
      </table>
      
      <p>Please schedule a service soon to keep your vehicle running safely.</p>
      <hr style="border: 0; border-top: 1px solid #334155; margin: 30px 0;" />
      <p style="font-size: 0.75rem; color: #64748b; text-align: center;">SafeBox Fleet — Automated Fleet Intelligence</p>
    </div>
  `;

  if (process.env.RESEND_API_KEY) {
    try {
      const fromEmail = process.env.RESEND_FROM_EMAIL || 'SafeBox Fleet <onboarding@resend.dev>';
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
        })
      });
      if (response.ok) {
        console.log(`✉️ Maintenance email sent via Resend to: ${email}`);
        return;
      }
    } catch (e) {
      console.error('Failed to send maintenance email via Resend API:', e.message);
    }
  }

  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (smtpHost && smtpUser && smtpPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: parseInt(process.env.SMTP_PORT) === 465,
        auth: { user: smtpUser, pass: smtpPass }
      });
      await transporter.sendMail({
        from: `"SafeBox Fleet Support" <${smtpUser}>`,
        to: email,
        subject,
        text,
        html
      });
      console.log(`✉️ Maintenance email sent via SMTP to: ${email}`);
      return;
    } catch (e) {
      console.error('Failed to send maintenance email via SMTP:', e.message);
    }
  }

  console.log(`✉️ [MOCK MAINTENANCE EMAIL] Sent to ${email} for vehicle ${vehicleName}`);
}

module.exports = {
  getDistanceFromLatLonInKm,
  isPointInPolygon,
  isWithinAllowedHours,
  sendVerificationEmail,
  sendMaintenanceEmail
};
