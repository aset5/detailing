require('dotenv').config();

const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const {
  initDb,
  isPostgres,
  queryAll,
  queryOne,
  execute,
  findOrCreateClient,
  updateClientStats,
  getAllBookings,
  getAllBlocked,
  getAllExtraSlots,
  getExtraSlotsForDate,
  getBookingById,
  insertBooking
} = require('./lib/db');
const {
  services,
  getAvailableSlots,
  getMonthAvailability,
  isSlotAvailable,
  getServiceDuration,
  calculatePrice,
  getAllTimeSlots,
  isValidBookingTime
} = require('./lib/availability');
const { queueBookingNotifications, sendEmailConfirmation } = require('./lib/notifications');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const isProduction = process.env.NODE_ENV === 'production' || BASE_URL.startsWith('https');

function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'glow-on-the-go-secret-change-me',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

const BOOKING_LINK_SECRET = process.env.BOOKING_LINK_SECRET || 'glow-on-the-go-booking-link-secret';

function makeBookingLinkToken(booking) {
  return crypto
    .createHmac('sha256', BOOKING_LINK_SECRET)
    .update(`${booking.id}:${booking.updated_at || booking.created_at}`)
    .digest('hex');
}

function verifyBookingLinkToken(booking, token) {
  return Boolean(booking && token && makeBookingLinkToken(booking) === token);
}

function getBookingLinks(booking) {
  const token = makeBookingLinkToken(booking);
  return {
    cancel: `${BASE_URL}/booking/cancel-form/${booking.id}?token=${encodeURIComponent(token)}`,
    reschedule: `${BASE_URL}/booking/reschedule-form/${booking.id}?token=${encodeURIComponent(token)}`
  };
}

function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function periodStartClause(days) {
  if (isPostgres()) {
    return {
      sql: `booking_date >= (CURRENT_DATE - INTERVAL '${days} days')::text`,
      params: []
    };
  }
  return {
    sql: 'booking_date >= date(\'now\', ?)',
    params: [`-${days} days`]
  };
}

// ─── Public API ───────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/config', (req, res) => {
  res.json({ services });
});

