// Creates the tables and demo data.  Usage: npm run db:setup   (add -- --reset to wipe everything first)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');

const DEMO_PASSWORD = 'demo1234';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';

const LABOURERS = [
  ['Ram Kumar', 'ram@demo.in', '9820000001', 'Plumber', 'Andheri', 600, 'Leak repair, pipe replacement, bathroom fittings', 8, true],
  ['Meena Patel', 'meena@demo.in', '9820000002', 'Carpenter', 'Powai', 800, 'Furniture repair, doors, modular kitchen', 12, true],
  ['Suresh Singh', 'suresh@demo.in', '9820000003', 'Electrician', 'Lower Parel', 700, 'Wiring, switchboards, fan & light fitting', 6, true],
  ['Anil Yadav', 'anil@demo.in', '9820000004', 'Painter', 'Bandra', 650, 'Wall painting, texture, waterproofing', 5, false],
  ['Ravi Shinde', 'ravi@demo.in', '9820000005', 'Mover', 'Dadar', 550, 'House shifting, loading, packing', 3, false],
];

async function main() {
  const reset = process.argv.includes('--reset');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  if (reset) {
    await conn.query('DROP TABLE IF EXISTS reviews, bookings, applications, jobs, labourer_profiles, users');
    console.log('Dropped existing tables.');
  }
  await conn.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
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
  for (const [name, email, phone, trade, area, rate, skills, exp, verified] of LABOURERS) {
    const [u] = await conn.query(
      "INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, 'labourer')",
      [name, email, phone, demoHash]
    );
    await conn.query(
      'INSERT INTO labourer_profiles (user_id, trade, area, daily_rate, skills, experience, verified) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [u.insertId, trade, area, rate, skills, exp, verified]
    );
  }
  const inDays = d => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  await conn.query(
    `INSERT INTO jobs (poster_id, title, trade, location, budget, job_date, details) VALUES
     (?, 'Fix bathroom leak', 'Plumber', 'Bandra', 500, ?, 'Water leaking under the wash basin.'),
     (?, 'Paint 2BHK living room', 'Painter', 'Andheri', 4500, ?, 'Walls only, paint will be provided.'),
     (?, 'Install 3 ceiling fans', 'Electrician', 'Powai', 900, ?, 'Fans already bought, need fitting + wiring check.')`,
    [poster.insertId, inDays(3), poster.insertId, inDays(7), poster.insertId, inDays(5)]
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
