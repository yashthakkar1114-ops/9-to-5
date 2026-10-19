const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { pool, query } = require('../db');
const v = require('../validate');
const { setAuthCookie, clearAuthCookie, requireRole } = require('../middleware/auth');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
});

// POST /api/auth/register  { role: 'labourer' | 'poster', name, email, phone, password, ...labourer fields }
router.post('/register', authLimiter, async (req, res) => {
  const b = req.body;
  if (!['labourer', 'poster'].includes(b.role)) throw new v.BadRequest('Invalid account type.');
  const name = v.str(b.name, 'Name', { min: 2, max: 100 });
  const email = v.email(b.email);
  const phone = v.phone(b.phone);
  const password = v.str(b.password, 'Password', { min: 6, max: 72 });

  let profile;
  if (b.role === 'labourer') {
    profile = {
      trade: v.trade(b.trade),
      area: v.str(b.area, 'Area', { max: 100 }),
      daily_rate: v.int(b.daily_rate, 'Daily rate', { min: 100, max: 100000 }),
      skills: v.str(b.skills, 'Skills', { optional: true }),
      experience: v.int(b.experience || 0, 'Experience', { max: 60 }),
    };
  }

  const [existing] = await query('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });

  const hash = await bcrypt.hash(password, 10);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      'INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [name, email, phone, hash, b.role]
    );
    if (profile) {
      await conn.query('INSERT INTO labourer_profiles SET ?', [{ user_id: r.insertId, ...profile }]);
    }
    await conn.commit();
    const user = { id: r.insertId, name, email, phone, role: b.role };
    setAuthCookie(res, user);
    res.status(201).json({ user });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// POST /api/auth/login  { email, password, role }
router.post('/login', authLimiter, async (req, res) => {
  const email = v.email(req.body.email);
  const password = v.str(req.body.password, 'Password');
  const [user] = await query('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Wrong email or password.' });
  }
  if (req.body.role && req.body.role !== user.role) {
    const label = { labourer: 'Labourer', poster: 'Job Poster', admin: 'Admin' }[user.role];
    const article = user.role === 'admin' ? 'an' : 'a';
    return res.status(401).json({ error: `This is ${article} ${label} account. Please use the ${label} login.` });
  }
  if (user.status !== 'active') return res.status(403).json({ error: 'Your account has been blocked. Contact support.' });

  setAuthCookie(res, user);
  res.json({ user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role } });
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

// GET /api/auth/me -> current user or null
router.get('/me', (req, res) => {
  res.json({ user: req.user || null });
});

// PATCH /api/auth/password  { current, next }
router.patch('/password', requireRole(), async (req, res) => {
  const current = v.str(req.body.current, 'Current password');
  const next = v.str(req.body.next, 'New password', { min: 6, max: 72 });
  const [user] = await query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!(await bcrypt.compare(current, user.password_hash))) {
    return res.status(400).json({ error: 'Current password is wrong.' });
  }
  await query('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(next, 10), req.user.id]);
  res.json({ ok: true });
});

module.exports = router;
