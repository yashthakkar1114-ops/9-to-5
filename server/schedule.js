// A labourer can't hold two overlapping time slots. A slot is taken once a booking is accepted
// (or the work has started); pending requests and finished or cancelled bookings don't block anything.
const BUSY = ['accepted', 'started', 'in_progress'];

// SQL that is true when labourer `lab` has a taken slot overlapping the slot starting at
// (`day`, `start`) and lasting `minutes`. Arguments are SQL expressions (columns or '?').
// Two slots overlap when each one starts before the other ends.
function overlapSql(lab, day, start, minutes, excludeBooking = '0') {
  return `EXISTS (SELECT 1 FROM bookings x
    WHERE x.labourer_id = ${lab} AND x.status IN ('${BUSY.join("','")}') AND x.id <> ${excludeBooking}
      AND TIMESTAMP(x.booking_date, x.start_time) < TIMESTAMP(${day}, ${start}) + INTERVAL ${minutes} MINUTE
      AND TIMESTAMP(x.booking_date, x.start_time) + INTERVAL x.duration_minutes MINUTE > TIMESTAMP(${day}, ${start}))`;
}

// The first taken slot of this labourer that overlaps the given one, or null. `db` is the pool or a transaction connection.
async function findClash(db, labourerId, { date, start_time, duration_minutes }, excludeBooking = 0) {
  const [rows] = await db.query(
    `SELECT b.id, b.booking_date, b.start_time, b.duration_minutes, b.note FROM bookings b
     WHERE b.labourer_id = ? AND b.status IN (?) AND b.id <> ?
       AND TIMESTAMP(b.booking_date, b.start_time) < TIMESTAMP(?, ?) + INTERVAL ? MINUTE
       AND TIMESTAMP(b.booking_date, b.start_time) + INTERVAL b.duration_minutes MINUTE > TIMESTAMP(?, ?)
     ORDER BY b.booking_date, b.start_time LIMIT 1`,
    [labourerId, BUSY, excludeBooking, date, start_time, duration_minutes, date, start_time]
  );
  return rows[0] || null;
}

// Inside a transaction: lock the labourer's row so two hires/accepts for them can't both pass the check.
async function lockLabourer(conn, labourerId) {
  await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [labourerId]);
}

// Once a labourer is confirmed for a slot (hired, or accepted a request), every other pending application and
// booking request of theirs that overlaps it expires: the first poster to confirm wins.
// Call inside the confirming transaction, after the confirmed booking/application is no longer 'pending'.
async function expireOverlapping(conn, labourerId, { date, start_time, duration_minutes }) {
  const overlaps = (day, start, mins) => `TIMESTAMP(${day}, ${start}) < TIMESTAMP(?, ?) + INTERVAL ? MINUTE
      AND TIMESTAMP(${day}, ${start}) + INTERVAL ${mins} MINUTE > TIMESTAMP(?, ?)`;
  const slot = [date, start_time, duration_minutes, date, start_time];
  const [apps] = await conn.query(
    `UPDATE applications a JOIN jobs j ON j.id = a.job_id SET a.status = 'expired'
     WHERE a.labourer_id = ? AND a.status = 'pending' AND ${overlaps('j.job_date', 'j.start_time', 'j.duration_minutes')}`,
    [labourerId, ...slot]
  );
  const [reqs] = await conn.query(
    `UPDATE bookings b SET b.status = 'expired'
     WHERE b.labourer_id = ? AND b.status = 'pending' AND ${overlaps('b.booking_date', 'b.start_time', 'b.duration_minutes')}`,
    [labourerId, ...slot]
  );
  return { applications: apps.affectedRows, requests: reqs.affectedRows };
}

// '2026-10-22', '10:00:00', 120 -> '22 Oct, 10:00 am – 12:00 pm'
function slotLabel(day, start, minutes) {
  const [h, m] = String(start).split(':').map(Number);
  const fmt = mins => {
    const hh = Math.floor(mins / 60) % 24, mm = mins % 60;
    return `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`;
  };
  const begin = h * 60 + m;
  const d = new Date(`${String(day).slice(0, 10)}T00:00:00`);
  const dayText = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `${dayText}, ${fmt(begin)} – ${fmt(begin + Number(minutes))}`;
}

function clashMessage(clash, who) {
  const when = slotLabel(clash.booking_date, clash.start_time, clash.duration_minutes);
  return `${who} already booked on ${when}${clash.note ? ` (${clash.note})` : ''}. Pick a time that doesn't overlap.`;
}

module.exports = { BUSY, overlapSql, findClash, lockLabourer, expireOverlapping, slotLabel, clashMessage };
