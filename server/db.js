const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  // Most hosted MySQL providers require an encrypted connection.
  ssl: process.env.DB_SSL === 'true' ? { ca: process.env.DB_SSL_CA, rejectUnauthorized: true } : undefined,
  connectionLimit: 10,
  dateStrings: true,
});

// Returns rows for SELECTs, or the result header (insertId, affectedRows) for writes.
async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

module.exports = { pool, query };
