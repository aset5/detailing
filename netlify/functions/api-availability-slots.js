require('dotenv').config();

const services = require('../../data/services.json');
const { getAvailableSlots } = require('../../lib/availability');

function getAllBookings() {
  try {
    const { getDb } = require('../../lib/db');
    return getDb().prepare('SELECT * FROM bookings ORDER BY booking_date DESC, booking_time DESC').all();
  } catch {
    return [];
  }
}

function getAllBlocked() {
  try {
    const { getDb } = require('../../lib/db');
    return getDb().prepare('SELECT * FROM blocked_slots ORDER BY block_date, block_time').all();
  } catch {
    return [];
  }
}

exports.handler = async (event) => {
  const { date, serviceId } = event.queryStringParameters || {};

  if (!date || !serviceId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'date and serviceId required' })
    };
  }

  const allowedTimes = services.allowedStartTimes || ['09:00', '13:00', '17:00'];
  let slots = allowedTimes;

  try {
    slots = getAvailableSlots(date, serviceId, getAllBookings(), getAllBlocked());
  } catch (err) {
    console.error('[slots]', err.message);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, serviceId, slots })
  };
};
