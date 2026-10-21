// Records a hands-free demo video of the whole workflow with Selenium.
//   npm run demo:record                -> demo-video/9to5-demo.mp4
//   npm run demo:record -- --restore   -> only put back the database backup (if a run was interrupted)
//   npm run demo:record -- --encode-only -> rebuild the video from the last recording's frames
//
// Two headless Chrome windows emulate phones: Admin / Job Poster on the left, Labourers on the right.
// Each phone screen is captured with Chrome's screencast, and ffmpeg places both inside phone frames
// on a 1920x1080 stage with captions beside each phone.
// Every caption is also spoken by a neural female voice (Microsoft's online speech service), in sync.
// Your database is backed up to demo-video/db-backup.json, reset to the demo data for the recording,
// and restored afterwards (even if the recording fails).
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync, execFileSync } = require('child_process');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const mysql = require('mysql2/promise');
const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const ffmpeg = require('ffmpeg-static');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'demo-video');
const FRAMES_DIR = path.join(OUT_DIR, 'frames');
const BACKUP = path.join(OUT_DIR, 'db-backup.json');
const VIDEO = path.join(OUT_DIR, '9to5-demo.mp4');
const TIMELINE = path.join(FRAMES_DIR, 'timeline.json');
const PORT = 8090; // its own server, so it doesn't clash with `npm run dev` on 8080
const BASE = `http://localhost:${PORT}`;
// Each phone shows a 390x844 mobile viewport (rendered at 2x), drawn on screen at 416x900.
const MOBILE = { width: 390, height: 844, pixelRatio: 2 };
const SCREEN_W = 416;
const SCREEN_H = 900;
const STATUS_H = 40; // fake phone status bar above the app
const BEZEL = 14;
const PHONE_W = SCREEN_W + 2 * BEZEL;
const PHONE_H = STATUS_H + SCREEN_H + 2 * BEZEL;
const PHONE_Y = (1080 - PHONE_H) / 2;
const PHONE_X = { left: 960 - 50 - PHONE_W, right: 960 + 50 };
const holeX = side => PHONE_X[side] + BEZEL; // where each recorded screen sits in the video
const HOLE_Y = PHONE_Y + BEZEL + STATUS_H;
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const TABLES = ['users', 'areas', 'labourer_profiles', 'jobs', 'applications', 'bookings', 'reviews']; // parent tables first

