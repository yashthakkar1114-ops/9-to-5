// Creates the tables and demo data.  Usage: npm run db:setup   (add -- --reset to wipe everything first)
// Running it on an existing database also upgrades older tables in place, keeping their data.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');

const DEMO_PASSWORD = 'demo1234';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';

const AREAS = ['Andheri', 'Bandra', 'Borivali', 'Chembur', 'Colaba', 'Dadar', 'Ghatkopar', 'Goregaon',
  'Juhu', 'Kurla', 'Lower Parel', 'Malad', 'Mulund', 'Powai', 'Thane', 'Vashi', 'Worli'];

const LABOURERS = [
  ['Ram Kumar', 'ram@demo.in', '9820000001', 'Plumber', 'Andheri', 600, 'Leak repair, pipe replacement, bathroom fittings', 8, true],
  ['Meena Patel', 'meena@demo.in', '9820000002', 'Carpenter,Painter', 'Powai', 800, 'Furniture repair, doors, modular kitchen, polishing', 12, true],
  ['Suresh Singh', 'suresh@demo.in', '9820000003', 'Electrician', 'Lower Parel', 700, 'Wiring, switchboards, fan & light fitting', 6, true],
  ['Anil Yadav', 'anil@demo.in', '9820000004', 'Painter,Mason', 'Bandra', 650, 'Wall painting, texture, waterproofing, plastering', 5, false],
  ['Ravi Shinde', 'ravi@demo.in', '9820000005', 'Mover,Helper', 'Dadar', 550, 'House shifting, loading, packing', 3, false],
];

// Brings a database created by an older version of schema.sql up to date.
async function migrate(conn) {
  const hasColumn = async (table, column) => {
    const [rows] = await conn.query(
      'SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
      [table, column]
    );
    return rows.length > 0;
  };

  if (await hasColumn('labourer_profiles', 'trade')) {
    await conn.query('ALTER TABLE labourer_profiles CHANGE trade trades VARCHAR(255) NOT NULL');
    console.log('Upgraded: labourers can now have several trades.');
  }
  if (!(await hasColumn('jobs', 'address'))) {
    await conn.query("ALTER TABLE jobs ADD COLUMN address VARCHAR(255) NOT NULL DEFAULT '' AFTER location");
    await conn.query("UPDATE jobs SET address = location WHERE address = ''");
    console.log('Upgraded: jobs now have an address.');
  }
  if (!(await hasColumn('bookings', 'address'))) {
    await conn.query(`ALTER TABLE bookings
      ADD COLUMN address VARCHAR(255) NOT NULL DEFAULT '' AFTER note,
      ADD COLUMN paid_at TIMESTAMP NULL AFTER status,
      ADD COLUMN payment_method VARCHAR(20) NULL AFTER paid_at,
      ADD COLUMN payment_ref VARCHAR(30) NULL AFTER payment_method`);
    await conn.query(`UPDATE bookings b LEFT JOIN jobs j ON j.id = b.job_id
      JOIN labourer_profiles p ON p.user_id = b.labourer_id
      SET b.address = COALESCE(NULLIF(j.address, ''), j.location, p.area) WHERE b.address = ''`);
    console.log('Upgraded: bookings now have an address and payment details.');
  }
  // Jobs and bookings are booked in time slots; older rows become a 9-to-5 day.
  for (const table of ['jobs', 'bookings']) {
    if (!(await hasColumn(table, 'start_time'))) {
      const after = table === 'jobs' ? 'job_date' : 'booking_date';
      await conn.query(`ALTER TABLE ${table}
        ADD COLUMN start_time TIME NOT NULL DEFAULT '09:00:00' AFTER ${after},
        ADD COLUMN duration_minutes SMALLINT NOT NULL DEFAULT 480 AFTER start_time`);
      console.log(`Upgraded: ${table} now have a start time and duration.`);
    }
  }
  await conn.query(`ALTER TABLE bookings MODIFY status
    ENUM('pending','accepted','started','in_progress','completed','rejected','cancelled','expired') NOT NULL DEFAULT 'pending'`);
  await conn.query(`ALTER TABLE applications MODIFY status
    ENUM('pending','accepted','rejected','expired') NOT NULL DEFAULT 'pending'`);

  // Start a new area list with defaults, plus any areas labourers already use so their profiles stay valid.
  const [[{ areaCount }]] = await conn.query('SELECT COUNT(*) AS areaCount FROM areas');
  if (!areaCount) {
    await conn.query('INSERT IGNORE INTO areas (name) VALUES ?', [AREAS.map(a => [a])]);
    await conn.query('INSERT IGNORE INTO areas (name) SELECT DISTINCT area FROM labourer_profiles');
  }
}

