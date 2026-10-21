-- 9 to 5 database schema (MySQL 8)

CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  phone         VARCHAR(15)  NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  role          ENUM('labourer','poster','admin') NOT NULL,
  status        ENUM('active','blocked') NOT NULL DEFAULT 'active',
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Areas labourers pick from at signup; managed by the admin.
CREATE TABLE IF NOT EXISTS areas (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS labourer_profiles (
  user_id      INT PRIMARY KEY,
  trades       VARCHAR(255) NOT NULL,  -- comma-separated, e.g. 'Painter,Mason'
  area         VARCHAR(100) NOT NULL,
  daily_rate   INT NOT NULL,
  skills       VARCHAR(255) NOT NULL DEFAULT '',
  experience   INT NOT NULL DEFAULT 0,
  available    BOOLEAN NOT NULL DEFAULT TRUE,
  verified     BOOLEAN NOT NULL DEFAULT FALSE,
  rating_avg   DECIMAL(2,1) NOT NULL DEFAULT 0,
  rating_count INT NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS jobs (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  poster_id  INT NOT NULL,
  title      VARCHAR(150) NOT NULL,
  trade      VARCHAR(50)  NOT NULL,
  location   VARCHAR(100) NOT NULL,
  address    VARCHAR(255) NOT NULL DEFAULT '',
  budget     INT NOT NULL,
  job_date   DATE NOT NULL,
  start_time TIME NOT NULL DEFAULT '09:00:00',
  duration_minutes SMALLINT NOT NULL DEFAULT 480,  -- the job runs from start_time for this long
  details    TEXT,
  status     ENUM('open','assigned','closed') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (poster_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS applications (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  job_id      INT NOT NULL,
  labourer_id INT NOT NULL,
  message     VARCHAR(255) NOT NULL DEFAULT '',
  -- 'expired': the labourer was confirmed for another job in an overlapping slot first.
  status      ENUM('pending','accepted','rejected','expired') NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY one_application (job_id, labourer_id),
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (labourer_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Work flow: pending -> accepted -> started -> in_progress -> completed (then paid).
CREATE TABLE IF NOT EXISTS bookings (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  job_id         INT NULL,
  poster_id      INT NOT NULL,
  labourer_id    INT NOT NULL,
  booking_date   DATE NOT NULL,
  start_time     TIME NOT NULL DEFAULT '09:00:00',
  duration_minutes SMALLINT NOT NULL DEFAULT 480,
  amount         INT NOT NULL,
  note           VARCHAR(255) NOT NULL DEFAULT '',
  address        VARCHAR(255) NOT NULL DEFAULT '',
  status         ENUM('pending','accepted','started','in_progress','completed','rejected','cancelled','expired') NOT NULL DEFAULT 'pending',
  paid_at        TIMESTAMP NULL,
  payment_method VARCHAR(20) NULL,
  payment_ref    VARCHAR(30) NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL,
  FOREIGN KEY (poster_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (labourer_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reviews (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL UNIQUE,
  rating     TINYINT NOT NULL,
  comment    VARCHAR(500) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
);
