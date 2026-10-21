const express = require('express');
const { pool, query } = require('../db');
const v = require('../validate');
const { requireRole } = require('../middleware/auth');
const { overlapSql, findClash, lockLabourer, expireOverlapping, clashMessage } = require('../schedule');

const router = express.Router();

// Location must be one of the admin's areas; an edited job may keep its current location.
async function readJob(b, currentLocation) {
  const when = v.slot(b.job_date, b.start_time, b.duration_minutes);
  return {
    title: v.str(b.title, 'Job title', { min: 3, max: 150 }),
    trade: v.trade(b.trade),
    location: currentLocation && b.location === currentLocation ? currentLocation : await v.area(b.location),
    address: v.str(b.address, 'Full address', { min: 5, max: 255 }),
    budget: v.int(b.budget, 'Budget', { min: 100, max: 10000000 }),
    job_date: when.date,
    start_time: when.start_time,
    duration_minutes: when.duration_minutes,
    details: v.str(b.details, 'Details', { optional: true, max: 2000 }),
  };
}

async function ownJob(req, res) {
  const [job] = await query('SELECT * FROM jobs WHERE id = ?', [req.params.id]);
  if (!job || job.poster_id !== req.user.id) {
    res.status(404).json({ error: 'Job not found.' });
    return null;
  }
  return job;
}

// GET /api/jobs?q=&trade=&location= -> open jobs (public; labourers only see jobs for their trades)
router.get('/', async (req, res) => {
  const where = ["j.status = 'open'", "u.status = 'active'"];
  const params = [];
  if (req.user?.role === 'labourer') {
    where.push('FIND_IN_SET(j.trade, (SELECT trades FROM labourer_profiles WHERE user_id = ?))');
    params.push(req.user.id);
  }
  if (req.query.trade) {
    where.push('j.trade = ?');
    params.push(req.query.trade);
  }
  if (req.query.location) {
    where.push('j.location LIKE ?');
    params.push(`%${req.query.location}%`);
  }
  if (req.query.q) {
    where.push('(j.title LIKE ? OR j.details LIKE ?)');
    params.push(`%${req.query.q}%`, `%${req.query.q}%`);
  }
  const labourerId = req.user?.role === 'labourer' ? req.user.id : 0;
  // For a labourer, flag jobs whose time slot overlaps work they've already taken.
  const jobs = await query(
    `SELECT j.id, j.title, j.trade, j.location, j.budget, j.job_date, j.start_time, j.duration_minutes, j.details, j.created_at,
       u.name AS poster_name,
       ${labourerId ? overlapSql(Number(labourerId), 'j.job_date', 'j.start_time', 'j.duration_minutes') : 'FALSE'} AS clash,
       (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id) AS applicant_count,
       (SELECT a.status FROM applications a WHERE a.job_id = j.id AND a.labourer_id = ?) AS my_application
     FROM jobs j JOIN users u ON u.id = j.poster_id
     WHERE ${where.join(' AND ')}
     ORDER BY j.job_date, j.start_time LIMIT 100`,
    [labourerId, ...params]
  );
  res.json({ jobs });
});

// GET /api/jobs/mine -> poster's own jobs
router.get('/mine', requireRole('poster'), async (req, res) => {
  const jobs = await query(
    `SELECT j.*,
       (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id AND a.status = 'pending') AS pending_count,
       (SELECT u.name FROM bookings b JOIN users u ON u.id = b.labourer_id
          WHERE b.job_id = j.id AND b.status IN ('accepted','started','in_progress','completed') LIMIT 1) AS hired_name,
       (SELECT b.status FROM bookings b
          WHERE b.job_id = j.id AND b.status IN ('accepted','started','in_progress','completed') LIMIT 1) AS work_status
     FROM jobs j WHERE j.poster_id = ? ORDER BY j.created_at DESC`,
    [req.user.id]
  );
  res.json({ jobs });
});

// GET /api/jobs/applied -> labourer's applications
router.get('/applied', requireRole('labourer'), async (req, res) => {
  const applications = await query(
    `SELECT a.id, a.status, a.message, a.created_at, j.id AS job_id, j.title, j.trade, j.location, j.address,
       j.budget, j.job_date, j.start_time, j.duration_minutes, j.status AS job_status, u.name AS poster_name,
       (SELECT b.status FROM bookings b WHERE b.job_id = j.id AND b.labourer_id = a.labourer_id
          ORDER BY b.id DESC LIMIT 1) AS work_status
     FROM applications a JOIN jobs j ON j.id = a.job_id JOIN users u ON u.id = j.poster_id
     WHERE a.labourer_id = ? ORDER BY a.created_at DESC`,
    [req.user.id]
  );
  // The full address is only for the labourer who was hired.
  for (const a of applications) if (a.status !== 'accepted') a.address = null;
  res.json({ applications });
});

// POST /api/jobs -> create job (poster)
router.post('/', requireRole('poster'), async (req, res) => {
  const job = await readJob(req.body);
  const r = await query('INSERT INTO jobs SET ?', [{ ...job, poster_id: req.user.id }]);
  res.status(201).json({ id: r.insertId });
});

