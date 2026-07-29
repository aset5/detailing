require('dotenv').config();

const to = process.argv[2];
if (!to) {
  console.error('Usage: node scripts/send-test-email.js you@example.com');
  process.exit(1);
}

const { sendEmailConfirmation } = require('../lib/notifications');

const booking = {
  id: 0,
  name: 'Test User',
  email: to,
  booking_date: '2026-08-01',
  booking_time: '09:00',
  service_name: 'Full detailing',
  vehicle_type: 'sedan',
  address: '123 Test St, Pittsburgh, PA',
  addons: '[]',
  comment: null,
  total_price: 239,
  created_at: new Date().toISOString()
};

sendEmailConfirmation(booking).then(result => {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.sent ? 0 : 1);
});
