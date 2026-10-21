const express = require('express');
const { query } = require('../db');
const v = require('../validate');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('admin'));

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  const [stats] = await query(`SELECT
    (SELECT COUNT(*) FROM users WHERE role = 'labourer') AS labourers,
    (SELECT COUNT(*) FROM users WHERE role = 'poster') AS posters,
    (SELECT COUNT(*) FROM labourer_profiles WHERE verified = FALSE) AS unverified,
    (SELECT COUNT(*) FROM users WHERE status = 'blocked') AS blocked,
    (SELECT COUNT(*) FROM jobs WHERE status = 'open') AS open_jobs,
    (SELECT COUNT(*) FROM jobs) AS total_jobs,
    (SELECT COUNT(*) FROM bookings WHERE status IN ('pending','accepted','started','in_progress')) AS active_bookings,
    (SELECT COUNT(*) FROM bookings WHERE status = 'completed') AS completed_bookings`);
  res.json({ stats });
});

// GET /api/admin/users?role=&q=
router.get('/users', async (req, res) => {
  const where = ["u.role <> 'admin'"];
  const params = [];
  if (['labourer', 'poster'].includes(req.query.role)) {
    where.push('u.role = ?');
    params.push(req.query.role);
  }
  if (req.query.q) {
    where.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)');
    params.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`);
  }
  const users = await query(
    `SELECT u.id, u.name, u.email, u.phone, u.role, u.status, u.created_at, p.trades, p.area, p.verified
     FROM users u LEFT JOIN labourer_profiles p ON p.user_id = u.id
     WHERE ${where.join(' AND ')} ORDER BY u.created_at DESC LIMIT 200`,
    params
  );
  res.json({ users });
});

// PATCH /api/admin/users/:id { status: 'active'|'blocked' } or { verified: true|false }
router.patch('/users/:id', async (req, res) => {
  const [user] = await query("SELECT id, role FROM users WHERE id = ? AND role <> 'admin'", [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (req.body.status !== undefined) {
    if (!['active', 'blocked'].includes(req.body.status)) throw new v.BadRequest('Invalid status.');
    await query('UPDATE users SET status = ? WHERE id = ?', [req.body.status, user.id]);
  }
  if (req.body.verified !== undefined) {
    if (user.role !== 'labourer') throw new v.BadRequest('Only labourers can be verified.');
    await query('UPDATE labourer_profiles SET verified = ? WHERE user_id = ?', [Boolean(req.body.verified), user.id]);
  }
  res.json({ ok: true });
});

// GET /api/admin/jobs
router.get('/jobs', async (req, res) => {
  const jobs = await query(
    `SELECT j.id, j.title, j.trade, j.location, j.budget, j.job_date, j.start_time, j.duration_minutes, j.status, j.created_at, u.name AS poster_name
     FROM jobs j JOIN users u ON u.id = j.poster_id ORDER BY j.created_at DESC LIMIT 200`
  );
  res.json({ jobs });
});

// DELETE /api/admin/jobs/:id
router.delete('/jobs/:id', async (req, res) => {
  const r = await query('DELETE FROM jobs WHERE id = ?', [req.params.id]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Job not found.' });
  res.json({ ok: true });
});

// GET /api/admin/bookings
router.get('/bookings', async (req, res) => {
  const bookings = await query(
    `SELECT b.id, b.booking_date, b.start_time, b.duration_minutes, b.amount, b.status, b.paid_at, b.created_at, p.name AS poster_name, l.name AS labourer_name
     FROM bookings b JOIN users p ON p.id = b.poster_id JOIN users l ON l.id = b.labourer_id
     ORDER BY b.created_at DESC LIMIT 200`
  );
  res.json({ bookings });
});

// GET /api/admin/areas -> areas with how many labourers use each
router.get('/areas', async (req, res) => {
  const areas = await query(
    `SELECT a.id, a.name, a.created_at, COUNT(p.user_id) AS labourer_count
     FROM areas a LEFT JOIN labourer_profiles p ON p.area = a.name
     GROUP BY a.id ORDER BY a.name`
  );
  res.json({ areas });
});

// POST /api/admin/areas { name }
router.post('/areas', async (req, res) => {
  const name = v.str(req.body.name, 'Area name', { min: 2, max: 100 });
  try {
    const r = await query('INSERT INTO areas (name) VALUES (?)', [name]);
    res.status(201).json({ id: r.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That area already exists.' });
    throw err;
  }
});

// DELETE /api/admin/areas/:id (only if no labourer is using it)
router.delete('/areas/:id', async (req, res) => {
  const [area] = await query(
    `SELECT a.id, COUNT(p.user_id) AS used FROM areas a LEFT JOIN labourer_profiles p ON p.area = a.name
     WHERE a.id = ? GROUP BY a.id`,
    [req.params.id]
  );
  if (!area) return res.status(404).json({ error: 'Area not found.' });
  if (area.used) throw new v.BadRequest(`${area.used} labourer(s) work in this area, so it cannot be removed.`);
  await query('DELETE FROM areas WHERE id = ?', [area.id]);
  res.json({ ok: true });
});

module.exports = router;