app.get('/api/address/search', async (req, res) => {
  const query = req.query.q?.trim();
  if (!query || query.length < 2) return res.json([]);

  if (process.env.GOOGLE_MAPS_API_KEY) {
    try {
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&types=address&components=country:us&key=${process.env.GOOGLE_MAPS_API_KEY}`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.predictions?.length) {
        return res.json(data.predictions.map(p => ({ address: p.description })));
      }
    } catch (err) {
      console.error('[Address] Google API error:', err.message);
    }
  }

  try {
    const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=6&lang=en&lat=40.4406&lon=-79.9959`;
    const response = await fetch(photonUrl, {
      headers: { Accept: 'application/json', 'User-Agent': 'GlowOnTheGo/1.0' }
    });
    const data = await response.json();
    if (data.features?.length) {
      const results = data.features.map(formatPhotonAddress).filter(Boolean);
      if (results.length) return res.json(results);
    }
  } catch (err) {
    console.error('[Address] Photon API error:', err.message);
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query + ', Pittsburgh, PA')}&format=json&limit=6&countrycodes=us`;
    const response = await fetch(url, {
      headers: { 'Accept-Language': 'en', 'User-Agent': 'GlowOnTheGo/1.0' }
    });
    const results = await response.json();
    res.json(results.map(r => ({ address: r.display_name })));
  } catch {
    res.json([]);
  }
});

function formatPhotonAddress(feature) {
  const p = feature.properties || {};
  const parts = [
    [p.housenumber, p.street].filter(Boolean).join(' '),
    p.city || p.town || p.village || p.district,
    p.state,
    p.postcode,
    p.country
  ].filter(Boolean);
  const address = parts.join(', ');
  return address ? { address } : null;
}

app.get('/api/availability/month', async (req, res) => {
  const year = parseInt(req.query.year, 10);
  const month = parseInt(req.query.month, 10);
  if (!year || !month) return res.status(400).json({ error: 'year and month required' });

  const [bookings, blocked, extraSlots] = await Promise.all([
    getAllBookings(), getAllBlocked(), getAllExtraSlots()
  ]);
  const days = getMonthAvailability(year, month, bookings, blocked, extraSlots);
  res.json({ year, month, days });
});

app.get('/api/availability/day', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });

  const [extraSlots, allBookings, allBlocked] = await Promise.all([
    getAllExtraSlots(), getAllBookings(), getAllBlocked()
  ]);
  const allowedTimes = getAllTimeSlots(date, extraSlots);
  const bookings = allBookings.filter(
    b => b.booking_date === date && b.status !== 'cancelled'
  );
  const blocked = allBlocked.filter(b => b.block_date === date);
  const fullDayBlock = blocked.some(b => b.is_full_day);

  const slots = allowedTimes.map(time => {
    if (fullDayBlock) {
      return { time, status: 'blocked', isExtra: !services.allowedStartTimes.includes(time) };
    }
    const block = blocked.find(b => b.block_time === time);
    if (block) {
      return { time, status: 'blocked', isExtra: !services.allowedStartTimes.includes(time) };
    }
    const booking = bookings.find(b => b.booking_time === time);
    if (booking) {
      return {
        time,
        status: 'booked',
        service: booking.service_name,
        isExtra: !services.allowedStartTimes.includes(time)
      };
    }
    return { time, status: 'available', isExtra: !services.allowedStartTimes.includes(time) };
  });

  res.json({
    date,
    slots,
    bookingsCount: bookings.length,
    extraSlots: extraSlots.filter(e => e.slot_date === date)
  });
});

app.get('/api/availability/slots', async (req, res) => {
  const { date, serviceId } = req.query;
  if (!date || !serviceId) return res.status(400).json({ error: 'date and serviceId required' });

  const [bookings, blocked, extraSlots] = await Promise.all([
    getAllBookings(), getAllBlocked(), getAllExtraSlots()
  ]);
  const slots = getAvailableSlots(date, serviceId, bookings, blocked, extraSlots);
  res.json({ date, serviceId, slots });
});

app.post('/api/bookings', async (req, res) => {
  const {
    name, phone, email, address, vehicleType,
    serviceId, addons, comment, bookingDate, bookingTime
  } = req.body;

  if (!name || !email || !address || !vehicleType || !serviceId || !bookingDate || !bookingTime) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const requestedDate = parseLocalDate(bookingDate);
  requestedDate.setHours(0, 0, 0, 0);

  if (requestedDate < today) {
    return res.status(400).json({ error: 'Cannot book past dates' });
  }

  const extraSlots = await getAllExtraSlots();
  if (!isValidBookingTime(bookingDate, bookingTime, extraSlots)) {
    return res.status(400).json({ error: 'Invalid booking time' });
  }

  const pkg = services.packages.find(p => p.id === serviceId);
  if (!pkg) return res.status(400).json({ error: 'Invalid service' });

  const duration = getServiceDuration(serviceId);
  const [allBookings, allBlocked] = await Promise.all([getAllBookings(), getAllBlocked()]);
  const available = isSlotAvailable(
    bookingDate, bookingTime, duration, allBookings, allBlocked
  );
  if (!available) {
    return res.status(409).json({ error: 'This time slot is no longer available' });
  }

  const addonList = Array.isArray(addons) ? addons : [];
  const totalPrice = calculatePrice(serviceId, vehicleType, addonList);
  const clientId = await findOrCreateClient({ name, phone, email, address });

  const booking = await insertBooking([
    clientId, name, phone || null, email || null, address, vehicleType,
    serviceId, pkg.name, JSON.stringify(addonList), comment || null,
    bookingDate, bookingTime, duration, totalPrice, 'pending'
  ]);

  await updateClientStats(clientId);

  queueBookingNotifications(booking);

  res.status(201).json({ booking, notifications: { queued: true } });
});

app.get('/booking/cancel-form/:id', async (req, res) => {
  const booking = await getBookingById(req.params.id);
  const token = req.query.token;
  if (!booking || !verifyBookingLinkToken(booking, token)) {
    return res.status(403).send('<h1>Invalid or expired cancellation link</h1>');
  }

  if (booking.status === 'cancelled') {
    return res.send('<h1>Booking already cancelled</h1>');
  }

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Cancel booking</title>
  <style>
    body{font-family:Arial,sans-serif;padding:24px;color:#111;background:#f5f5f5;margin:0}
    .card{max-width:480px;margin:40px auto;background:#fff;padding:32px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08)}
    h1{margin-top:0;font-size:24px}
    .btn-danger{background:#e53e3e;color:#fff;border:none;padding:14px 24px;border-radius:8px;cursor:pointer;font-size:15px;font-weight:600}
    .btn-link{display:inline-block;margin-top:16px;color:#111}
  </style>
</head>
<body>
  <div class="card">
    <h1>Cancel your booking</h1>
    <p>Booking: <strong>#${booking.id}</strong></p>
    <p>Service: <strong>${booking.service_name}</strong></p>
    <p>Date: <strong>${booking.booking_date}</strong> at <strong>${booking.booking_time}</strong></p>
    <p>If you confirm, your booking will be cancelled.</p>
    <form method="POST" action="/booking/cancel/${booking.id}?token=${encodeURIComponent(token)}">
      <button type="submit" class="btn-danger">Confirm cancellation</button>
    </form>
    <a class="btn-link" href="/booking/reschedule-form/${booking.id}?token=${encodeURIComponent(token)}">Change date &amp; time instead</a>
  </div>
</body>
</html>`);
});