async function main() {
  const reset = process.argv.includes('--reset');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true' ? { ca: process.env.DB_SSL_CA, rejectUnauthorized: true } : undefined,
    multipleStatements: true,
  });

  if (reset) {
    await conn.query('DROP TABLE IF EXISTS reviews, bookings, applications, jobs, labourer_profiles, areas, users');
    console.log('Dropped existing tables.');
  }
  await conn.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  await migrate(conn);
  console.log('Tables ready.');

  const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM users');
  if (n > 0) {
    console.log('Data already exists, skipping demo data. Use --reset to start fresh.');
    return conn.end();
  }

  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const demoHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  await conn.query(
    "INSERT INTO users (name, email, phone, password_hash, role) VALUES ('Admin', 'admin@9to5.local', '9800000000', ?, 'admin')",
    [adminHash]
  );
  const [poster] = await conn.query(
    "INSERT INTO users (name, email, phone, password_hash, role) VALUES ('Priya Shah', 'poster@demo.in', '9810000001', ?, 'poster')",
    [demoHash]
  );
  for (const [name, email, phone, trades, area, rate, skills, exp, verified] of LABOURERS) {
    const [u] = await conn.query(
      "INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, 'labourer')",
      [name, email, phone, demoHash]
    );
    await conn.query(
      'INSERT INTO labourer_profiles (user_id, trades, area, daily_rate, skills, experience, verified) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [u.insertId, trades, area, rate, skills, exp, verified]
    );
  }
  const inDays = d => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  await conn.query(
    `INSERT INTO jobs (poster_id, title, trade, location, address, budget, job_date, start_time, duration_minutes, details) VALUES
     (?, 'Fix bathroom leak', 'Plumber', 'Bandra', '12 Hill Road, Bandra West, Mumbai 400050', 500, ?, '10:00', 120, 'Water leaking under the wash basin.'),
     (?, 'Replace kitchen tap', 'Plumber', 'Andheri', '7 Versova Road, Andheri West, Mumbai 400061', 400, ?, '11:00', 90, 'New tap is ready, just needs fitting.'),
     (?, 'Paint 2BHK living room', 'Painter', 'Andheri', '4B Lokhandwala Complex, Andheri West, Mumbai 400053', 4500, ?, '09:00', 480, 'Walls only, paint will be provided.'),
     (?, 'Install 3 ceiling fans', 'Electrician', 'Powai', 'Hiranandani Gardens, Powai, Mumbai 400076', 900, ?, '14:00', 180, 'Fans already bought, need fitting + wiring check.')`,
    // The first two overlap (10:00-12:00 and 11:00-12:30 on the same day) to show that a labourer can only take one.
    [poster.insertId, inDays(3), poster.insertId, inDays(3), poster.insertId, inDays(7), poster.insertId, inDays(5)]
  );

  console.log('Demo data added:');
  console.log(`  Admin     admin@9to5.local / ${ADMIN_PASSWORD}   (login at /admin-login)`);
  console.log(`  Poster    poster@demo.in   / ${DEMO_PASSWORD}`);
  console.log(`  Labourer  ram@demo.in      / ${DEMO_PASSWORD}   (also meena@, suresh@, anil@, ravi@demo.in)`);
  await conn.end();
}

main().catch(err => {
  console.error('Database setup failed:', err.message);
  process.exit(1);
});
