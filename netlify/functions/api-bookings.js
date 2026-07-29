require('dotenv').config();

const { getDb, findOrCreateClient, updateClientStats } = require('../../lib/db');
const {
  services,
  getServiceDuration,
  isSlotAvailable,
  calculatePrice
} = require('../../lib/availability');
const { sendBookingConfirmations } = require('../../lib/notifications');

function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getAllBookings() {
  return getDb().prepare('SELECT * FROM bookings ORDER BY booking_date DESC, booking_time DESC').all();
}

function getAllBlocked() {
  return getDb().prepare('SELECT * FROM blocked_slots ORDER BY block_date, block_time').all();
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const {
      name, phone, email, address, vehicleType,
      serviceId, addons, comment, bookingDate, bookingTime
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

    const pkg = services.packages.find(p => p.id === serviceId);
    if (!pkg) return json(400, { error: 'Invalid service' });

    const duration = getServiceDuration(serviceId);
    const available = isSlotAvailable(
      bookingDate, bookingTime, duration, getAllBookings(), getAllBlocked()
    );
    if (!available) {
      return json(409, { error: 'This time slot is no longer available' });
    }

    const addonList = Array.isArray(addons) ? addons : [];
    const totalPrice = calculatePrice(serviceId, vehicleType, addonList);
    const clientId = findOrCreateClient({ name, phone, email, address });

    const db = getDb();
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

    updateClientStats(clientId);
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(result.lastInsertRowid);
    const notifications = await sendBookingConfirmations(booking);

    return json(201, { booking, notifications });
  } catch (err) {
    console.error('[bookings]', err);
    return json(500, { error: err.message || 'Booking failed' });
  }
};