// perform cancellation via POST (used by cancel form)
app.post('/booking/cancel/:id', async (req, res) => {
  const booking = await getBookingById(req.params.id);
  const token = req.query.token;
  if (!booking || !verifyBookingLinkToken(booking, token)) {
    return res.status(403).send('<h1>Invalid or expired cancellation link</h1>');
  }

  if (booking.status === 'cancelled') {
    return res.send('<h1>Booking already cancelled</h1>');
  }

  await execute(
    `UPDATE bookings SET status = ?, updated_at = ${isPostgres() ? 'NOW()' : "datetime('now')"} WHERE id = ?`,
    ['cancelled', booking.id]
  );
  if (booking.client_id) await updateClientStats(booking.client_id);
  res.send('<h1>Your booking has been cancelled.</h1><p>Thank you, we have updated your appointment.</p>');
});

app.get('/booking/reschedule-form/:id', async (req, res) => {
  const booking = await getBookingById(req.params.id);
  const token = req.query.token;
  if (!booking || !verifyBookingLinkToken(booking, token)) {
    return res.status(403).send('<h1>Invalid or expired reschedule link</h1>');
  }

  if (booking.status === 'cancelled') {
    return res.send('<h1>This booking has already been cancelled.</h1>');
  }

  const allowedTimes = services.allowedStartTimes || ['09:00', '13:00', '17:00'];
  const timeOptions = allowedTimes.map(time => {
    const selected = time === booking.booking_time ? ' selected' : '';
    const [h, m] = time.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    const label = `${hour12}:${String(m).padStart(2, '0')} ${period}`;
    return `<option value="${time}"${selected}>${label}</option>`;
  }).join('');

  const today = new Date().toISOString().split('T')[0];

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Reschedule booking</title>
  <style>
    body{font-family:Arial,sans-serif;padding:24px;color:#111;background:#f5f5f5;margin:0}
    .card{max-width:480px;margin:40px auto;background:#fff;padding:32px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08)}
    h1{margin-top:0;font-size:24px}
    label{display:block;margin:16px 0 6px;font-weight:600}
    input,select{width:100%;max-width:100%;padding:12px;margin-bottom:4px;border:1px solid #ccc;border-radius:8px;font-size:15px;box-sizing:border-box}
    button{background:#111;color:#fff;border:none;padding:14px 24px;border-radius:8px;cursor:pointer;font-size:15px;font-weight:600;margin-top:16px}
    .btn-link{display:inline-block;margin-top:16px;color:#111}
  </style>
</head>
<body>
  <div class="card">
    <h1>Change date &amp; time</h1>
    <p>Booking: <strong>#${booking.id}</strong></p>
    <p>Service: <strong>${booking.service_name}</strong></p>
    <form method="POST" action="/booking/reschedule/${booking.id}?token=${encodeURIComponent(token)}">
      <label for="bookingDate">New date</label>
      <input id="bookingDate" name="bookingDate" type="date" value="${booking.booking_date}" min="${today}" required />
      <label for="bookingTime">New time</label>
      <select id="bookingTime" name="bookingTime" required>${timeOptions}</select>
      <button type="submit">Save new date &amp; time</button>
    </form>
    <a class="btn-link" href="/booking/cancel-form/${booking.id}?token=${encodeURIComponent(token)}">Cancel booking instead</a>
  </div>
</body>
</html>`);
});

// perform reschedule via POST (used by reschedule form)
app.post('/booking/reschedule/:id', async (req, res) => {
  const booking = await getBookingById(req.params.id);
  const token = req.query.token;
  let { bookingDate, bookingTime } = req.body;

  if (!booking || !verifyBookingLinkToken(booking, token)) {
    return res.status(403).send('<h1>Invalid or expired reschedule link</h1>');
  }

  if (booking.status === 'cancelled') {
    return res.send('<h1>Cannot reschedule a cancelled booking.</h1>');
  }

  if (!bookingDate || !bookingTime) {
    return res.status(400).send('<h1>Date and time are required.</h1>');
  }

  bookingTime = bookingTime.slice(0, 5);

  const extraSlots = await getAllExtraSlots();
  if (!isValidBookingTime(bookingDate, bookingTime, extraSlots)) {
    return res.send('<h1>Invalid booking time. Please go back and choose an available slot.</h1>');
  }

  const duration = getServiceDuration(booking.service_id);
  const allBookings = await getAllBookings();
  const otherBookings = allBookings.filter(b => b.id !== booking.id);
  const allBlocked = await getAllBlocked();
  const available = isSlotAvailable(bookingDate, bookingTime, duration, otherBookings, allBlocked);
  if (!available) {
    return res.send('<h1>Requested time slot is not available. Please go back and choose another time.</h1>');
  }

  await execute(`
    UPDATE bookings SET booking_date = ?, booking_time = ?, updated_at = ${isPostgres() ? 'NOW()' : "datetime('now')"}
    WHERE id = ?
  `, [bookingDate, bookingTime, booking.id]);

  const updatedBooking = await getBookingById(booking.id);
  if (updatedBooking.client_id) await updateClientStats(updatedBooking.client_id);

  let emailSent = false;
  if (updatedBooking.email) {
    const emailResult = await sendEmailConfirmation(updatedBooking, { updated: true });
    emailSent = emailResult.sent;
  }

  res.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Booking rescheduled</title>
<style>body{font-family:Arial,sans-serif;padding:24px;color:#111;background:#f5f5f5;margin:0}.card{max-width:480px;margin:40px auto;background:#fff;padding:32px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08)}h1{margin-top:0}</style>
</head>
<body>
  <div class="card">
    <h1>Your booking has been rescheduled</h1>
    <p>New date: <strong>${updatedBooking.booking_date}</strong></p>
    <p>New time: <strong>${updatedBooking.booking_time}</strong></p>
    ${emailSent ? '<p>A confirmation email with updated details has been sent to your inbox.</p>' : ''}
    <p>Thank you — your appointment has been updated successfully.</p>
  </div>
</body>
</html>`);
});

// ─── Admin Auth ───────────────────────────────────────────────

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';

  if (password === adminPass) {
    req.session.authenticated = true;
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Invalid password' });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/admin/check', (req, res) => {
  res.json({ authenticated: !!req.session?.authenticated });
});

// ─── Admin Bookings CRUD ──────────────────────────────────────

app.get('/api/admin/bookings', requireAuth, async (req, res) => {
  const { status, date, search, period } = req.query;
  let sql = 'SELECT * FROM bookings WHERE 1=1';
  const params = [];

  if (period === 'week') {
    const clause = periodStartClause(7);
    sql += ` AND ${clause.sql}`;
    params.push(...clause.params);
  } else if (period === 'month') {
    const clause = periodStartClause(30);
    sql += ` AND ${clause.sql}`;
    params.push(...clause.params);
  } else if (period === 'today') {
    if (isPostgres()) {
      sql += ' AND booking_date = CURRENT_DATE::text';
    } else {
      sql += ' AND booking_date = date(\'now\')';
    }
  }

  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (date) { sql += ' AND booking_date = ?'; params.push(date); }
  if (search) {
    sql += ' AND (name LIKE ? OR phone LIKE ? OR email LIKE ? OR address LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }

  sql += ' ORDER BY booking_date DESC, booking_time DESC';
  res.json(await queryAll(sql, params));
});

app.get('/api/admin/bookings/:id', requireAuth, async (req, res) => {
  const booking = await getBookingById(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Not found' });
  res.json(booking);
});

app.post('/api/admin/bookings', requireAuth, async (req, res) => {
  const {
    name, phone, email, address, vehicleType,
    serviceId, addons, comment, bookingDate, bookingTime, status
  } = req.body;

  const pkg = services.packages.find(p => p.id === serviceId);
  if (!pkg) return res.status(400).json({ error: 'Invalid service' });

  const extraSlots = await getAllExtraSlots();
  if (!isValidBookingTime(bookingDate, bookingTime, extraSlots)) {
    return res.status(400).json({ error: 'Invalid booking time' });
  }

  const duration = getServiceDuration(serviceId);
  const [allBookings, allBlocked] = await Promise.all([getAllBookings(), getAllBlocked()]);
  const available = isSlotAvailable(
    bookingDate, bookingTime, duration, allBookings, allBlocked
  );
  if (!available) {
    return res.status(409).json({ error: 'Time slot not available' });
  }

  const addonList = Array.isArray(addons) ? addons : [];
  const totalPrice = calculatePrice(serviceId, vehicleType, addonList);
  const clientId = await findOrCreateClient({ name, phone, email, address });

  const booking = await insertBooking([
    clientId, name, phone || null, email || null, address, vehicleType,
    serviceId, pkg.name, JSON.stringify(addonList), comment || null,
    bookingDate, bookingTime, duration, totalPrice, status || 'confirmed'
  ]);

  await updateClientStats(clientId);
  queueBookingNotifications(booking);

  res.status(201).json({ booking, notifications: { queued: true } });
});

app.put('/api/admin/bookings/:id', requireAuth, async (req, res) => {
  const existing = await getBookingById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const {
    name,
    phone,
    email,
    address,
    vehicleType,
    serviceId,
    addons,
    comment,
    bookingDate,
    bookingTime,
    status
  } = req.body;

  const updatedServiceId = serviceId !== undefined ? serviceId : existing.service_id;
  const updatedVehicleType = vehicleType !== undefined ? vehicleType : existing.vehicle_type;
  const updatedName = name !== undefined ? name : existing.name;
  const updatedPhone = phone !== undefined ? phone : existing.phone;
  const updatedEmail = email !== undefined ? email : existing.email;
  const updatedAddress = address !== undefined ? address : existing.address;
  const updatedBookingDate = bookingDate !== undefined ? bookingDate : existing.booking_date;
  const updatedBookingTime = bookingTime !== undefined ? bookingTime : existing.booking_time;
  const updatedStatus = status !== undefined ? status : existing.status;
  const updatedComment = comment !== undefined ? comment : existing.comment;

  const pkg = services.packages.find(p => p.id === updatedServiceId);
  if (!pkg) return res.status(400).json({ error: 'Invalid service' });

  const duration = getServiceDuration(updatedServiceId);

  const otherBookings = (await getAllBookings()).filter(b =>
    b.id !== parseInt(req.params.id, 10)
  );

  if (updatedStatus !== 'cancelled') {
    const extraSlots = await getAllExtraSlots();
    if (!isValidBookingTime(updatedBookingDate, updatedBookingTime, extraSlots)) {
      return res.status(400).json({ error: 'Invalid booking time' });
    }

    const available = isSlotAvailable(
      updatedBookingDate,
      updatedBookingTime,
      duration,
      otherBookings,
      await getAllBlocked()
    );
    if (!available) {
      return res.status(409).json({ error: 'Time slot not available' });
    }
  }

  const addonList = Array.isArray(addons)
    ? addons
    : (existing.addons ? JSON.parse(existing.addons) : []);
  const totalPrice = calculatePrice(updatedServiceId, updatedVehicleType, addonList);

  await execute(`
    UPDATE bookings SET
      name = ?, phone = ?, email = ?, address = ?, vehicle_type = ?,
      service_id = ?, service_name = ?, addons = ?, comment = ?,
      booking_date = ?, booking_time = ?, duration_minutes = ?,
      total_price = ?, status = ?, updated_at = ${isPostgres() ? 'NOW()' : "datetime('now')"}
    WHERE id = ?
  `, [
    updatedName,
    updatedPhone || null,
    updatedEmail || null,
    updatedAddress,
    updatedVehicleType,
    updatedServiceId,
    pkg.name,
    JSON.stringify(addonList),
    updatedComment || null,
    updatedBookingDate,
    updatedBookingTime,
    duration,
    totalPrice,
    updatedStatus,
    req.params.id
  ]);

  if (existing.client_id) await updateClientStats(existing.client_id);

  const booking = await getBookingById(req.params.id);

  // If booking was changed to confirmed, send notifications
  if (existing.status !== 'confirmed' && updatedStatus === 'confirmed') {
    queueBookingNotifications(booking);
  }

  res.json({ booking, notifications: { queued: true } });
});

app.delete('/api/admin/bookings/:id', requireAuth, async (req, res) => {
  const booking = await getBookingById(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Not found' });

  await execute('DELETE FROM bookings WHERE id = ?', [req.params.id]);
  if (booking.client_id) await updateClientStats(booking.client_id);
  res.json({ success: true });
});

// ─── Admin Clients (CRM) ─────────────────────────────────────

app.get('/api/admin/clients', requireAuth, async (req, res) => {
  const { search } = req.query;
  let sql = 'SELECT * FROM clients';
  const params = [];

  if (search) {
    sql += ' WHERE name LIKE ? OR phone LIKE ? OR email LIKE ?';
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  sql += ' ORDER BY last_booking_at DESC';
  res.json(await queryAll(sql, params));
});

app.get('/api/admin/clients/:id', requireAuth, async (req, res) => {
  const client = await queryOne('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  if (!client) return res.status(404).json({ error: 'Not found' });

  const bookings = await queryAll(
    'SELECT * FROM bookings WHERE client_id = ? ORDER BY booking_date DESC',
    [req.params.id]
  );

  res.json({ client, bookings });
});

app.put('/api/admin/clients/:id', requireAuth, async (req, res) => {
  const { notes, name, phone, email, address } = req.body;
  await execute(`
    UPDATE clients SET name = ?, phone = ?, email = ?, address = ?, notes = ?
    WHERE id = ?
  `, [name, phone, email, address, notes || null, req.params.id]);

  const client = await queryOne('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  res.json(client);
});

// ─── Admin Blocked Slots ──────────────────────────────────────

app.get('/api/admin/blocked', requireAuth, async (req, res) => {
  res.json(await getAllBlocked());
});

app.post('/api/admin/blocked', requireAuth, async (req, res) => {
  const { blockDate, blockTime, isFullDay, reason } = req.body;
  if (!blockDate) return res.status(400).json({ error: 'blockDate required' });

  const insertSql = isPostgres()
    ? `INSERT INTO blocked_slots (block_date, block_time, is_full_day, reason)
       VALUES (?, ?, ?, ?) RETURNING id`
    : `INSERT INTO blocked_slots (block_date, block_time, is_full_day, reason)
       VALUES (?, ?, ?, ?)`;

  const result = await execute(insertSql, [
    blockDate, blockTime || null, isFullDay ? 1 : 0, reason || null
  ]);

  const block = await queryOne('SELECT * FROM blocked_slots WHERE id = ?', [result.lastInsertRowid]);
  res.status(201).json(block);
});

app.delete('/api/admin/blocked/:id', requireAuth, async (req, res) => {
  await execute('DELETE FROM blocked_slots WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ─── Admin Extra Slots (per-day additional times) ─────────────

app.get('/api/admin/extra-slots', requireAuth, async (req, res) => {
  const { date } = req.query;
  if (date) {
    return res.json(await getExtraSlotsForDate(date));
  }
  res.json(await getAllExtraSlots());
});

app.post('/api/admin/extra-slots', requireAuth, async (req, res) => {
  const { slotDate, slotTime } = req.body;
  if (!slotDate || !slotTime) {
    return res.status(400).json({ error: 'slotDate and slotTime required' });
  }

  const baseTimes = services.allowedStartTimes || [];
  if (baseTimes.includes(slotTime)) {
    return res.status(400).json({ error: 'This time is already in the standard schedule' });
  }

  const existing = await queryOne(
    'SELECT id FROM extra_slots WHERE slot_date = ? AND slot_time = ?',
    [slotDate, slotTime]
  );
  if (existing) {
    return res.status(409).json({ error: 'Extra slot already exists for this day' });
  }

  const insertSql = isPostgres()
    ? 'INSERT INTO extra_slots (slot_date, slot_time) VALUES (?, ?) RETURNING id'
    : 'INSERT INTO extra_slots (slot_date, slot_time) VALUES (?, ?)';

  const result = await execute(insertSql, [slotDate, slotTime]);
  const slot = await queryOne('SELECT * FROM extra_slots WHERE id = ?', [result.lastInsertRowid]);
  res.status(201).json(slot);
});

app.delete('/api/admin/extra-slots/:id', requireAuth, async (req, res) => {
  await execute('DELETE FROM extra_slots WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ─── Admin Dashboard Stats ────────────────────────────────────

app.get('/api/admin/stats', requireAuth, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];

  const todayRow = await queryOne(
    "SELECT COUNT(*) as count FROM bookings WHERE booking_date = ? AND status != 'cancelled'",
    [today]
  );
  const pendingRow = await queryOne(
    "SELECT COUNT(*) as count FROM bookings WHERE status = 'pending'"
  );
  const clientsRow = await queryOne('SELECT COUNT(*) as count FROM clients');
  const revenueSql = isPostgres()
    ? `SELECT COALESCE(SUM(total_price), 0) as revenue FROM bookings
       WHERE status != 'cancelled'
       AND to_char(booking_date::date, 'YYYY-MM') = to_char(CURRENT_DATE, 'YYYY-MM')`
    : `SELECT COALESCE(SUM(total_price), 0) as revenue FROM bookings
       WHERE status != 'cancelled'
       AND strftime('%Y-%m', booking_date) = strftime('%Y-%m', 'now')`;
  const revenueRow = await queryOne(revenueSql);

  async function getPeriodSummary(days) {
    const clause = periodStartClause(days);
    const row = await queryOne(`
      SELECT
        COUNT(*) as total,
        COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total_price ELSE 0 END), 0) as revenue,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
      FROM bookings
      WHERE ${clause.sql}
    `, clause.params);

    return {
      total: Number(row?.total || 0),
      revenue: Number(row?.revenue || 0),
      pending: Number(row?.pending || 0),
      confirmed: Number(row?.confirmed || 0),
      completed: Number(row?.completed || 0),
      cancelled: Number(row?.cancelled || 0)
    };
  }

  const week = await getPeriodSummary(7);
  const month = await getPeriodSummary(30);

  const upcoming = await queryAll(`
    SELECT * FROM bookings
    WHERE booking_date >= ? AND status != 'cancelled'
    ORDER BY booking_date, booking_time LIMIT 5
  `, [today]);

  res.json({
    todayBookings: Number(todayRow?.count || 0),
    pendingBookings: Number(pendingRow?.count || 0),
    totalClients: Number(clientsRow?.count || 0),
    monthRevenue: Number(revenueRow?.revenue || 0),
    week,
    month,
    upcoming
  });
});

// ─── Static Files ─────────────────────────────────────────────

app.use(express.static(path.join(__dirname)));

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

if (require.main === module) {
  initDb()
    .then(() => {
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`Glow on the Go server running at ${BASE_URL}`);
        console.log(`Admin panel: ${BASE_URL}/admin`);
        console.log(`Database: ${isPostgres() ? 'PostgreSQL' : 'SQLite'}`);
      });
    })
    .catch((err) => {
      console.error('Failed to start server:', err);
      process.exit(1);
    });
}

module.exports = app;
