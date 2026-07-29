require('dotenv').config();

const services = require('../../data/services.json');
const { getAvailableSlots } = require('../../lib/availability');

async function getDbHelpers() {
  const db = require('../../lib/db');
  await db.initDb();
  return db;
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

  let slots = services.allowedStartTimes || ['09:00', '13:00', '17:00'];

  try {
    const db = await getDbHelpers();
    const [bookings, blocked, extraSlots] = await Promise.all([
      db.getAllBookings(),
      db.getAllBlocked(),
      db.getAllExtraSlots()
    ]);
    slots = getAvailableSlots(date, serviceId, bookings, blocked, extraSlots);
  } catch (err) {
    console.error('[slots]', err.message);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, serviceId, slots })
  };
};
