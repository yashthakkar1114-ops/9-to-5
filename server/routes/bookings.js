const crypto = require('crypto');
const express = require('express');
const { pool, query } = require('../db');
const v = require('../validate');
const { requireRole } = require('../middleware/auth');
const { overlapSql, findClash, lockLabourer, expireOverlapping, clashMessage } = require('../schedule');

const router = express.Router();

// Who may move a booking from which status to which.
// Work is tracked accepted -> started -> in_progress -> completed, mostly by the labourer;
// the poster can also mark it done (e.g. if the labourer never updated it).
const ACTIONS = {
  accept:   { roles: ['labourer'], from: ['pending'], to: 'accepted' },
  reject:   { roles: ['labourer'], from: ['pending'], to: 'rejected' },
  start:    { roles: ['labourer'], from: ['accepted'], to: 'started' },
  progress: { roles: ['labourer'], from: ['started'], to: 'in_progress' },
  complete: { roles: ['labourer', 'poster'], from: ['accepted', 'started', 'in_progress'], to: 'completed' },
  cancel:   { roles: ['poster'], from: ['pending', 'accepted'], to: 'cancelled' },
};

// Contact details are only shared once the labourer has agreed to the work.
const CONFIRMED = ['accepted', 'started', 'in_progress', 'completed'];
const PAYMENT_METHODS = ['upi', 'card', 'netbanking'];

// GET /api/bookings -> bookings for the logged-in poster or labourer
router.get('/', requireRole('poster', 'labourer'), async (req, res) => {
  const mine = req.user.role === 'poster' ? 'b.poster_id' : 'b.labourer_id';
  const other = req.user.role === 'poster' ? 'b.labourer_id' : 'b.poster_id';
  const rows = await query(
    `SELECT b.id, b.job_id, b.booking_date, b.start_time, b.duration_minutes, b.amount, b.note, b.address, b.status, b.created_at,
       b.paid_at, b.payment_method, b.payment_ref,
       o.id AS other_id, o.name AS other_name, o.phone AS other_phone,
       COALESCE(j.trade, p.trades) AS trade, r.rating, r.comment,
       (b.status = 'pending' AND ${overlapSql('b.labourer_id', 'b.booking_date', 'b.start_time', 'b.duration_minutes', 'b.id')}) AS clash
     FROM bookings b
     JOIN users o ON o.id = ${other}
     LEFT JOIN jobs j ON j.id = b.job_id
     LEFT JOIN labourer_profiles p ON p.user_id = b.labourer_id
     LEFT JOIN reviews r ON r.booking_id = b.id
     WHERE ${mine} = ?
     ORDER BY FIELD(b.status, 'pending', 'accepted', 'started', 'in_progress', 'completed', 'rejected', 'cancelled', 'expired'), b.booking_date, b.start_time`,
    [req.user.id]
  );
  for (const b of rows) {
    if (!CONFIRMED.includes(b.status)) {
      b.other_phone = null;
      if (req.user.role === 'labourer') b.address = null;
    }
  }
  res.json({ bookings: rows });
});

// POST /api/bookings { labourer_id, booking_date, start_time, duration_minutes, amount, address, note } (poster books directly)
router.post('/', requireRole('poster'), async (req, res) => {
  const labourerId = v.int(req.body.labourer_id, 'Labourer', { min: 1 });
  const when = v.slot(req.body.booking_date, req.body.start_time, req.body.duration_minutes, 'Booking date');
  const booking = {
    poster_id: req.user.id,
    labourer_id: labourerId,
    booking_date: when.date,
    start_time: when.start_time,
    duration_minutes: when.duration_minutes,
    amount: v.int(req.body.amount, 'Amount', { min: 100, max: 10000000 }),
    address: v.str(req.body.address, 'Address', { min: 5, max: 255 }),
    note: v.str(req.body.note, 'Note', { optional: true }),
  };
  const [lab] = await query(
    `SELECT u.name, p.available FROM users u JOIN labourer_profiles p ON p.user_id = u.id
     WHERE u.id = ? AND u.status = 'active'`,
    [labourerId]
  );
  if (!lab) return res.status(404).json({ error: 'Labourer not found.' });
  if (!lab.available) throw new v.BadRequest('This labourer is not taking work right now.');
  const clash = await findClash(pool, labourerId, when);
  if (clash) throw new v.BadRequest(clashMessage(clash, `${lab.name} is`));
  const r = await query('INSERT INTO bookings SET ?', [booking]);
  res.status(201).json({ id: r.insertId });
});

