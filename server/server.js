require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { loadUser } = require('./middleware/auth');
const { TRADES } = require('./validate');
const { query } = require('./db');

const app = express();

// Hosting platforms sit behind one reverse proxy; trust it so rate limits and secure cookies see the real client.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

// The only third-party frame allowed is the Google Maps embed on bookings.
app.use(helmet({
  contentSecurityPolicy: { directives: { frameSrc: ["'self'", 'https://www.google.com', 'https://maps.google.com'] } },
}));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(loadUser);

app.get('/api/trades', (req, res) => res.json({ trades: TRADES }));
app.get('/api/areas', async (req, res) => {
  const rows = await query('SELECT name FROM areas ORDER BY name');
  res.json({ areas: rows.map(r => r.name) });
});
app.use('/api/auth', require('./routes/auth'));
app.use('/api/labourers', require('./routes/labourers'));
app.use('/api/jobs', require('./routes/jobs'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

// Express 5 forwards errors thrown in async handlers here.
app.use((err, req, res, next) => {
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => console.log(`9 to 5 running at http://localhost:${port}`));
