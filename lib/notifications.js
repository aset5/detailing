const nodemailer = require('nodemailer');
let sendgrid = null;
try { sendgrid = require('@sendgrid/mail'); } catch (e) { /* optional */ }

const APP_URL = process.env.BASE_URL || 'http://localhost:3000';

let transporter = null;

function getEmailFrom() {
  if (process.env.SMTP_FROM) return process.env.SMTP_FROM;
  if (process.env.SMTP_USER) return `"Glow on the Go" <${process.env.SMTP_USER}>`;
  return '"Glow on the Go" <noreply@glowonthego.com>';
}

function formatDisplayDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

function formatDisplayTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
  return transporter;
}

function getBookingLinks(booking) {
  const token = require('crypto')
    .createHmac('sha256', process.env.BOOKING_LINK_SECRET || 'glow-on-the-go-booking-link-secret')
    .update(`${booking.id}:${booking.updated_at || booking.created_at}`)
    .digest('hex');

  return {
    cancel: `${APP_URL}/booking/cancel-form/${booking.id}?token=${encodeURIComponent(token)}`,
    reschedule: `${APP_URL}/booking/reschedule-form/${booking.id}?token=${encodeURIComponent(token)}`
  };
}

function formatBookingDetails(booking, { updated = false } = {}) {
  const addons = JSON.parse(booking.addons || '[]');
  const addonText = addons.length ? addons.join(', ') : 'None';
  const links = getBookingLinks(booking);
  const intro = updated
    ? 'Your appointment has been updated. Here are your new booking details:'
    : 'Your appointment has been successfully created! We will contact you shortly to confirm.';

  return `Booking Confirmation — Glow on the Go

Hello ${booking.name},

${intro}

Details:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Date: ${formatDisplayDate(booking.booking_date)}
Time: ${formatDisplayTime(booking.booking_time)}
Service: ${booking.service_name}
Vehicle: ${booking.vehicle_type}
Address: ${booking.address}
Add-ons: ${addonText}
${booking.comment ? `Comment: ${booking.comment}
` : ''}
Estimated Total: $${booking.total_price}
Booking #${booking.id}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Change date & time:
${links.reschedule}

Cancel booking:
${links.cancel}

Thank you for choosing Glow on the Go!
Pittsburgh's Premium Mobile Detailing

Phone: +878 787 1235`.trim();
}

function formatBookingHtml(booking, { updated = false } = {}) {
  const addons = JSON.parse(booking.addons || '[]');
  const addonText = addons.length ? addons.join(', ') : 'None';
  const links = getBookingLinks(booking);
  const intro = updated
    ? 'Your appointment has been updated. Here are your new booking details:'
    : 'Your appointment has been successfully created! We will contact you shortly to confirm.';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:#111;color:#fff;padding:28px 32px;">
          <div style="font-size:13px;letter-spacing:1px;text-transform:uppercase;opacity:0.8;">Glow on the Go</div>
          <h1 style="margin:8px 0 0;font-size:24px;font-weight:700;">Booking Confirmation</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 16px;font-size:16px;">Hello ${booking.name},</p>
          <p style="margin:0 0 24px;color:#444;">${intro}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fafafa;border:1px solid #eee;border-radius:8px;margin-bottom:28px;">
            <tr><td style="padding:20px 24px;">
              <p style="margin:0 0 10px;"><strong>Date:</strong> ${formatDisplayDate(booking.booking_date)}</p>
              <p style="margin:0 0 10px;"><strong>Time:</strong> ${formatDisplayTime(booking.booking_time)}</p>
              <p style="margin:0 0 10px;"><strong>Service:</strong> ${booking.service_name}</p>
              <p style="margin:0 0 10px;"><strong>Vehicle:</strong> ${booking.vehicle_type}</p>
              <p style="margin:0 0 10px;"><strong>Address:</strong> ${booking.address}</p>
              <p style="margin:0 0 10px;"><strong>Add-ons:</strong> ${addonText}</p>
              ${booking.comment ? `<p style="margin:0 0 10px;"><strong>Comment:</strong> ${booking.comment}</p>` : ''}
              <p style="margin:0 0 10px;"><strong>Total:</strong> $${booking.total_price}</p>
              <p style="margin:0;"><strong>Booking #:</strong> ${booking.id}</p>
            </td></tr>
          </table>
          <p style="margin:0 0 16px;font-weight:600;">Need to make changes?</p>
          <table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom:28px;">
            <tr>
              <td style="padding-right:12px;">
                <a href="${links.reschedule}" style="display:inline-block;padding:14px 24px;background:#111;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">Change date &amp; time</a>
              </td>
              <td>
                <a href="${links.cancel}" style="display:inline-block;padding:14px 24px;background:#e53e3e;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">Cancel booking</a>
              </td>
            </tr>
          </table>
          <p style="margin:0;color:#666;font-size:14px;">Thank you for choosing Glow on the Go!<br>Pittsburgh's Premium Mobile Detailing<br>Phone: +878 787 1235</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendEmailConfirmation(booking, { updated = false } = {}) {
  if (!booking.email) return { sent: false, reason: 'no_email' };

  const subject = updated
    ? 'Booking Updated — Glow on the Go'
    : 'Booking Confirmation — Glow on the Go';
  const text = formatBookingDetails(booking, { updated });
  const html = formatBookingHtml(booking, { updated });
  const from = getEmailFrom();

  if (process.env.SENDGRID_API_KEY && sendgrid) {
    try {
      sendgrid.setApiKey(process.env.SENDGRID_API_KEY);
      const msg = { to: booking.email, from, subject, text, html };
      const res = await sendgrid.send(msg);
      console.log('[Email] Sent via SendGrid to', booking.email);
      return { sent: true, provider: 'sendgrid', result: res[0] };
    } catch (err) {
      console.error('[SendGrid] Failed to send:', err.message || err);
    }
  }

  const transport = getTransporter();
  if (!transport) {
    console.log('[Email] SMTP not configured — skipping email to', booking.email);
    return { sent: false, reason: 'not_configured' };
  }

  try {
    const maxAttempts = 3;
    let attempt = 0;
    let lastErr = null;
    while (attempt < maxAttempts) {
      try {
        await transport.sendMail({ from, to: booking.email, subject, text, html });
        console.log('[Email] Sent via SMTP to', booking.email);
        return { sent: true, attempts: attempt + 1 };
      } catch (err) {
        lastErr = err;
        attempt += 1;
        console.error(`[Email] send attempt ${attempt} failed:`, err.message);
        await new Promise(r => setTimeout(r, 500 * attempt));
      }
    }
    return { sent: false, reason: lastErr ? lastErr.message : 'unknown' };
  } catch (err) {
    console.error('[Email] Failed to send:', err.message);
    return { sent: false, reason: err.message };
  }
}