// PATCH /api/bookings/:id { action: accept | reject | start | progress | complete | cancel }
router.patch('/:id', requireRole('poster', 'labourer'), async (req, res) => {
  const rule = ACTIONS[req.body.action];
  if (!rule || !rule.roles.includes(req.user.role)) throw new v.BadRequest('Invalid action.');
  const [b] = await query('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
  const ownerId = req.user.role === 'poster' ? b?.poster_id : b?.labourer_id;
  if (!b || ownerId !== req.user.id) return res.status(404).json({ error: 'Booking not found.' });
  if (!rule.from.includes(b.status)) {
    throw new v.BadRequest(`A booking that is ${b.status.replace('_', ' ')} cannot be changed this way.`);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (rule.to === 'accepted') {
      // Accepting takes the time slot, so it must not overlap work the labourer already took.
      await lockLabourer(conn, b.labourer_id);
      const clash = await findClash(conn, b.labourer_id,
        { date: b.booking_date, start_time: b.start_time, duration_minutes: b.duration_minutes }, b.id);
      if (clash) throw new v.BadRequest(clashMessage(clash, 'You are'));
    }
    const [moved] = await conn.query('UPDATE bookings SET status = ? WHERE id = ? AND status = ?', [rule.to, b.id, b.status]);
    if (!moved.affectedRows) throw new v.BadRequest('This booking changed in the meantime. Please refresh.');
    if (rule.to === 'accepted') {
      // Accepting confirms the slot, so the labourer's other overlapping applications and requests expire.
      await expireOverlapping(conn, b.labourer_id, { date: b.booking_date, start_time: b.start_time, duration_minutes: b.duration_minutes });
    }
    if (b.job_id) {
      // Keep the linked job in step: reopen it if the hire falls through, close it when done.
      if (rule.to === 'completed') {
        await conn.query("UPDATE jobs SET status = 'closed' WHERE id = ?", [b.job_id]);
      } else if (['cancelled', 'rejected'].includes(rule.to)) {
        await conn.query("UPDATE jobs SET status = 'open' WHERE id = ?", [b.job_id]);
        // Reopen the other applicants, except those who expired because they took another job meanwhile.
        await conn.query(
          "UPDATE applications SET status = 'pending' WHERE job_id = ? AND labourer_id <> ? AND status <> 'expired'",
          [b.job_id, b.labourer_id]
        );
        await conn.query("UPDATE applications SET status = 'rejected' WHERE job_id = ? AND labourer_id = ?", [b.job_id, b.labourer_id]);
      }
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  res.json({ ok: true, status: rule.to });
});

// POST /api/bookings/:id/pay { method, amount? } (poster, after completion). Mock payment: no money moves.
// The poster may pay more or less than agreed (e.g. a tip or a shorter job); the amount paid is what's recorded.
router.post('/:id/pay', requireRole('poster'), async (req, res) => {
  const method = req.body.method;
  if (!PAYMENT_METHODS.includes(method)) throw new v.BadRequest('Choose a payment method.');
  const [b] = await query('SELECT * FROM bookings WHERE id = ? AND poster_id = ?', [req.params.id, req.user.id]);
  if (!b) return res.status(404).json({ error: 'Booking not found.' });
  if (b.status !== 'completed') throw new v.BadRequest('You can pay once the work is completed.');
  if (b.paid_at) throw new v.BadRequest('This booking is already paid.');
  const amount = req.body.amount === undefined ? b.amount : v.int(req.body.amount, 'Amount', { min: 1, max: 10000000 });
  const ref = 'MOCK' + crypto.randomBytes(5).toString('hex').toUpperCase();
  const r = await query(
    'UPDATE bookings SET paid_at = NOW(), payment_method = ?, payment_ref = ?, amount = ? WHERE id = ? AND paid_at IS NULL',
    [method, ref, amount, b.id]
  );
  if (!r.affectedRows) throw new v.BadRequest('This booking is already paid.');
  res.json({ ok: true, payment_ref: ref, amount });
});

// POST /api/bookings/:id/review { rating 1-5, comment } (poster, after completion)
router.post('/:id/review', requireRole('poster'), async (req, res) => {
  const rating = v.int(req.body.rating, 'Rating', { min: 1, max: 5 });
  const comment = v.str(req.body.comment, 'Comment', { optional: true, max: 500 });
  const [b] = await query('SELECT * FROM bookings WHERE id = ? AND poster_id = ?', [req.params.id, req.user.id]);
  if (!b) return res.status(404).json({ error: 'Booking not found.' });
  if (b.status !== 'completed') throw new v.BadRequest('You can only review completed work.');
  try {
    await query('INSERT INTO reviews (booking_id, rating, comment) VALUES (?, ?, ?)', [b.id, rating, comment]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new v.BadRequest('You have already reviewed this booking.');
    throw err;
  }
  await query(
    `UPDATE labourer_profiles p SET
       p.rating_count = (SELECT COUNT(*) FROM reviews r JOIN bookings b ON b.id = r.booking_id WHERE b.labourer_id = p.user_id),
       p.rating_avg = (SELECT IFNULL(ROUND(AVG(r.rating), 1), 0) FROM reviews r JOIN bookings b ON b.id = r.booking_id WHERE b.labourer_id = p.user_id)
     WHERE p.user_id = ?`,
    [b.labourer_id]
  );
  res.status(201).json({ ok: true });
});

module.exports = router;
