# 9 to 5 — Hire Labourers (Minor Project)

## Overview
9 to 5 is a simple web app (HTML/CSS/JS) to find and hire local labourers. Data is stored in browser `localStorage` (no backend). Demo-ready.

## Features
- Search & filter workers
- View worker details & book them (client role)
- Post job form (client role)
- Simple signup/login via prompt (stored in localStorage)
- Dashboard for client/worker/admin
- Admin panel for overview

## How to run
1. Open `index.html` in Chrome.
2. Use `Login/Signup` button to create or login:
   - seeded accounts: `admin@9to5.local` (password `admin`), `client@demo` (`1234`), `worker@demo` (`1234`)
3. Post jobs at `post_job.html`, view workers and book from `index.html`, view bookings in `dashboard.html`.

## Notes for evaluation
- This is a demo single-user simulation using `localStorage`. For real use, replace storage calls with API calls to a backend.
- Authentication is intentionally simple for demo purposes.
