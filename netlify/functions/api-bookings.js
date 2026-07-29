require('dotenv').config();

const {
  services,
  getServiceDuration,
  isSlotAvailable,
  calculatePrice,
  isValidBookingTime
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

async function getDbHelpers() {
  const db = require('../../lib/db');
  await db.initDb();
  return db;
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

  try {
    const db = await getDbHelpers();
    const duration = getServiceDuration(serviceId);
    const [allBookings, allBlocked, extraSlots] = await Promise.all([
      db.getAllBookings(),
      db.getAllBlocked(),
      db.getAllExtraSlots()
    ]);

    if (!isValidBookingTime(bookingDate, bookingTime, extraSlots)) {
      const err = new Error('Invalid booking time');
      err.statusCode = 400;
      throw err;
    }

    const available = isSlotAvailable(
      bookingDate, bookingTime, duration, allBookings, allBlocked
    );
    if (!available) {
      const err = new Error('This time slot is no longer available');
      err.statusCode = 409;
      throw err;
    }

    const clientId = await db.findOrCreateClient({ name, phone, email, address });
    const booking = await db.insertBooking([
      clientId, name, phone || null, email || null, address, vehicleType,
      serviceId, pkg.name, JSON.stringify(addonList), comment || null,
      bookingDate, bookingTime, duration, totalPrice, 'pending'
    ]);

    await db.updateClientStats(clientId);
    return { booking };
  } catch (dbErr) {
    if (dbErr.statusCode) throw dbErr;
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

    const { booking } = await saveBooking(body);
    queueBookingNotifications(booking, context);

    return json(201, { booking, notifications: { queued: true } });
  } catch (err) {
    console.error('[bookings]', err);
    return json(err.statusCode || 500, { error: err.message || 'Booking failed' });
  }
};
