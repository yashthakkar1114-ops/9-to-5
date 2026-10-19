const express = require('express');
const { pool, query } = require('../db');
const v = require('../validate');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

function readJob(b) {
  return {
    title: v.str(b.title, 'Job title', { min: 3, max: 150 }),
    trade: v.trade(b.trade),
    location: v.str(b.location, 'Location', { max: 100 }),
    budget: v.int(b.budget, 'Budget', { min: 100, max: 10000000 }),
    job_date: v.date(b.job_date, 'Job date'),
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

// GET /api/jobs?q=&trade=&location= -> open jobs (public)
router.get('/', async (req, res) => {
  const where = ["j.status = 'open'", "u.status = 'active'"];
  const params = [];
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
  const jobs = await query(
    `SELECT j.id, j.title, j.trade, j.location, j.budget, j.job_date, j.details, j.created_at,
       u.name AS poster_name,
       (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id) AS applicant_count,
       EXISTS(SELECT 1 FROM applications a WHERE a.job_id = j.id AND a.labourer_id = ?) AS has_applied
     FROM jobs j JOIN users u ON u.id = j.poster_id
     WHERE ${where.join(' AND ')}
     ORDER BY j.created_at DESC LIMIT 100`,
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
          WHERE b.job_id = j.id AND b.status IN ('accepted','completed') LIMIT 1) AS hired_name
     FROM jobs j WHERE j.poster_id = ? ORDER BY j.created_at DESC`,
    [req.user.id]
  );
  res.json({ jobs });
});

// GET /api/jobs/applied -> labourer's applications
router.get('/applied', requireRole('labourer'), async (req, res) => {
  const applications = await query(
    `SELECT a.id, a.status, a.message, a.created_at, j.id AS job_id, j.title, j.trade, j.location,
       j.budget, j.job_date, j.status AS job_status, u.name AS poster_name
     FROM applications a JOIN jobs j ON j.id = a.job_id JOIN users u ON u.id = j.poster_id
     WHERE a.labourer_id = ? ORDER BY a.created_at DESC`,
    [req.user.id]
  );
  res.json({ applications });
});

// POST /api/jobs -> create job (poster)
router.post('/', requireRole('poster'), async (req, res) => {
  const job = readJob(req.body);
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
    await query('UPDATE jobs SET ? WHERE id = ?', [readJob(req.body), job.id]);
  }
  res.json({ ok: true });
});

// GET /api/jobs/:id/applications -> applicants for a poster's job
router.get('/:id/applications', requireRole('poster'), async (req, res) => {
  const job = await ownJob(req, res);
  if (!job) return;
  const applications = await query(
    `SELECT a.id, a.status, a.message, a.created_at, u.id AS labourer_id, u.name, u.phone,
       p.trade, p.area, p.daily_rate, p.experience, p.verified, p.rating_avg, p.rating_count
     FROM applications a JOIN users u ON u.id = a.labourer_id JOIN labourer_profiles p ON p.user_id = u.id
     WHERE a.job_id = ? ORDER BY a.created_at`,
    [job.id]
  );
  res.json({ job, applications });
});

// POST /api/jobs/:id/apply { message } (labourer)
router.post('/:id/apply', requireRole('labourer'), async (req, res) => {
  const message = v.str(req.body.message, 'Message', { optional: true });
  const [job] = await query("SELECT id, status FROM jobs WHERE id = ?", [req.params.id]);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (job.status !== 'open') throw new v.BadRequest('This job is no longer open.');
  try {
    await query('INSERT INTO applications (job_id, labourer_id, message) VALUES (?, ?, ?)', [job.id, req.user.id, message]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new v.BadRequest('You have already applied to this job.');
    throw err;
  }
  res.status(201).json({ ok: true });
});

// POST /api/jobs/:id/hire { application_id } (poster) -> creates an accepted booking
router.post('/:id/hire', requireRole('poster'), async (req, res) => {
  const job = await ownJob(req, res);
  if (!job) return;
  if (job.status !== 'open') throw new v.BadRequest('This job is not open.');
  const [app] = await query('SELECT * FROM applications WHERE id = ? AND job_id = ?', [req.body.application_id, job.id]);
  if (!app) return res.status(404).json({ error: 'Application not found.' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("UPDATE applications SET status = IF(id = ?, 'accepted', 'rejected') WHERE job_id = ?", [app.id, job.id]);
    await conn.query("UPDATE jobs SET status = 'assigned' WHERE id = ?", [job.id]);
    await conn.query(
      "INSERT INTO bookings (job_id, poster_id, labourer_id, booking_date, amount, note, status) VALUES (?, ?, ?, ?, ?, ?, 'accepted')",
      [job.id, req.user.id, app.labourer_id, job.job_date, job.budget, job.title]
    );
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
