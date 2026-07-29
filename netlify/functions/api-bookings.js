require('dotenv').config();

const {
  services,
  getServiceDuration,
  isSlotAvailable,
  calculatePrice
} = require('../../lib/availability');
const { queueBookingNotifications } = require('../../lib/notifications');

function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

function getDbModule() {
  try {
    return require('../../lib/db');
  } catch (err) {
    console.error('[bookings] DB module unavailable:', err.message);
    return null;
  }
}

function getAllBookings() {
  const dbModule = getDbModule();
  if (!dbModule) return [];
  try {
    return dbModule.getDb().prepare('SELECT * FROM bookings ORDER BY booking_date DESC, booking_time DESC').all();
  } catch {
    return [];
  }
}

function getAllBlocked() {
  const dbModule = getDbModule();
  if (!dbModule) return [];
  try {
    return dbModule.getDb().prepare('SELECT * FROM blocked_slots ORDER BY block_date, block_time').all();
  } catch {
    return [];
  }
}

function buildBookingRecord(body, pkg, addonList, totalPrice, id) {
  const now = new Date().toISOString();
  return {
    id,
    name: body.name,
    phone: body.phone || null,
    email: body.email || null,
    address: body.address,
    vehicle_type: body.vehicleType,
    service_id: body.serviceId,
    service_name: pkg.name,
    addons: JSON.stringify(addonList),
    comment: body.comment || null,
    booking_date: body.bookingDate,
    booking_time: body.bookingTime,
    duration_minutes: getServiceDuration(body.serviceId),
    total_price: totalPrice,
    status: 'pending',
    created_at: now,
    updated_at: now
  };
}

async function saveBooking(body) {
  const {
    name, phone, email, address, vehicleType,
    serviceId, addons, comment, bookingDate, bookingTime
  } = body;

  const pkg = services.packages.find(p => p.id === serviceId);
  if (!pkg) throw new Error('Invalid service');

  const addonList = Array.isArray(addons) ? addons : [];
  const totalPrice = calculatePrice(serviceId, vehicleType, addonList);
  const dbModule = getDbModule();

  if (!dbModule) {
    return { booking: buildBookingRecord(body, pkg, addonList, totalPrice, `web-${Date.now()}`) };
  }

  const duration = getServiceDuration(serviceId);
  const available = isSlotAvailable(
    bookingDate, bookingTime, duration, getAllBookings(), getAllBlocked()
  );
  if (!available) {
    const err = new Error('This time slot is no longer available');
    err.statusCode = 409;
    throw err;
  }

  try {
    const clientId = dbModule.findOrCreateClient({ name, phone, email, address });
    const db = dbModule.getDb();
    const result = db.prepare(`
      INSERT INTO bookings (
        client_id, name, phone, email, address, vehicle_type,
        service_id, service_name, addons, comment,
        booking_date, booking_time, duration_minutes, total_price, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      clientId, name, phone || null, email || null, address, vehicleType,
      serviceId, pkg.name, JSON.stringify(addonList), comment || null,
      bookingDate, bookingTime, duration, totalPrice
    );

    dbModule.updateClientStats(clientId);
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(result.lastInsertRowid);
    return { booking };
  } catch (dbErr) {
    console.error('[bookings] DB save failed:', dbErr.message);
    return {
      booking: buildBookingRecord(body, pkg, addonList, totalPrice, `web-${Date.now()}`)
    };
  }
}

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const {
      name, email, address, vehicleType,
      serviceId, bookingDate, bookingTime
    } = body;

    if (!name || !email || !address || !vehicleType || !serviceId || !bookingDate || !bookingTime) {
      return json(400, { error: 'Missing required fields' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(400, { error: 'Valid email is required' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const requestedDate = parseLocalDate(bookingDate);
    requestedDate.setHours(0, 0, 0, 0);
    if (requestedDate < today) {
      return json(400, { error: 'Cannot book past dates' });
    }

    const allowedTimes = services.allowedStartTimes || ['09:00', '13:00', '17:00'];
    if (!allowedTimes.includes(bookingTime)) {
      return json(400, { error: 'Invalid booking time' });
    }

    const { booking } = await saveBooking(body);
    queueBookingNotifications(booking, context);

    return json(201, { booking, notifications: { queued: true } });
  } catch (err) {
    console.error('[bookings]', err);
    return json(err.statusCode || 500, { error: err.message || 'Booking failed' });
  }
};
