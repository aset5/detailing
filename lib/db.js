const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH
  || (process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME
    ? '/tmp/bookings.db'
    : path.join(__dirname, '..', 'data', 'bookings.db'));

let db;

function getDb() {
  if (!db) {
    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT NOT NULL,
      vehicle_type TEXT NOT NULL,
      service_id TEXT NOT NULL,
      service_name TEXT NOT NULL,
      addons TEXT DEFAULT '[]',
      comment TEXT,
      booking_date TEXT NOT NULL,
      booking_time TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      total_price REAL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (client_id) REFERENCES clients(id)
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      total_bookings INTEGER DEFAULT 0,
      total_spent REAL DEFAULT 0,
      first_booking_at TEXT,
      last_booking_at TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS blocked_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      block_date TEXT,
      block_time TEXT,
      is_full_day INTEGER DEFAULT 0,
      reason TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS extra_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_date TEXT NOT NULL,
      slot_time TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(slot_date, slot_time)
    );

    CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(booking_date);
    CREATE INDEX IF NOT EXISTS idx_bookings_client ON bookings(client_id);
    CREATE INDEX IF NOT EXISTS idx_blocked_date ON blocked_slots(block_date);
    CREATE INDEX IF NOT EXISTS idx_extra_slots_date ON extra_slots(slot_date);
  `);
}

function findOrCreateClient({ name, phone, email, address }) {
  const database = getDb();

  let client = null;
  if (phone) {
    client = database.prepare('SELECT * FROM clients WHERE phone = ?').get(phone);
  }
  if (!client && email) {
    client = database.prepare('SELECT * FROM clients WHERE email = ?').get(email);
  }

  if (client) {
    database.prepare(`
      UPDATE clients SET
        name = ?, email = COALESCE(?, email), address = COALESCE(?, address),
        last_booking_at = datetime('now')
      WHERE id = ?
    `).run(name, email || null, address || null, client.id);
    return client.id;
  }

  const result = database.prepare(`
    INSERT INTO clients (name, phone, email, address, first_booking_at, last_booking_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(name, phone || null, email || null, address || null);

  return result.lastInsertRowid;
}

function updateClientStats(clientId) {
  const database = getDb();
  const stats = database.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(total_price), 0) as spent
    FROM bookings WHERE client_id = ? AND status != 'cancelled'
  `).get(clientId);

  database.prepare(`
    UPDATE clients SET total_bookings = ?, total_spent = ? WHERE id = ?
  `).run(stats.count, stats.spent, clientId);
}

module.exports = { getDb, findOrCreateClient, updateClientStats };
