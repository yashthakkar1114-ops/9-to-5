# 9 to 5 — Hire Local Labourers

A web app for finding and hiring local daily-wage labourers (plumbers, carpenters, electricians, painters, movers and more).

**Stack:** HTML/CSS/JavaScript frontend · Node.js + Express backend · MySQL database · JWT login in an httpOnly cookie.

## Who uses it

| Labourer | Job Poster | Admin |
|---|---|---|
| Sign up with trade, area, daily rate and skills | Sign up and log in | Logs in at `/admin-login` (no public signup) |
| Browse open jobs and apply | Post, edit, close and reopen jobs | Verify or unverify labourers |
| Accept or reject direct booking requests | Search labourers and book them directly | Block or unblock users |
| Edit profile and set availability | See applicants and hire one | Remove jobs |
| See bookings, applications and ratings | Mark work done and leave a 1–5★ review | See stats and all bookings |

Phone numbers are only shared once a booking is accepted.

## Run it locally

You need Node.js 18+ and MySQL 8.

1. **Start MySQL.** On this machine, double-click `scripts/start-mysql.cmd` and keep the window open.
2. **Configure.** Copy `.env.example` to `.env` and fill in your MySQL user and password and a long random `JWT_SECRET`.
3. **Install and set up the database:**
   ```
   npm install
   npm run db:setup
   ```
   To wipe all data and start fresh, run `npm run db:setup -- --reset`.
4. **Start the app:** run `npm run dev` (it restarts automatically on server changes) or `npm start`.
5. Open http://localhost:8080

### Demo accounts

| Role | Email | Password |
|---|---|---|
| Admin | admin@9to5.local | admin1234 |
| Job Poster | poster@demo.in | demo1234 |
| Labourer | ram@demo.in (also meena@, suresh@, anil@, ravi@demo.in) | demo1234 |

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
- `GET|POST /api/bookings`, `PATCH /api/bookings/:id` (accept, reject, cancel, complete), `POST /api/bookings/:id/review`
- `GET /api/admin/stats|users|jobs|bookings`, `PATCH /api/admin/users/:id`, `DELETE /api/admin/jobs/:id`
