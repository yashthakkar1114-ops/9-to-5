const express = require('express');
const { query } = require('../db');
const v = require('../validate');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

const PUBLIC_FIELDS = `u.id, u.name, p.trade, p.area, p.daily_rate, p.skills, p.experience,
  p.available, p.verified, p.rating_avg, p.rating_count`;

// GET /api/labourers?q=&trade=&area=
router.get('/', async (req, res) => {
  const where = ["u.status = 'active'"];
  const params = [];
  if (req.query.trade) {
    where.push('p.trade = ?');
    params.push(req.query.trade);
  }
  if (req.query.area) {
    where.push('p.area LIKE ?');
    params.push(`%${req.query.area}%`);
  }
  if (req.query.q) {
    where.push('(u.name LIKE ? OR p.skills LIKE ? OR p.trade LIKE ?)');
    params.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`);
  }
  const rows = await query(
    `SELECT ${PUBLIC_FIELDS} FROM users u JOIN labourer_profiles p ON p.user_id = u.id
     WHERE ${where.join(' AND ')}
     ORDER BY p.available DESC, p.verified DESC, p.rating_avg DESC, u.created_at DESC
     LIMIT 100`,
    params
  );
  res.json({ labourers: rows });
});

// GET /api/labourers/me -> own profile (labourer only)
router.get('/me', requireRole('labourer'), async (req, res) => {
  const [profile] = await query(
    `SELECT ${PUBLIC_FIELDS}, u.email, u.phone FROM users u JOIN labourer_profiles p ON p.user_id = u.id WHERE u.id = ?`,
    [req.user.id]
  );
  res.json({ profile });
});

// PUT /api/labourers/me -> update own profile
router.put('/me', requireRole('labourer'), async (req, res) => {
  const b = req.body;
  const name = v.str(b.name, 'Name', { min: 2, max: 100 });
  const phone = v.phone(b.phone);
  const profile = {
    trade: v.trade(b.trade),
    area: v.str(b.area, 'Area', { max: 100 }),
    daily_rate: v.int(b.daily_rate, 'Daily rate', { min: 100, max: 100000 }),
    skills: v.str(b.skills, 'Skills', { optional: true }),
    experience: v.int(b.experience || 0, 'Experience', { max: 60 }),
    available: Boolean(b.available),
  };
  await query('UPDATE users SET name = ?, phone = ? WHERE id = ?', [name, phone, req.user.id]);
  await query('UPDATE labourer_profiles SET ? WHERE user_id = ?', [profile, req.user.id]);
  res.json({ ok: true });
});

// GET /api/labourers/:id -> public profile with recent reviews
router.get('/:id', async (req, res) => {
  const [labourer] = await query(
    `SELECT ${PUBLIC_FIELDS} FROM users u JOIN labourer_profiles p ON p.user_id = u.id
     WHERE u.id = ? AND u.status = 'active'`,
    [req.params.id]
  );
  if (!labourer) return res.status(404).json({ error: 'Labourer not found.' });
  const reviews = await query(
    `SELECT r.rating, r.comment, r.created_at, u.name AS reviewer
     FROM reviews r JOIN bookings b ON b.id = r.booking_id JOIN users u ON u.id = b.poster_id
     WHERE b.labourer_id = ? ORDER BY r.created_at DESC LIMIT 10`,
    [labourer.id]
  );
  res.json({ labourer, reviews });
});

module.exports = router;