async function sendSmsConfirmation(booking) {
  if (!booking.phone) return { sent: false, reason: 'no_phone' };

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.log('[SMS] Twilio not configured — skipping SMS to', booking.phone);
    return { sent: false, reason: 'not_configured' };
  }

  try {
    const twilio = require('twilio')(accountSid, authToken);
    await twilio.messages.create({
      body: 'Your appointment with Glow on the Go has been successfully created! We will contact you shortly to confirm.',
      from: fromNumber,
      to: booking.phone
    });
    return { sent: true };
  } catch (err) {
    console.error('[SMS] Failed to send:', err.message);
    return { sent: false, reason: err.message };
  }
}

function formatTelegramMessage(booking) {
  const addons = JSON.parse(booking.addons || '[]');
  const addonText = addons.length ? addons.join(', ') : 'None';

  return `New booking received!\n\n` +
    `Name: ${booking.name}\n` +
    `Phone: ${booking.phone || '—'}\n` +
    `Email: ${booking.email || '—'}\n` +
    `Service: ${booking.service_name}\n` +
    `Vehicle: ${booking.vehicle_type}\n` +
    `Date: ${booking.booking_date}\n` +
    `Time: ${booking.booking_time}\n` +
    `Address: ${booking.address}\n` +
    `Add-ons: ${addonText}\n` +
    `${booking.comment ? `Comment: ${booking.comment}\n` : ''}` +
    `Total: $${booking.total_price}`;
}

async function sendTelegramNotification(booking) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.log('[Telegram] Bot not configured — skipping Telegram notification');
    return { sent: false, reason: 'not_configured' };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatTelegramMessage(booking),
        parse_mode: 'Markdown'
      })
    });

    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.description || 'Telegram API error');
    }

    return { sent: true, telegramMessageId: data.result?.message_id };
  } catch (err) {
    console.error('[Telegram] Failed to send:', err.message);
    return { sent: false, reason: err.message };
  }
}

async function sendBookingConfirmations(booking) {
  const results = {};
  const jobs = [];

  if (booking.phone) {
    jobs.push(sendSmsConfirmation(booking).then(r => { results.sms = r; }));
  }
  if (booking.email) {
    jobs.push(sendEmailConfirmation(booking).then(r => { results.email = r; }));
  }
  jobs.push(sendTelegramNotification(booking).then(r => { results.telegram = r; }));

  await Promise.allSettled(jobs);
  return results;
}

function queueBookingNotifications(booking, context) {
  const task = sendBookingConfirmations(booking)
    .then((results) => {
      if (booking.email && !results.email?.sent) {
        console.warn('[Email] Confirmation not sent:', results.email?.reason || 'unknown');
      }
      return results;
    })
    .catch((err) => {
      console.error('[Notifications] Failed:', err.message);
      return null;
    });

  if (context?.waitUntil) {
    context.waitUntil(task);
  }

  return task;
}

module.exports = {
  sendBookingConfirmations,
  queueBookingNotifications,
  sendEmailConfirmation,
  formatBookingDetails,
  getBookingLinks
};