// PATCH /api/jobs/:id -> edit an open job, or { status: 'closed' | 'open' }
router.patch('/:id', requireRole('poster'), async (req, res) => {
  const job = await ownJob(req, res);
  if (!job) return;
  if (req.body.status) {
    if (!['open', 'closed'].includes(req.body.status)) throw new v.BadRequest('Invalid status.');
    if (job.status === 'assigned') throw new v.BadRequest('This job already has a labourer hired.');
    await query('UPDATE jobs SET status = ? WHERE id = ?', [req.body.status, job.id]);
  } else {
    if (job.status !== 'open') throw new v.BadRequest('Only open jobs can be edited.');
    await query('UPDATE jobs SET ? WHERE id = ?', [await readJob(req.body, job.location), job.id]);
  }
  res.json({ ok: true });
});

// GET /api/jobs/:id/applications -> applicants for a poster's job
router.get('/:id/applications', requireRole('poster'), async (req, res) => {
  const job = await ownJob(req, res);
  if (!job) return;
  const applications = await query(
    `SELECT a.id, a.status, a.message, a.created_at, u.id AS labourer_id, u.name, u.phone,
       p.trades, p.area, p.daily_rate, p.experience, p.verified, p.rating_avg, p.rating_count,
       ${overlapSql('a.labourer_id', '?', '?', '?')} AS busy
     FROM applications a JOIN users u ON u.id = a.labourer_id JOIN labourer_profiles p ON p.user_id = u.id
     WHERE a.job_id = ? ORDER BY a.created_at`,
    [job.job_date, job.start_time, job.duration_minutes, job.job_date, job.start_time, job.id]
  );
  res.json({ job, applications });
});

// POST /api/jobs/:id/apply { message } (labourer)
router.post('/:id/apply', requireRole('labourer'), async (req, res) => {
  const message = v.str(req.body.message, 'Message', { optional: true });
  const [job] = await query(
    `SELECT j.id, j.status, j.trade, j.job_date, j.start_time, j.duration_minutes, FIND_IN_SET(j.trade, p.trades) AS fits
     FROM jobs j JOIN labourer_profiles p ON p.user_id = ? WHERE j.id = ?`,
    [req.user.id, req.params.id]
  );
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (job.status !== 'open') throw new v.BadRequest('This job is no longer open.');
  if (!job.fits) throw new v.BadRequest(`This job needs a ${job.trade}. Add that trade to your profile to apply.`);
  const clash = await findClash(pool, req.user.id, { date: job.job_date, start_time: job.start_time, duration_minutes: job.duration_minutes });
  if (clash) throw new v.BadRequest(clashMessage(clash, 'You are'));
  try {
    await query('INSERT INTO applications (job_id, labourer_id, message) VALUES (?, ?, ?)', [job.id, req.user.id, message]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new v.BadRequest('You have already applied to this job.');
    throw err;
  }
  res.status(201).json({ ok: true });
});

// POST /api/jobs/:id/applications/:appId/reject (poster) -> declines one applicant
router.post('/:id/applications/:appId/reject', requireRole('poster'), async (req, res) => {
  const job = await ownJob(req, res);
  if (!job) return;
  const r = await query(
    "UPDATE applications SET status = 'rejected' WHERE id = ? AND job_id = ? AND status = 'pending'",
    [req.params.appId, job.id]
  );
  if (!r.affectedRows) throw new v.BadRequest('This applicant has already been hired or rejected.');
  res.json({ ok: true });
});

// POST /api/jobs/:id/hire { application_id } (poster) -> creates an accepted booking
router.post('/:id/hire', requireRole('poster'), async (req, res) => {
  const job = await ownJob(req, res);
  if (!job) return;
  if (job.status !== 'open') throw new v.BadRequest('This job is not open.');
  const [app] = await query('SELECT * FROM applications WHERE id = ? AND job_id = ?', [req.body.application_id, job.id]);
  if (!app) return res.status(404).json({ error: 'Application not found.' });
  if (app.status === 'expired') throw new v.BadRequest('This application expired: the labourer was booked for another job at this time.');
  if (app.status !== 'pending') throw new v.BadRequest('This applicant was already rejected.');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // The applicant may have taken another job for this time since applying.
    await lockLabourer(conn, app.labourer_id);
    const clash = await findClash(conn, app.labourer_id, { date: job.job_date, start_time: job.start_time, duration_minutes: job.duration_minutes });
    if (clash) {
      const [[lab]] = await conn.query('SELECT name FROM users WHERE id = ?', [app.labourer_id]);
      throw new v.BadRequest(clashMessage(clash, `${lab.name} is`));
    }
    // Re-read under the lock: another poster may have just hired this labourer and expired this application.
    const [[fresh]] = await conn.query('SELECT status FROM applications WHERE id = ?', [app.id]);
    if (fresh.status !== 'pending') {
      throw new v.BadRequest('This application expired: the labourer was booked for another job at this time.');
    }
    await conn.query(
      "UPDATE applications SET status = IF(id = ?, 'accepted', 'rejected') WHERE job_id = ? AND status = 'pending'",
      [app.id, job.id]
    );
    await conn.query("UPDATE jobs SET status = 'assigned' WHERE id = ?", [job.id]);
    await conn.query(
      `INSERT INTO bookings (job_id, poster_id, labourer_id, booking_date, start_time, duration_minutes, amount, note, address, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted')`,
      [job.id, req.user.id, app.labourer_id, job.job_date, job.start_time, job.duration_minutes, job.budget, job.title, job.address || job.location]
    );
    // First poster to hire wins: the labourer's other overlapping applications and requests expire.
    await expireOverlapping(conn, app.labourer_id, { date: job.job_date, start_time: job.start_time, duration_minutes: job.duration_minutes });
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  res.json({ ok: true });
});

module.exports = router;