const sleep = ms => new Promise(r => setTimeout(r, ms));
// A browser command that never answers would freeze the whole recording, so every one gets a time limit.
const withTimeout = (promise, ms, what) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} did not respond within ${ms / 1000}s`)), ms)),
]);
const ROLE = {
  admin: ['Admin', '#7c3aed'],
  poster: ['Job Poster · Priya', '#2563eb'],
  meena: ['Labourer · Meena', '#059669'],
  anil: ['Labourer · Anil', '#0d9488'],
  visitor: ['Visitor', '#475569'],
};
const JOB = {
  title: 'Paint 1BHK bedroom',
  area: 'Kandivali',
  address: '7 Mahavir Nagar, Kandivali West, Mumbai 400067',
  budget: '3000',
  start: '10:00 am',
  duration: '4 h',
  paid: '3500', // more than the agreed budget: the work was good
  details: 'One bedroom, walls and ceiling. Paint is ready at home.',
};
// Priya's job from the demo data (9 am - 5 pm). Her new job goes on the same day, so the two time slots overlap.
const OVERLAP_JOB = 'Paint 2BHK living room';

// ---------------- Database backup / reset / restore ----------------

function dbConfig(extra = {}) {
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    dateStrings: true,
    ...extra,
  };
}

async function backupDb() {
  const conn = await mysql.createConnection(dbConfig());
  const data = {};
  for (const t of TABLES) [data[t]] = await conn.query(`SELECT * FROM ${t}`);
  await conn.end();
  fs.writeFileSync(BACKUP, JSON.stringify(data));
  console.log(`Backed up your data (${data.users.length} users, ${data.jobs.length} jobs) to ${BACKUP}`);
}

async function restoreDb() {
  const data = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
  const conn = await mysql.createConnection(dbConfig({ multipleStatements: true }));
  try {
    await conn.query(`DROP TABLE IF EXISTS ${[...TABLES].reverse().join(', ')}`);
    await conn.query(fs.readFileSync(path.join(ROOT, 'server', 'schema.sql'), 'utf8'));
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of TABLES) {
      const rows = data[t];
      if (!rows.length) continue;
      const cols = Object.keys(rows[0]);
      await conn.query(`INSERT INTO ${t} (${cols.map(c => '`' + c + '`').join(', ')}) VALUES ?`, [rows.map(r => cols.map(c => r[c]))]);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    await conn.end();
  }
  fs.unlinkSync(BACKUP);
  console.log('Restored your original data.');
}

function resetToDemoData() {
  execFileSync(process.execPath, [path.join(ROOT, 'server', 'setup-db.js'), '--reset'], { cwd: ROOT, stdio: 'pipe' });
  console.log('Database reset to demo data for the recording.');
}

async function startServer() {
  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(BASE + '/api/areas')).ok) return server;
    } catch {}
    await sleep(200);
  }
  server.kill();
  throw new Error(`The app server did not start on port ${PORT}.`);
}

// ---------------- In-page overlay: captions, fake cursor, dropdowns, confirm dialogs ----------------

// Runs inside every page (injected before the app's own scripts). Never called in Node.
function overlayMain() {
  if (window.__demo) return;
  const KEY = '__demo';
  let state = { x: 195, y: 300 };
  try { Object.assign(state, JSON.parse(sessionStorage.getItem(KEY)) || {}); } catch {}
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch {} };
  let root;

  function mount() {
    if (root && root.isConnected) return;
    root = document.createElement('div');
    root.id = '__demo_root';
    root.innerHTML = `<style>
      #__demo_root *{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
      .dm-cur{position:fixed;z-index:2147483647;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;
        background:rgba(30,41,59,.32);border:2px solid rgba(255,255,255,.95);box-shadow:0 2px 8px rgba(0,0,0,.35);pointer-events:none;
        transition:left .7s cubic-bezier(.4,0,.2,1),top .7s cubic-bezier(.4,0,.2,1),transform .15s}
      .dm-cur.down{transform:scale(.8);background:rgba(30,41,59,.55)}
      .dm-cur.drag{transition:left 1.1s ease-in-out,top 1.1s ease-in-out,transform .15s}
      .dm-ring{position:fixed;z-index:2147483646;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;
        border:3px solid #f59e0b;pointer-events:none;animation:dm-ring .6s ease-out forwards}
      @keyframes dm-ring{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}
      .dm-dd{position:fixed;z-index:2147483645;background:#fff;border:1px solid #cbd5e1;border-radius:8px;
        box-shadow:0 12px 30px rgba(15,23,42,.25);overflow:auto;max-height:290px;pointer-events:none;scroll-behavior:smooth}
      .dm-dd div{padding:7px 12px;font-size:15px;color:#0f172a}
      .dm-dd div.hl{background:#2563eb;color:#fff}
      .dm-confirm{position:fixed;left:50%;top:24%;transform:translateX(-50%);z-index:2147483646;width:min(430px,86vw);
        background:#fff;color:#0f172a;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.4);padding:18px 20px;
        pointer-events:none;animation:dm-pop .2s ease-out}
      .dm-confirm small{display:block;color:#64748b;font-size:12px;margin-bottom:6px}
      .dm-confirm p{margin:0 0 14px;font-size:16px}
      .dm-confirm .row{display:flex;justify-content:flex-end;gap:8px}
      .dm-confirm .row span{border-radius:8px;padding:6px 16px;font-weight:600;font-size:14px;background:#e2e8f0}
      .dm-confirm .row .ok{background:#2563eb;color:#fff;outline:3px solid #f59e0b;outline-offset:2px}
      @keyframes dm-pop{from{transform:translateX(-50%) scale(.9);opacity:0}}
      .dm-title{position:fixed;inset:0;z-index:2147483646;display:flex;flex-direction:column;align-items:center;
        justify-content:center;text-align:center;padding:40px;background:linear-gradient(135deg,#1e3a8a,#0f766e);color:#fff;transition:opacity .6s}
      .dm-title h1{font-size:40px;margin:0 0 14px;font-weight:800}
      .dm-title p{font-size:19px;margin:0;opacity:.92;line-height:1.55}
    </style>
    <div class="dm-cur"></div>`;
    document.documentElement.appendChild(root);
    const cur = root.querySelector('.dm-cur');
    cur.style.transition = 'none';
    render();
    cur.getBoundingClientRect();
    cur.style.transition = '';
  }

  function render() {
    const cur = root.querySelector('.dm-cur');
    cur.style.left = state.x + 'px';
    cur.style.top = state.y + 'px';
  }

  let dd, ddTarget;
  window.__demo = {
    moveTo(x, y) { Object.assign(state, { x, y }); save(); mount(); render(); },
    // Finger pressed on the screen while dragging (used for swipes).
    press(on) { mount(); root.querySelector('.dm-cur').classList.toggle('down', on); root.querySelector('.dm-cur').classList.toggle('drag', on); },
    ring() {
      mount();
      const r = document.createElement('div');
      r.className = 'dm-ring';
      r.style.left = state.x + 'px';
      r.style.top = state.y + 'px';
      root.appendChild(r);
      setTimeout(() => r.remove(), 700);
    },
    // Native <select> popups are not captured by the screencast, so draw a look-alike list.
    dropdown(sel, wanted) {
      mount();
      const r = sel.getBoundingClientRect();
      dd = document.createElement('div');
      dd.className = 'dm-dd';
      Object.assign(dd.style, { left: r.left + 'px', top: r.bottom + 4 + 'px', width: r.width + 'px' });
      for (const o of sel.options) {
        if (!o.value) continue;
        const d = document.createElement('div');
        d.textContent = o.text;
        if (o.text === wanted) ddTarget = d;
        dd.appendChild(d);
      }
      root.appendChild(dd);
    },
    ddScroll() { dd.scrollTop = ddTarget.offsetTop - dd.clientHeight / 2 + ddTarget.offsetHeight / 2; },
    ddTargetPos() { const b = ddTarget.getBoundingClientRect(); return { x: b.left + Math.min(70, b.width / 2), y: b.top + b.height / 2 }; },
    ddHighlight() { ddTarget.classList.add('hl'); },
    ddClose(sel, wanted) {
      dd.remove();
      sel.value = [...sel.options].find(o => o.text === wanted).value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    },
    title(h, p) {
      mount();
      const t = document.createElement('div');
      t.className = 'dm-title';
      t.innerHTML = `<h1></h1><p></p>`;
      t.querySelector('h1').textContent = h;
      t.querySelector('p').textContent = p;
      root.appendChild(t);
    },
    untitle() {
      root.querySelectorAll('.dm-title').forEach(t => { t.style.opacity = '0'; setTimeout(() => t.remove(), 700); });
    },
  };

  // Show confirm() prompts on screen (native dialogs are not captured) and answer OK.
  window.confirm = msg => {
    mount();
    const c = document.createElement('div');
    c.className = 'dm-confirm';
    c.innerHTML = `<small>${location.host} says</small><p></p><div class="row"><span>Cancel</span><span class="ok">OK</span></div>`;
    c.querySelector('p').textContent = msg;
    root.appendChild(c);
    setTimeout(() => c.remove(), 2200);
    return true;
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
}

// ---------------- Minimal Chrome DevTools Protocol client ----------------

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = {};
    this.ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      } else if (m.method && this.handlers[m.method]) {
        this.handlers[m.method](m.params);
      }
    };
  }
  open() {
    return new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(method, fn) { this.handlers[method] = fn; }
  close() { try { this.ws.close(); } catch {} }
}

// ---------------- One browser window ("pane") ----------------

class Pane {
  constructor(name) {
    this.name = name;
    this.frames = [];
    this.dir = path.join(FRAMES_DIR, name);
    fs.mkdirSync(this.dir, { recursive: true });
  }

  async start() {
    const opts = new chrome.Options().addArguments(
      '--headless=new', '--window-size=500,1000', '--hide-scrollbars',
      '--remote-allow-origins=*', '--no-first-run', '--lang=en-IN', '--password-store=basic',
      // The demo passwords are on leaked-password lists: Chrome's password manager would pop up warnings
      // after each login, which are invisible in headless mode and can leave ChromeDriver waiting forever.
      '--disable-features=Translate,PasswordLeakDetection,PasswordManagerOnboarding,PasswordCheck',
    ).setUserPreferences({
      credentials_enable_service: false,
      'profile.password_manager_enabled': false,
      'profile.password_manager_leak_detection': false,
    }).setMobileEmulation({ deviceMetrics: { ...MOBILE, touch: true }, userAgent: MOBILE_UA });
    this.d = await new Builder().forBrowser('chrome').setChromeOptions(opts).build();
    const dbg = (await this.d.getCapabilities()).get('goog:chromeOptions').debuggerAddress;
    const targets = await (await fetch(`http://${dbg}/json`)).json();
    this.cdp = new Cdp(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await this.cdp.open();
    this.cdp.on('Page.screencastFrame', p => {
      const file = path.join(this.dir, String(this.frames.length).padStart(6, '0') + '.jpg');
      fs.writeFileSync(file, Buffer.from(p.data, 'base64'));
      this.frames.push({ t: Date.now(), file });
      this.cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
    });
    await this.cdp.send('Page.enable');
    await this.cdp.send('Page.setBypassCSP', { enabled: true });
    await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${overlayMain})();` });
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg', quality: 90, everyNthFrame: 2, // ~30 fps, matching the video
      maxWidth: MOBILE.width * MOBILE.pixelRatio, maxHeight: MOBILE.height * MOBILE.pixelRatio,
    });
  }

  async stop() {
    try { await withTimeout(this.cdp.send('Page.stopScreencast'), 5000, 'Stopping the screencast'); } catch {}
    this.cdp?.close();
    try { await withTimeout(this.d.quit(), 15000, 'Closing the browser'); } catch {}
  }

  js(script, ...args) { return withTimeout(this.d.executeScript(script, ...args), 30000, `The ${this.name} phone`); }

  async go(urlPath) {
    await withTimeout(this.d.get(BASE + urlPath), 30000, `Loading ${urlPath} on the ${this.name} phone`);
    await this.ready();
  }

  // Waits for the page (and our overlay) to be loaded after any navigation.
  async ready() {
    await this.d.wait(async () => this.js('return document.readyState === "complete" && !!window.__demo'), 15000);
    await sleep(400);
    // On a phone the whole page should never be wider than the screen; wide tables scroll inside their own box.
    const over = await this.js('return document.documentElement.scrollWidth - innerWidth');
    if (over > 1) console.warn(`  note: ${await this.d.getCurrentUrl()} is ${over}px wider than the phone screen`);
  }

  // Swipes a sideways-scrolling box (like a wide table) with a finger, so its hidden columns come into view.
  async swipe(target, { back = true, hold = 1800 } = {}) {
    const el = typeof target === 'string' ? await this.waitVisible(target) : target;
    await this.js('arguments[0].scrollIntoView({ block: "center", behavior: "smooth" })', el);
    await sleep(700);
    const r = await this.js(`const r = arguments[0].getBoundingClientRect();
      return { x: r.left, w: r.width, y: Math.max(r.top, 0) + Math.min(r.height, innerHeight - Math.max(r.top, 0)) / 2,
        max: arguments[0].scrollWidth - arguments[0].clientWidth };`, el);
    if (r.max <= 0) return;
    const drag = async (fromX, toX, left) => {
      await this.js('__demo.moveTo(arguments[0], arguments[1])', fromX, r.y);
      await sleep(800);
      await this.js('__demo.press(true)');
      await sleep(150);
      await this.js('__demo.moveTo(arguments[0], arguments[1]); arguments[2].scrollTo({ left: arguments[3], behavior: "smooth" })', toX, r.y, el, left);
      await sleep(1200);
      await this.js('__demo.press(false)');
    };
    await drag(r.x + r.w * 0.82, r.x + r.w * 0.18, r.max);
    await sleep(hold);
    if (back) {
      await drag(r.x + r.w * 0.18, r.x + r.w * 0.82, 0);
      await sleep(500);
    }
  }

  async waitUrl(part) {
    await this.d.wait(async () => (await this.d.getCurrentUrl()).includes(part), 15000);
    await this.ready();
  }

  find(css) { return this.d.wait(until.elementLocated(By.css(css)), 15000); }
  findX(xpath) { return this.d.wait(until.elementLocated(By.xpath(xpath)), 15000); }
  async waitVisible(css, timeout = 15000) {
    const el = await this.d.wait(until.elementLocated(By.css(css)), timeout);
    await this.d.wait(until.elementIsVisible(el), timeout);
    return el;
  }

  // Speaks a line (after any sentence still being spoken) and shows it as the caption beside this phone.
  async say(who, text) {
    if (text) await narrator.speak(text);
    const [role, color] = ROLE[who];
    captions.push({ t: Date.now(), side: this.name, role, color, text });
  }

  // Scrolls an element into view and glides the fake cursor onto it.
  async point(el) {
    await this.js('arguments[0].scrollIntoView({ block: "center", inline: "center", behavior: "smooth" })', el);
    await sleep(550);
    const p = await this.js('const r = arguments[0].getBoundingClientRect(); return { x: r.left + Math.min(r.width / 2, 60), y: r.top + r.height / 2 };', el);
    await this.js('__demo.moveTo(arguments[0], arguments[1])', p.x, p.y);
    await sleep(800);
  }

  async click(target, pause = 900) {
    const el = typeof target === 'string' ? await this.waitVisible(target) : target;
    await this.point(el);
    await this.js('__demo.ring()');
    await sleep(150);
    // Tapped from inside the page: ChromeDriver's own click once hung forever on a phone screen.
    // Deferred so a tap that navigates can't leave this call waiting on the old page.
    await this.js('const el = arguments[0]; el.focus({ preventScroll: true }); setTimeout(() => el.click(), 0);', el);
    await sleep(pause);
  }

  async type(target, text, delay = 35) {
    const el = typeof target === 'string' ? await this.waitVisible(target) : target;
    await this.click(el, 250);
    for (const ch of text) {
      await withTimeout(el.sendKeys(ch), 15000, `Typing on the ${this.name} phone`);
      await sleep(delay);
    }
    await sleep(300);
  }

  async pick(target, optionText) {
    const sel = typeof target === 'string' ? await this.waitVisible(target) : target;
    await this.d.wait(async () => this.js('return [...arguments[0].options].some(o => o.text === arguments[1])', sel, optionText), 15000);
    await this.point(sel);
    await this.js('__demo.ring(); __demo.dropdown(arguments[0], arguments[1])', sel, optionText);
    await sleep(900);
    await this.js('__demo.ddScroll()');
    await sleep(800);
    const p = await this.js('return __demo.ddTargetPos()');
    await this.js('__demo.moveTo(arguments[0], arguments[1])', p.x, p.y);
    await sleep(900);
    await this.js('__demo.ddHighlight(); __demo.ring()');
    await sleep(500);
    await this.js('__demo.ddClose(arguments[0], arguments[1])', sel, optionText);
    await sleep(500);
  }

  // For inputs that are awkward to type into (dates): click, then set the value.
  async setValue(css, value) {
    const el = await this.waitVisible(css);
    await this.click(el, 300);
    await this.js('arguments[0].value = arguments[1]; arguments[0].dispatchEvent(new Event("input", { bubbles: true })); arguments[0].dispatchEvent(new Event("change", { bubbles: true }));', el, value);
    await sleep(600);
  }

  async scrollTo(y, pause = 1200) {
    await this.js('window.scrollTo({ top: arguments[0], behavior: "smooth" })', y);
    await sleep(pause);
  }

  // Header links sit behind the ☰ menu on a phone: open it first when needed.
  async nav(css) {
    const target = await this.find(`#siteHeader ${css}`);
    if (!(await target.isDisplayed())) {
      await this.click('#siteHeader .menu-btn', 700);
      await this.d.wait(until.elementIsVisible(target), 5000);
    }
    await this.click(target, 300);
  }

  async login(email, password, who) {
    if (who === 'admin') {
      await this.go('/admin-login');
    } else {
      await this.nav('.nav a[href="/login"]');
      await this.waitUrl('/login');
      if (who !== 'poster') await this.click('.role-toggle [data-role="labourer"]', 600);
    }
    await this.type('#loginForm [name=email]', email);
    await this.type('#loginForm [name=password]', password, 25);
    await this.click('#loginForm button[type=submit]', 300);
    await this.waitUrl(who === 'admin' ? '/admin' : '/dashboard');
    await this.find('#logoutBtn');
    await sleep(900);
  }

  async logout() {
    await this.nav('#logoutBtn');
    await this.d.wait(async () => (await this.d.getCurrentUrl()) === BASE + '/', 15000);
    await this.ready();
    await this.find('.nav a[href="/login"]');
  }

  async screenshot(file) {
    // Through DevTools rather than ChromeDriver, so it still works if ChromeDriver is stuck.
    try { fs.writeFileSync(file, (await withTimeout(this.cdp.send('Page.captureScreenshot', { format: 'png' }), 10000, 'Screenshot')).data, 'base64'); } catch {}
  }
}

const card = title => `//div[contains(@class,'job-card')][.//h3[normalize-space()='${title}']]`;
const localDate = days => {
  const d = new Date(Date.now() + days * 864e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---------------- Narration (neural female voice, one cached clip per sentence) ----------------

const VOICE = 'en-IN-NeerjaNeural';
const VOICE_DIR = path.join(OUT_DIR, 'voice');

function audioSeconds(file) {
  const out = spawnSync(ffmpeg, ['-i', file], { encoding: 'utf8' }).stderr;
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(out);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 3;
}

class Narrator {
  constructor() {
    this.lines = [];
    this.busyUntil = 0;
    fs.mkdirSync(VOICE_DIR, { recursive: true });
  }

  // MP3 of one sentence, generated on first use and reused on later runs.
  async clip(text) {
    const file = path.join(VOICE_DIR, crypto.createHash('sha1').update(VOICE + text).digest('hex').slice(0, 16) + '.mp3');
    if (fs.existsSync(file)) return file;
    // The online voice service occasionally stalls: give each try a time limit and retry.
    for (let attempt = 1; ; attempt++) {
      const tmp = fs.mkdtempSync(path.join(VOICE_DIR, 'tmp-'));
      const tts = new MsEdgeTTS();
      try {
        await withTimeout((async () => {
          await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
          const { audioFilePath } = await tts.toFile(tmp, text);
          fs.renameSync(audioFilePath, file);
        })(), 20000, 'The voice service');
        return file;
      } catch (err) {
        if (attempt === 3) throw err;
      } finally {
        tts.close();
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    }
  }

  // Starts a sentence once the previous one has finished, and returns as soon as it starts.
  async speak(text) {
    const file = await this.clip(text);
    await this.idle();
    const t = Date.now();
    this.lines.push({ t, file });
    this.busyUntil = t + audioSeconds(file) * 1000 + 350;
  }

  async idle() {
    const wait = this.busyUntil - Date.now();
    if (wait > 0) await sleep(wait);
  }
}

const narrator = new Narrator();
const captions = []; // { t, side, role, color, text }: what each phone's caption says from time t

// ---------------- The demo itself ----------------

async function demo(L, R) {
  const { jobs } = await (await fetch(BASE + '/api/jobs')).json();
  const slotDay = String(jobs.find(j => j.title === OVERLAP_JOB).job_date).slice(0, 10);

  // Intro
  await Promise.all([L.go('/'), R.go('/')]);
  await Promise.all([
    L.js('__demo.title(arguments[0], arguments[1])', '9 to 5', 'Hire trusted local labourers: plumbers, painters, electricians and more.'),
    R.js('__demo.title(arguments[0], arguments[1])', 'Live demo', 'Left: Admin and Job Poster  ·  Right: Labourers. Both screens are live at the same time.'),
  ]);
  await sleep(600);
  const t0 = Date.now();
  await sleep(500);
  await narrator.speak('Welcome to 9 to 5. It is an app to hire local workers, like plumbers and painters.');
  await narrator.speak('On the left is the admin and the job poster. On the right are the workers.');
  await narrator.idle();
  await Promise.all([L.js('__demo.untitle()'), R.js('__demo.untitle()')]);
  await sleep(800);

  await R.say('visitor', 'This is the home page. You can hire a worker, or find work.');
  await R.scrollTo(1300, 3000);
  await R.say('visitor', 'It shows how the app works for both sides.');
  await R.scrollTo(2600, 3000);
  await R.scrollTo(0, 1500);

  // 1. Admin
  await L.say('admin', 'First, the admin logs in on a private page.');
  await L.login('admin@9to5.local', 'admin1234', 'admin');
  await L.say('admin', 'At the top are the numbers. Below is the list of all users.');
  await L.swipe('#tabBody .table-wrap');
  const verify = await L.findX("//tr[.//strong[normalize-space()='Anil Yadav']]//button[@data-verify]");
  await L.say('admin', 'The admin checks a worker called Anil, and verifies him.');
  await L.click(verify, 1800);
  await L.say('admin', 'The admin also manages the list of areas.');
  await L.click('#tabs [data-tab="areas"]', 1200);
  await L.type('#areaForm [name=name]', JOB.area, 60);
  await L.click('#areaForm button[type=submit]', 800);
  await L.point(await L.findX(`//td/strong[normalize-space()='${JOB.area}']`));
  await L.say('admin', `${JOB.area} is added. Now everyone can pick it.`);
  await sleep(1500);
  await L.logout();

  // 2. Job Poster posts a job
  await L.say('poster', 'Priya needs a painter. She logs in to hire one.');
  await L.login('poster@demo.in', 'demo1234', 'poster');
  await L.say('poster', 'Her dashboard shows her jobs and bookings.');
  await sleep(1200);
  await L.nav('.nav a[href="/post_job"]');
  await L.waitUrl('/post_job');
  await L.say('poster', 'She posts a new job.');
  await L.type('#postJobForm [name=title]', JOB.title, 45);
  await L.pick('#tradeSelect', 'Painter');
  await L.say('poster', `She picks the area from a list. ${JOB.area} is there.`);
  await L.pick('#areaSelect', JOB.area);
  await L.say('poster', 'Her address stays private until she hires someone.');
  await L.type('#postJobForm [name=address]', JOB.address, 22);
  await L.type('#postJobForm [name=budget]', JOB.budget, 80);
  await L.say('poster', 'Every job is a time slot. She picks the day, the start time and how long it takes.');
  await L.setValue('#slotBox [name=job_date]', slotDay);
  await L.pick('#slotBox [name=start_time]', JOB.start);
  await L.pick('#slotBox [name=duration_minutes]', JOB.duration);
  await L.point(await L.waitVisible('#slotBox .slot-end'));
  await L.say('poster', 'The job runs from 10 in the morning to 2 in the afternoon.');
  await sleep(800);
  await L.type('#postJobForm [name=details]', JOB.details, 22);
  await L.click('#postJobForm button[type=submit]', 300);
  await L.waitUrl('/dashboard');
  await L.findX(card(JOB.title));
  await L.say('poster', 'The job is now live. Painters can apply.');
  await sleep(1500);

  // 3. Labourers apply
  await R.say('meena', 'Meena is a painter. She logs in to find work.');
  await R.login('meena@demo.in', 'demo1234', 'meena');
  await R.nav('.nav a[href="/jobs"]');
  await R.waitUrl('/jobs');
  await R.waitVisible('.trade-note');
  await R.say('meena', 'She only sees jobs that match her skills.');
  await sleep(800);
  await R.say('meena', 'Every job shows its day and time.');
  await R.point(await R.findX(card(JOB.title) + "//div[contains(@class,'meta')]"));
  await sleep(1200);
  await R.say('meena', 'She applies for the bedroom job, from 10 to 2.');
  await R.click(await R.findX(card(JOB.title) + '//button[@data-apply]'), 900);
  await R.type('#appModal textarea[name=message]', '12 years of painting experience. I can start at 9am.', 30);
  await R.click('#appModal button[type=submit]', 1800);
  await R.findX(card(JOB.title) + "//span[contains(@class,'pill-accepted')]"); // "Applied ✓"
  await R.say('meena', 'The living room job is on the same day, at the same time. She can apply for it too.');
  await R.click(await R.findX(card(OVERLAP_JOB) + '//button[@data-apply]'), 900);
  await R.click('#appModal button[type=submit]', 1800);
  await R.point(await R.findX(card(OVERLAP_JOB) + "//span[contains(@class,'pill-accepted')]"));
  await sleep(1000);
  await R.logout();

  await R.say('anil', 'Anil is also a painter. He applies for the same job.');
  await R.login('anil@demo.in', 'demo1234', 'anil');
  await R.nav('.nav a[href="/jobs"]');
  await R.waitUrl('/jobs');
  await R.click(await R.findX(card(JOB.title) + '//button[@data-apply]'), 900);
  await R.type('#appModal textarea[name=message]', 'Available on that date, have my own tools.', 30);
  await R.click('#appModal button[type=submit]', 2000);
  await R.nav('.nav a[href="/dashboard"]');
  await R.waitUrl('/dashboard');
  await R.click('#tabs [data-tab="applications"]', 800);
  await R.say('anil', 'His application is waiting for a reply.');
  await sleep(1500);

  // 4. Poster reviews applicants: reject one, hire the other
  await L.say('poster', 'Now Priya has two people who want the job.');
  await L.click('#tabs [data-tab="jobs"]', 1200);
  await L.click(await L.findX(card(JOB.title) + '//button[@data-applicants]'), 1200);
  await L.waitVisible('#appModal [data-reject]');
  await L.say('poster', 'She can see their skills, price and experience.');
  await sleep(2000);
  await L.say('poster', 'She says no to Anil.');
  await L.click(await L.findX("//div[contains(@class,'review')][.//strong[normalize-space()='Anil Yadav']]//button[@data-reject]"), 2600);
  await L.findX("//div[contains(@class,'review')][.//strong[normalize-space()='Anil Yadav']]//span[contains(@class,'pill-rejected')]");

  await R.say('anil', 'Anil sees right away that he was not selected.');
  await R.click('#tabs [data-tab="applications"]', 600);
  await R.waitVisible('.pill-rejected');
  await sleep(2500);

  await L.say('poster', 'And she hires Meena.');
  await L.click(await L.findX("//div[contains(@class,'review')][.//strong[normalize-space()='Meena Patel']]//button[@data-hire]"), 2600);
  await L.say('poster', 'Meena got the job.');
  await sleep(800);
  await L.say('poster', 'Meena had also applied for the living room job at the same time. That application has now expired by itself.');
  await L.click(await L.findX(card(OVERLAP_JOB) + '//button[@data-applicants]'), 1200);
  await L.point(await L.waitVisible('#appModal .pill-expired'));
  await sleep(1500);
  await L.click('#appModal .close', 800);
  await R.logout();

  // 5. Live work tracking
  await R.say('meena', 'Meena logs in again.');
  await R.login('meena@demo.in', 'demo1234', 'meena');
  await R.click('#tabs [data-tab="applications"]', 1200);
  await R.say('meena', 'Her bedroom job is confirmed. The living room job at the same time has expired by itself.');
  await R.point(await R.findX(card(OVERLAP_JOB) + "//span[contains(@class,'pill-expired')]"));
  await sleep(1500);
  await R.say('meena', 'She opens her bookings.');
  await R.click('#tabs [data-tab="bookings"]', 1200);
  await R.waitVisible('[data-act="start"]');
  await R.say('meena', 'Now she can see the phone number, the address and a map.');
  await L.say('poster', 'Priya opens her bookings to follow the work.');
  await L.click('#tabs [data-tab="bookings"]', 1500);
  await sleep(1000);

  const step = async (act, pill, labourerText, posterText) => {
    await R.say('meena', labourerText);
    await R.click(`[data-act="${act}"]`, 1500);
    await L.say('poster', posterText);
    await L.waitVisible(pill, 25000);
    await sleep(2000);
  };
  await step('start', '.pill-started', 'Meena reaches the house and starts the job.', 'Priya\'s screen updates by itself. No refresh needed.');
  await step('progress', '.pill-in_progress', 'The work is in progress.', 'Priya sees it too.');
  await step('complete', 'a[href^="/pay?booking="]', 'The painting is done.', 'Priya sees that the job is complete.');

  // 6. Payment + review
  await L.say('poster', 'Now Priya pays.');
  await L.click('a[href^="/pay?booking="]', 300);
  await L.waitUrl('/pay');
  await L.waitVisible('#payForm');
  await L.say('poster', 'This is a test payment. No real money is used.');
  await sleep(800);
  await L.say('poster', 'Priya can change the amount. The work was very good, so she pays 3,500 rupees instead of 3,000.');
  const amount = await L.waitVisible('#payForm [name=amount]');
  await L.click(amount, 300);
  await L.js('arguments[0].value = ""; arguments[0].dispatchEvent(new Event("input", { bubbles: true }));', amount);
  await L.type(amount, JOB.paid, 150);
  await L.point(await L.find('#payDiff'));
  await sleep(1500);
  await L.click(await L.findX("//label[contains(@class,'chip')][.//span[normalize-space()='UPI']]"), 800);
  await L.click('#payForm button[type=submit]', 300);
  await L.waitVisible('.receipt');
  await L.say('poster', 'The payment of 3,500 rupees is successful.');
  await sleep(2000);
  await L.click('.receipt a.btn', 300);
  await L.waitUrl('/dashboard');
  await L.waitVisible('#appModal [data-star="5"]');
  await L.say('poster', 'Then she gives Meena five stars.');
  await L.click('#appModal [data-star="5"]', 800);
  await L.type('#appModal textarea[name=comment]', 'Neat, quick work and very polite. Highly recommended!', 28);
  await L.click('#appModal button[type=submit]', 2500);

  await R.say('meena', 'Meena sees the payment and her review.');
  await R.waitVisible('.paid', 25000);
  await sleep(2000);
  await R.click('#tabs [data-tab="profile"]', 1500);
  await R.say('meena', 'Her rating now shows on her profile.');
  await sleep(2000);

  // 7. Admin overview
  await L.logout();
  await L.say('admin', 'Last, the admin can see every booking and payment.');
  await L.login('admin@9to5.local', 'admin1234', 'admin');
  await L.click('#tabs [data-tab="bookings"]', 1500);
  await L.waitVisible('#tabBody .paid');
  await L.swipe('#tabBody .table-wrap', { back: false, hold: 3000 });

  // Outro
  await narrator.idle();
  await Promise.all([L.say('admin', ''), R.say('meena', '')]);
  await Promise.all([
    L.js('__demo.title(arguments[0], arguments[1])', '9 to 5', 'Node.js · Express · MySQL · role-based login'),
    R.js('__demo.title(arguments[0], arguments[1])', 'Thanks for watching', 'Admin · Job Posters · Labourers: one connected workflow.'),
  ]);
  await sleep(800);
  await narrator.speak('That is 9 to 5. Simple hiring for everyone. Thank you for watching!');
  await narrator.idle();
  await sleep(1500);
  return { t0, t1: Date.now() };
}

// ---------------- Video assembly ----------------

// ffconcat list that shows each image from its timestamp until the next one, covering exactly t0..t1.
function concatList(name, items, t0, t1) {
  const before = items.filter(f => f.t <= t0);
  const list = [...(before.length ? [before.at(-1)] : []), ...items.filter(f => f.t > t0 && f.t < t1)];
  if (!list.length) throw new Error(`Nothing was captured for the ${name} track.`);
  const lines = ['ffconcat version 1.0'];
  list.forEach((f, i) => {
    const start = i === 0 ? t0 : f.t;
    const end = i + 1 < list.length ? list[i + 1].t : t1;
    // Long holds are split into short repeats: ffmpeg's fps filter waits for the next image, and overlaying
    // full-HD frames while it waits many seconds runs out of memory.
    for (let at = start; at < end; at += 500) {
      lines.push(`file '${f.file.replace(/\\/g, '/')}'`, `duration ${((Math.min(at + 500, end) - at) / 1000).toFixed(3)}`);
    }
  });
  lines.push(`file '${list.at(-1).file.replace(/\\/g, '/')}'`); // the last entry needs repeating for its duration to count
  const file = path.join(FRAMES_DIR, name + '.txt');
  fs.writeFileSync(file, lines.join('\n'));
  return file;
}

// Rounded rectangle as an SVG path, with separate top and bottom corner radii.
function rr(x, y, w, h, rt, rb = rt) {
  return `M${x + rt} ${y}H${x + w - rt}${rt ? `A${rt} ${rt} 0 0 1 ${x + w} ${y + rt}` : ''}V${y + h - rb}` +
    `${rb ? `A${rb} ${rb} 0 0 1 ${x + w - rb} ${y + h}` : ''}H${x + rb}${rb ? `A${rb} ${rb} 0 0 1 ${x} ${y + h - rb}` : ''}` +
    `V${y + rt}${rt ? `A${rt} ${rt} 0 0 1 ${x + rt} ${y}` : ''}Z`;
}

// The stage around the phones: background, phone bodies, status bars and the captions.
// The screen areas are left transparent so the recorded screens show through from underneath.
function stageHtml() {
  const SR = 46; // screen corner radius
  const phone = side => {
    const x = PHONE_X[side], sx = x + BEZEL, sy = PHONE_Y + BEZEL;
    const screen = rr(sx, sy, SCREEN_W, STATUS_H + SCREEN_H, SR);
    const hole = rr(sx, HOLE_Y, SCREEN_W, SCREEN_H, 0, SR);
    const cx = sx + SCREEN_W / 2;
    return `
      <path fill-rule="evenodd" fill="#0b0d12" d="${rr(x, PHONE_Y, PHONE_W, PHONE_H, SR + BEZEL)} ${screen}"/>
      <path fill="none" stroke="#4b5563" stroke-width="2" d="${rr(x + 1, PHONE_Y + 1, PHONE_W - 2, PHONE_H - 2, SR + BEZEL - 1)}"/>
      <path fill-rule="evenodd" fill="#ffffff" d="${screen} ${hole}"/>
      <rect x="${cx - 52}" y="${sy + 7}" width="104" height="27" rx="13.5" fill="#000"/>
      <text x="${sx + 34}" y="${sy + 27}" font-size="15" font-weight="700" fill="#0f172a">9:41</text>
      <g fill="#0f172a">
        <rect x="${sx + SCREEN_W - 92}" y="${sy + 22}" width="3.5" height="5" rx="1"/>
        <rect x="${sx + SCREEN_W - 87}" y="${sy + 19}" width="3.5" height="8" rx="1"/>
        <rect x="${sx + SCREEN_W - 82}" y="${sy + 16}" width="3.5" height="11" rx="1"/>
        <rect x="${sx + SCREEN_W - 77}" y="${sy + 13}" width="3.5" height="14" rx="1"/>
        <rect x="${sx + SCREEN_W - 64}" y="${sy + 14}" width="26" height="13" rx="3.5" fill="none" stroke="#0f172a" stroke-width="1.5"/>
        <rect x="${sx + SCREEN_W - 62}" y="${sy + 16}" width="19" height="9" rx="2"/>
        <rect x="${sx + SCREEN_W - 37}" y="${sy + 18.5}" width="2" height="4" rx="1"/>
      </g>
      <rect x="${x - 3}" y="${PHONE_Y + 180}" width="4" height="70" rx="2" fill="#1f2937"/>
      <rect x="${x + PHONE_W - 1}" y="${PHONE_Y + 150}" width="4" height="46" rx="2" fill="#1f2937"/>
      <rect x="${x + PHONE_W - 1}" y="${PHONE_Y + 210}" width="4" height="46" rx="2" fill="#1f2937"/>`;
  };
  const outline = side => rr(PHONE_X[side], PHONE_Y, PHONE_W, PHONE_H, SR + BEZEL);
  const panelW = PHONE_X.left - 60 - 46;
  const logo = 'file:///' + path.join(ROOT, 'public', 'assets', 'logo.svg').replace(/\\/g, '/');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0}
    html,body{width:1920px;height:1080px;overflow:hidden;background:transparent;font-family:"Segoe UI",system-ui,sans-serif}
    svg{position:absolute;inset:0}
    .panel{position:absolute;top:${PHONE_Y + 10}px;height:${PHONE_H - 20}px;width:${panelW}px;display:flex;flex-direction:column;color:#fff}
    .panel.left{left:60px;text-align:right;align-items:flex-end}
    .panel.right{left:${PHONE_X.right + PHONE_W + 46}px;text-align:left;align-items:flex-start}
    .brand{display:flex;align-items:center;gap:12px;font-size:30px;font-weight:800}
    .brand img{width:46px;height:46px}
    .live{display:flex;align-items:center;gap:10px;font-size:22px;font-weight:700;color:#e2e8f0}
    .live i{width:12px;height:12px;border-radius:50%;background:#ef4444;box-shadow:0 0 0 5px rgba(239,68,68,.25)}
    .device{margin-top:26px;font-size:15px;letter-spacing:.14em;text-transform:uppercase;color:#94a3b8;font-weight:700}
    .device b{display:block;margin-top:4px;font-size:22px;letter-spacing:0;text-transform:none;color:#e2e8f0}
    .cap{margin:auto 0;transition:none}
    .cap.dim{opacity:.38}
    .chip{display:inline-block;padding:6px 14px;border-radius:999px;font-size:16px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;margin-bottom:16px}
    .text{font-size:34px;line-height:1.3;font-weight:600}
  </style></head><body>
  <svg width="1920" height="1080" viewBox="0 0 1920 1080">
    <defs>
      <linearGradient id="stagebg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0f1b3d"/><stop offset=".55" stop-color="#0b1730"/><stop offset="1" stop-color="#0b2a2e"/>
      </linearGradient>
    </defs>
    <path id="bg" fill-rule="evenodd" fill="url(#stagebg)" d="M0 0H1920V1080H0Z ${outline('left')} ${outline('right')}"/>
    <g id="phones">${phone('left')}${phone('right')}</g>
  </svg>
  <div class="panel left">
    <div class="brand"><span>9 to 5</span><img src="${logo}" alt=""></div>
    <div class="device">Phone 1<b>Admin &amp; Job Poster</b></div>
    <div class="cap" id="cap-left"></div>
  </div>
  <div class="panel right">
    <div class="live"><i></i>Live demo</div>
    <div class="device">Phone 2<b>Labourers</b></div>
    <div class="cap" id="cap-right"></div>
  </div>
  <script>
    // 'frame': only the phone bodies (they never change). 'captions': background and captions, no phones.
    function setMode(mode) {
      document.getElementById('phones').style.display = mode === 'frame' ? '' : 'none';
      document.getElementById('bg').style.display = mode === 'frame' ? 'none' : '';
      document.querySelectorAll('.panel').forEach(p => (p.style.display = mode === 'frame' ? 'none' : ''));
    }
    function setState(s) {
      for (const side of ['left', 'right']) {
        const el = document.getElementById('cap-' + side), c = s[side];
        el.innerHTML = '';
        el.classList.toggle('dim', !!s.active && s.active !== side);
        if (!c) continue;
        const chip = document.createElement('div');
        chip.className = 'chip';
        chip.style.background = c.color;
        chip.textContent = c.role;
        const text = document.createElement('div');
        text.className = 'text';
        text.textContent = c.text;
        el.append(chip, text);
      }
    }
  </script></body></html>`;
}

// Renders the phone frame once (transparent PNG) and one PNG of the background + captions per caption change.
async function renderStage(t0, t1) {
  console.log('Drawing the phone frames and captions...');
  const dir = path.join(FRAMES_DIR, 'stage');
  fs.mkdirSync(dir, { recursive: true });
  const html = path.join(FRAMES_DIR, 'stage.html');
  fs.writeFileSync(html, stageHtml());

  const cur = { left: null, right: null, active: null };
  const states = [{ t: t0, state: { ...cur } }];
  for (const c of captions.filter(c => c.t > t0 && c.t < t1).sort((a, b) => a.t - b.t)) {
    cur[c.side] = c.text ? { role: c.role, color: c.color, text: c.text } : null;
    if (c.text) cur.active = c.side;
    states.push({ t: c.t, state: { ...cur } });
  }

  const d = await new Builder().forBrowser('chrome')
    .setChromeOptions(new chrome.Options().addArguments('--headless=new', '--window-size=1920,1080', '--hide-scrollbars', '--allow-file-access-from-files'))
    .build();
  try {
    await d.sendDevToolsCommand('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await d.sendDevToolsCommand('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    await d.get('file:///' + html.replace(/\\/g, '/'));
    await d.wait(async () => d.executeScript('return document.fonts.status === "loaded" && [...document.images].every(i => i.complete)'), 10000);
    const shot = async file => {
      const { data } = await d.sendAndGetDevToolsCommand('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 } });
      fs.writeFileSync(file, data, 'base64');
    };
    const frame = path.join(dir, 'phones.png');
    await d.executeScript('setMode("frame")');
    await shot(frame);
    await d.executeScript('setMode("captions")');
    const states2 = [];
    for (const [i, s] of states.entries()) {
      await d.executeScript('setState(arguments[0])', s.state);
      const file = path.join(dir, String(i).padStart(4, '0') + '.png');
      await shot(file);
      states2.push({ t: s.t, file });
    }
    return { frame, captions: states2 };
  } finally {
    await d.quit();
  }
}

async function buildVideo(L, R, t0, t1) {
  const stage = await renderStage(t0, t1);
  console.log('Encoding video...');
  const duration = ((t1 - t0) / 1000).toFixed(3);
  // Pass 1: the background and captions on their own, as an ordinary video (cheap to overlay onto later).
  const backdrop = path.join(FRAMES_DIR, 'backdrop.mp4');
  execFileSync(ffmpeg, [
    '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', concatList('stage', stage.captions, t0, t1),
    '-vf', 'fps=30,format=yuv420p', '-t', duration, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', backdrop,
  ], { stdio: 'inherit' });

  // Pass 2: phone screens onto the backdrop, the phone frames on top, plus the narration.
  const screen = `fps=30,scale=${SCREEN_W}:${SCREEN_H}:flags=lanczos,setsar=1`;
  // Each spoken sentence is delayed to the moment its caption appeared, then all are mixed into one track.
  const lines = narrator.lines.filter(l => l.t >= t0);
  const voices = lines.map((l, i) => `[${4 + i}:a]adelay=${l.t - t0}:all=1[a${i}]`);
  const mix = `${lines.map((_, i) => `[a${i}]`).join('')}amix=inputs=${lines.length}:normalize=0:dropout_transition=0,apad[a]`;
  execFileSync(ffmpeg, [
    '-y', '-loglevel', 'error',
    '-i', backdrop,
    '-f', 'concat', '-safe', '0', '-i', concatList('left', L.frames, t0, t1),
    '-f', 'concat', '-safe', '0', '-i', concatList('right', R.frames, t0, t1),
    '-loop', '1', '-framerate', '30', '-i', stage.frame,
    ...lines.flatMap(l => ['-i', l.file]),
    '-filter_complex', [
      `[1:v]${screen}[l]`,
      `[2:v]${screen}[r]`,
      `[0:v][l]overlay=${holeX('left')}:${HOLE_Y}[b1]`,
      `[b1][r]overlay=${holeX('right')}:${HOLE_Y}[b2]`,
      `[b2][3:v]overlay=0:0:shortest=1,format=yuv420p[v]`,
      ...voices, mix,
    ].join(';'),
    '-map', '[v]', '-map', '[a]', '-t', duration,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', VIDEO,
  ], { stdio: 'inherit' });
}

// ---------------- Main ----------------

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (process.argv.includes('--restore')) {
    if (!fs.existsSync(BACKUP)) return console.log('No backup to restore: your data is already in place.');
    return restoreDb();
  }
  if (process.argv.includes('--encode-only')) {
    if (!fs.existsSync(TIMELINE)) throw new Error('No recording to encode: run npm run demo:record first.');
    return encode();
  }
  // A leftover backup means an earlier run was interrupted before restoring: put that data back first.
  if (fs.existsSync(BACKUP)) {
    console.log('Found a backup from an interrupted run, restoring it first.');
    await restoreDb();
  }

  // Check the voice service works before touching anything (it needs an internet connection).
  try {
    await narrator.clip('Welcome to 9 to 5. It is an app to hire local workers, like plumbers and painters.');
  } catch (err) {
    throw new Error(`Could not generate the narration voice (check your internet connection): ${err.message}`);
  }

  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  await backupDb();
  let server;
  const L = new Pane('left');
  const R = new Pane('right');
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await Promise.all([L.stop(), R.stop()]);
    server?.kill();
    await restoreDb();
  };
  process.once('SIGINT', () => cleanup().finally(() => process.exit(130)));

  let times;
  try {
    resetToDemoData();
    server = await startServer();
    console.log('Starting browsers (the first run may download a matching ChromeDriver)...');
    await Promise.all([L.start(), R.start()]);
    console.log('Recording the demo. This takes about 5 minutes, no need to touch anything.');
    times = await demo(L, R);
  } catch (err) {
    await L.screenshot(path.join(OUT_DIR, 'error-left.png'));
    await R.screenshot(path.join(OUT_DIR, 'error-right.png'));
    console.error('\nRecording failed:', err.message);
    console.error(`Screenshots of both windows were saved in ${OUT_DIR}`);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
  if (!times) return;

  // Saved so `-- --encode-only` can rebuild the video from these frames without recording again.
  fs.writeFileSync(TIMELINE, JSON.stringify({ ...times, left: L.frames, right: R.frames, captions, voice: narrator.lines }));
  await encode();
}

async function encode() {
  const rec = JSON.parse(fs.readFileSync(TIMELINE, 'utf8'));
  captions.splice(0, captions.length, ...rec.captions);
  narrator.lines = rec.voice;
  await buildVideo({ frames: rec.left }, { frames: rec.right }, rec.t0, rec.t1);
  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  console.log(`\nDone! Video saved to ${VIDEO} (${Math.round((rec.t1 - rec.t0) / 1000)} seconds)`);
}

main().then(() => process.exit(process.exitCode || 0)).catch(err => {
  console.error(err);
  console.error(fs.existsSync(BACKUP) ? `\nYour data backup is still at ${BACKUP}. Run: npm run demo:record -- --restore` : '');
  process.exit(1);
});
