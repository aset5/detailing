require('dotenv').config();
const nodemailer = require('nodemailer');

const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

console.log('Testing SMTP connection to', process.env.SMTP_HOST, 'as', process.env.SMTP_USER);
transport.verify((err, success) => {
  if (err) {
    console.error('VERIFY_ERROR');
    console.error(err);
    process.exit(2);
  } else {
    console.log('SMTP verified');
    process.exit(0);
  }
});
