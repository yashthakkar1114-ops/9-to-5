# 9 to 5 — Hire Local Labourers

A web app for finding and hiring local daily-wage labourers (plumbers, carpenters, electricians, painters, movers and more).

**Stack:** HTML/CSS/JavaScript frontend · Node.js + Express backend · MySQL database · JWT login in an httpOnly cookie.

## Who uses it

| Labourer | Job Poster | Admin |
|---|---|---|
| Sign up with one or more trades, an area (from the admin's list), daily rate and skills | Sign up and log in | Logs in at `/admin-login` (no public signup) |
| Browse open jobs **for their own trades** and apply | Post, edit, close and reopen jobs (with a full address) | Verify or unverify labourers |
| Accept or reject direct booking requests | Search labourers and book them directly | Block or unblock users |
| Track work: Start → In progress → Completed | Watch work progress live on the Bookings tab | Remove jobs |
| Edit profile and set availability | See applicants and hire one | Add and remove the areas labourers can pick |
| See bookings, applications, payments and ratings | Pay through a mock payment page, then leave a 1–5★ review | See stats, all bookings and payment status |

- Phone numbers and the work address (with a map pin link) are only shared once a booking is accepted.
- New passwords need 8+ characters with an uppercase letter, a lowercase letter, a number and a special character; signup shows a live checklist.
- Labourer accounts can't open the "Find Labourers" page, which is for job posters.
- Payments are **mock only**: no card or UPI details are collected and no money moves.

## Run it locally

You need Node.js 18+ and MySQL 8.

1. **Start MySQL.** On this machine, double-click `scripts/start-mysql.cmd` and keep the window open.
2. **Configure.** Copy `.env.example` to `.env` and fill in your MySQL user and password and a long random `JWT_SECRET`.
3. **Install and set up the database:**
   ```
   npm install
   npm run db:setup
   ```
   Running this on an existing database also upgrades it in place, keeping your data.
   To wipe all data and start fresh, run `npm run db:setup -- --reset`.
4. **Start the app:** run `npm run dev` (it restarts automatically on server changes) or `npm start`.
5. Open http://localhost:8080

### Demo accounts

| Role | Email | Password |
|---|---|---|
| Admin | admin@9to5.local | admin1234 |
| Job Poster | poster@demo.in | demo1234 |
| Labourer | ram@demo.in (also meena@, suresh@, anil@, ravi@demo.in) | demo1234 |

## Deploy (Render + Aiven, free)

1. Create a free MySQL service on [Aiven](https://aiven.io). Note its host, port, user, password and database name (`defaultdb`), and download its CA certificate.
2. Push this repo to GitHub, then in [Render](https://render.com) choose **New > Blueprint** and pick the repo. `render.yaml` sets up the web service.
3. Fill in `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL_CA` (paste the whole certificate) and a strong `ADMIN_PASSWORD`.
4. Every deploy runs `npm run db:setup`, which creates or upgrades the tables and seeds demo data only into an empty database.

The free Render plan sleeps after 15 minutes idle, so the first visit afterwards takes about 30 seconds.

## Project structure

```
public/            Frontend pages (served by Express)
  js/common.js     Shared helpers: API calls, header, modal, toasts
  js/*.js          One script per page
server/
  server.js        Express app
  db.js            MySQL connection pool
  schema.sql       Tables
  setup-db.js      Creates tables + demo data
  validate.js      Input validation
  middleware/      Login and role checks
  routes/          auth, labourers, jobs, bookings, admin APIs
scripts/           Local helper scripts
```

## API overview

- `POST /api/auth/register`, `/login`, `/logout`; `GET /api/auth/me`; `PATCH /api/auth/password`
- `GET /api/labourers`, `GET /api/labourers/:id`, `GET|PUT /api/labourers/me`
- `GET|POST /api/jobs`, `GET /api/jobs/mine`, `GET /api/jobs/applied`, `PATCH /api/jobs/:id`
- `POST /api/jobs/:id/apply`, `GET /api/jobs/:id/applications`, `POST /api/jobs/:id/hire`
- `GET|POST /api/bookings`, `PATCH /api/bookings/:id` (accept, reject, start, progress, complete, cancel), `POST /api/bookings/:id/pay` (mock), `POST /api/bookings/:id/review`
- `GET /api/trades`, `GET /api/areas`
- `GET /api/admin/stats|users|jobs|bookings|areas`, `PATCH /api/admin/users/:id`, `DELETE /api/admin/jobs/:id`, `POST /api/admin/areas`, `DELETE /api/admin/areas/:id`
