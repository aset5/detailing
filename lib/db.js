const fs = require('fs');
const path = require('path');

const USE_PG = Boolean(process.env.DATABASE_URL);
const DB_PATH = process.env.DATABASE_PATH
  || (process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME
    ? '/tmp/bookings.db'
    : path.join(__dirname, '..', 'data', 'bookings.db'));

let sqliteDb;
let pgPool;
let initPromise;

function convertSql(sql) {
  if (!USE_PG) return sql;

  return sql
    .replace(/datetime\('now'\)/gi, 'NOW()')
    .replace(/date\('now',\s*'\-(\d+)\s+days'\)/gi, (_, days) =>
      `(CURRENT_DATE - INTERVAL '${days} days')::text`)
    .replace(/date\('now'\)/gi, 'CURRENT_DATE::text')
    .replace(/strftime\('%Y-%m',\s*booking_date\)\s*=\s*strftime\('%Y-%m',\s*'now'\)/gi,
      "to_char(booking_date::date, 'YYYY-MM') = to_char(CURRENT_DATE, 'YYYY-MM')");
}

function toPgParams(sql, params = []) {
  if (!USE_PG) return { sql: convertSql(sql), params };
  let index = 0;
  const pgSql = convertSql(sql).replace(/\?/g, () => `$${++index}`);
  return { sql: pgSql, params };
}

async function queryAll(sql, params = []) {
  const { sql: finalSql, params: finalParams } = toPgParams(sql, params);
  if (USE_PG) {
    const result = await pgPool.query(finalSql, finalParams);
    return result.rows;
  }
  return sqliteDb.prepare(finalSql).all(...finalParams);
}

async function queryOne(sql, params = []) {
  const rows = await queryAll(sql, params);
  return rows[0] || null;
}

async function execute(sql, params = []) {
  const { sql: finalSql, params: finalParams } = toPgParams(sql, params);
  if (USE_PG) {
    const result = await pgPool.query(finalSql, finalParams);
    return { changes: result.rowCount, lastInsertRowid: result.rows[0]?.id };
  }
  const info = sqliteDb.prepare(finalSql).run(...finalParams);
  return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
}

function getSqliteSchema() {
  return `
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
  `;
}

function getPostgresSchema() {
  return `
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      total_bookings INTEGER DEFAULT 0,
      total_spent DOUBLE PRECISION DEFAULT 0,
      first_booking_at TIMESTAMPTZ,
      last_booking_at TIMESTAMPTZ,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      client_id INTEGER REFERENCES clients(id),
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
      total_price DOUBLE PRECISION,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS blocked_slots (
      id SERIAL PRIMARY KEY,
      block_date TEXT,
      block_time TEXT,
      is_full_day SMALLINT DEFAULT 0,
      reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS extra_slots (
      id SERIAL PRIMARY KEY,
      slot_date TEXT NOT NULL,
      slot_time TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(slot_date, slot_time)
    );

    CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(booking_date);
    CREATE INDEX IF NOT EXISTS idx_bookings_client ON bookings(client_id);
    CREATE INDEX IF NOT EXISTS idx_blocked_date ON blocked_slots(block_date);
    CREATE INDEX IF NOT EXISTS idx_extra_slots_date ON extra_slots(slot_date);
  `;
}

async function initSchema() {
  if (USE_PG) {
    await pgPool.query(getPostgresSchema());
    return;
  }

  sqliteDb.exec(getSqliteSchema());
}

async function initDb() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (USE_PG) {
      const { Pool } = require('pg');
      pgPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.PGSSLMODE === 'disable'
          ? false
          : { rejectUnauthorized: false }
      });
      await pgPool.query('SELECT 1');
      console.log('[DB] Connected to PostgreSQL');
    } else {
      const Database = require('better-sqlite3');
      const dbDir = path.dirname(DB_PATH);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
      sqliteDb = new Database(DB_PATH);
      sqliteDb.pragma('journal_mode = WAL');
      sqliteDb.pragma('foreign_keys = ON');
      console.log(`[DB] Connected to SQLite at ${DB_PATH}`);
    }

    await initSchema();
  })();

  return initPromise;
}

function getDb() {
  if (USE_PG) {
    throw new Error('getDb() is unavailable with PostgreSQL — use async db helpers');
  }
  if (!sqliteDb) {
    throw new Error('Database not initialized — call initDb() first');
  }
  return sqliteDb;
}

async function findOrCreateClient({ name, phone, email, address }) {
  let client = null;
  if (phone) {
    client = await queryOne('SELECT * FROM clients WHERE phone = ?', [phone]);
  }
  if (!client && email) {
    client = await queryOne('SELECT * FROM clients WHERE email = ?', [email]);
  }

  if (client) {
    await execute(`
      UPDATE clients SET
        name = ?, email = COALESCE(?, email), address = COALESCE(?, address),
        last_booking_at = ${USE_PG ? 'NOW()' : "datetime('now')"}
      WHERE id = ?
    `, [name, email || null, address || null, client.id]);
    return client.id;
  }

  const insertSql = USE_PG
    ? `INSERT INTO clients (name, phone, email, address, first_booking_at, last_booking_at)
       VALUES (?, ?, ?, ?, NOW(), NOW()) RETURNING id`
    : `INSERT INTO clients (name, phone, email, address, first_booking_at, last_booking_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`;

  const result = await execute(insertSql, [name, phone || null, email || null, address || null]);
  return result.lastInsertRowid;
}

async function updateClientStats(clientId) {
  const stats = await queryOne(`
    SELECT COUNT(*) as count, COALESCE(SUM(total_price), 0) as spent
    FROM bookings WHERE client_id = ? AND status != 'cancelled'
  `, [clientId]);

  await execute(
    'UPDATE clients SET total_bookings = ?, total_spent = ? WHERE id = ?',
    [stats.count, stats.spent, clientId]
  );
}

async function getAllBookings() {
  return queryAll('SELECT * FROM bookings ORDER BY booking_date DESC, booking_time DESC');
}

async function getAllBlocked() {
  return queryAll('SELECT * FROM blocked_slots ORDER BY block_date, block_time');
}

async function getAllExtraSlots() {
  return queryAll('SELECT * FROM extra_slots ORDER BY slot_date, slot_time');
}

async function getExtraSlotsForDate(date) {
  return queryAll('SELECT * FROM extra_slots WHERE slot_date = ? ORDER BY slot_time', [date]);
}

async function getBookingById(id) {
  return queryOne('SELECT * FROM bookings WHERE id = ?', [id]);
}

async function insertBooking(values) {
  const insertSql = USE_PG
    ? `INSERT INTO bookings (
        client_id, name, phone, email, address, vehicle_type,
        service_id, service_name, addons, comment,
        booking_date, booking_time, duration_minutes, total_price, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id`
    : `INSERT INTO bookings (
        client_id, name, phone, email, address, vehicle_type,
        service_id, service_name, addons, comment,
        booking_date, booking_time, duration_minutes, total_price, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  const result = await execute(insertSql, values);
  return getBookingById(result.lastInsertRowid);
}

module.exports = {
  initDb,
  getDb,
  isPostgres: () => USE_PG,
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
};
