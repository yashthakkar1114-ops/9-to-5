// app.js - single file that handles routing + data + UI
(function(){
    // --- Helpers ---
    const $ = (s, root=document) => root.querySelector(s);
    const $$ = (s, root=document) => Array.from(root.querySelectorAll(s));
    const uid = ()=> Date.now().toString(36) + Math.random().toString(36).slice(2,8);
  
    // --- Storage keys ---
    const KEY = {
      WORKERS: '9to5_workers',
      JOBS: '9to5_jobs',
      BOOKINGS: '9to5_bookings',
      USERS: '9to5_users',
      SESSION: '9to5_session'
    };
  
    // --- Seed data if empty ---
    function seedIfEmpty(){
      if(!localStorage.getItem(KEY.WORKERS)){
        const workers = [
          { id: 'w1', name:'Ram Kumar', type:'Plumber', location:'Andheri', rating:4.5, skills:'Leak repair, Pipe replacement', rate:600 },
          { id: 'w2', name:'Meena Patel', type:'Carpenter', location:'Powai', rating:4.7, skills:'Furniture repair, Doors', rate:800 },
          { id: 'w3', name:'Suresh Singh', type:'Electrician', location:'Lower Parel', rating:4.4, skills:'Wiring, Switchboards', rate:700 },
        ];
        localStorage.setItem(KEY.WORKERS, JSON.stringify(workers));
      }
      if(!localStorage.getItem(KEY.JOBS)){
        const jobs = [
          { id:'j1', title:'Fix bathroom leak', type:'Plumber', location:'Bandra', budget:500, date:'2025-11-15', details:'Leak under sink', postedAt:Date.now() },
        ];
        localStorage.setItem(KEY.JOBS, JSON.stringify(jobs));
      }
      if(!localStorage.getItem(KEY.USERS)){
        const users = [
          { id:'u_admin', name:'admin', email:'admin@9to5.local', role:'admin', password:'admin' },
          { id:'u_client', name:'Test Client', email:'client@demo', role:'client', password:'1234' },
          { id:'u_worker', name:'Demo Worker', email:'worker@demo', role:'worker', password:'1234' }
        ];
        localStorage.setItem(KEY.USERS, JSON.stringify(users));
      }
      if(!localStorage.getItem(KEY.BOOKINGS)){
        localStorage.setItem(KEY.BOOKINGS, JSON.stringify([]));
      }
    }
  
    // --- Data helpers ---
    const read = k => JSON.parse(localStorage.getItem(k) || 'null');
    const write = (k,v) => localStorage.setItem(k, JSON.stringify(v));
  
    // --- Auth (simple) ---
    function getSession(){ return read(KEY.SESSION); }
    function setSession(user){ write(KEY.SESSION, user); }
    function clearSession(){ localStorage.removeItem(KEY.SESSION); }
  
    // --- UI: Workers listing on index.html ---
    function renderWorkers(filter = {}) {
      const grid = $('#workersGrid');
      if(!grid) return;
      const tpl = $('#workerCardTpl');
      const workers = read(KEY.WORKERS) || [];
      const filtered = workers.filter(w=>{
        if(filter.type && filter.type !== '' && w.type !== filter.type) return false;
        if(filter.q && filter.q.trim() !== ''){
          const q = filter.q.toLowerCase();
          if(!(w.name.toLowerCase().includes(q) || (w.skills||'').toLowerCase().includes(q) || w.type.toLowerCase().includes(q))) return false;
        }
        if(filter.location && filter.location.trim() !== '' && !w.location.toLowerCase().includes(filter.location.toLowerCase())) return false;
        return true;
      });
      grid.innerHTML = '';
      if(filtered.length === 0){
        $('#noResults').style.display = 'block';
        return;
      } else $('#noResults').style.display = 'none';
      filtered.forEach(w=>{
        const clone = tpl.content.cloneNode(true);
        clone.querySelector('.name').textContent = w.name + ' • ' + w.type;
        clone.querySelector('.meta').textContent = `${w.location} · ₹${w.rate}/day · ⭐ ${w.rating || '—'}`;
        clone.querySelector('.skills').textContent = w.skills || '';
        clone.querySelector('.worker-photo').src = w.photo || 'assets/placeholder.png';
        const viewBtn = clone.querySelector('.view-btn');
        viewBtn.addEventListener('click', ()=> openWorkerModal(w.id));
        const bookBtn = clone.querySelector('.book-btn');
        bookBtn.addEventListener('click', ()=> startBooking(w.id));
        grid.appendChild(clone);
      });
    }
  
    // --- Modal ---
    function openWorkerModal(id){
      const workers = read(KEY.WORKERS) || [];
      const w = workers.find(x=>x.id===id);
      if(!w) return alert('Worker not found');
      const m = $('#modal');
      const body = $('#modalBody');
      body.innerHTML = `
        <div><img src="${w.photo||'assets/placeholder.png'}" style="width:120px;height:120px;border-radius:8px;object-fit:cover"></div>
        <h2>${w.name}</h2>
        <div class="muted">${w.type} — ${w.location} — ₹${w.rate}/day</div>
        <p>${w.skills || ''}</p>
        <div style="margin-top:12px">
          <button class="btn" id="bookFromModal">Book</button>
          <button class="btn ghost" id="closeModalBtn">Close</button>
        </div>
      `;
      $('#bookFromModal').addEventListener('click', ()=> { m.classList.add('hidden'); startBooking(id); });
      $('#closeModalBtn').addEventListener('click', ()=> m.classList.add('hidden'));
      m.classList.remove('hidden');
    }
    function closeModal(){ const m = $('#modal'); if(m) m.classList.add('hidden'); }
  
    // --- Booking flow (simple) ---
    function startBooking(workerId){
      const session = getSession();
      if(!session || session.role !== 'client'){
        if(confirm('You must be logged in as a client to book. Login now?')) showAuthPrompt();
        return;
      }
      const worker = (read(KEY.WORKERS)||[]).find(w=>w.id===workerId);
      if(!worker) return alert('Worker missing');
      const date = prompt('Enter booking date (YYYY-MM-DD):', '');
      if(!date) return;
      const budget = prompt('Proposed budget (₹):', worker.rate);
      const bookings = read(KEY.BOOKINGS) || [];
      bookings.push({
        id: uid(),
        workerId,
        clientId: session.id,
        date,
        budget: Number(budget)||0,
        status: 'requested',
        createdAt: Date.now()
      });
      write(KEY.BOOKINGS, bookings);
      alert('Booking requested — check Dashboard.');
      renderDashboard();
    }
  
    // --- Post job ---
    function initPostJobForm(){
      const form = $('#postJobForm');
      if(!form) return;
      form.addEventListener('submit', e=>{
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries());
        const session = getSession();
        if(!session || session.role!=='client'){
          alert('Please login as a client to post jobs.');
          return showAuthPrompt();
        }
        const jobs = read(KEY.JOBS) || [];
        jobs.unshift({
          id: uid(),
          title: data.title,
          type: data.type,
          location: data.location,
          budget: Number(data.budget)||0,
          date: data.date,
          details: data.details,
          postedBy: session.id,
          postedAt: Date.now()
        });
        write(KEY.JOBS, jobs);
        $('#postMsg').textContent = 'Job posted successfully!';
        form.reset();
        setTimeout(()=> $('#postMsg').textContent = '', 2500);
      });
    }
  
    // --- Jobs list ---
    function renderJobs(){
      const container = $('#jobsList');
      if(!container) return;
      const jobs = read(KEY.JOBS) || [];
      container.innerHTML = '';
      jobs.slice(0,8).forEach(j=>{
        const el = document.createElement('div');
        el.className = 'card';
        el.innerHTML = `<div><strong>${j.title}</strong> <div class="muted">${j.type} • ${j.location} • ₹${j.budget}</div></div>
                        <div class="muted">${new Date(j.postedAt).toLocaleString()}</div>`;
        container.appendChild(el);
      });
    }
  
    // --- Dashboard ---
    function renderDashboard(){
      const dash = $('#dashContent');
      if(!dash) return;
      const session = getSession();
      if(!session){
        dash.innerHTML = `<div class="card"><p>Please login to see your dashboard.</p><button class="btn" id="loginDash">Login</button></div>`;
        $('#loginDash').addEventListener('click', showAuthPrompt);
        return;
      }
      if(session.role === 'client'){
        const jobs = (read(KEY.JOBS)||[]).filter(j => j.postedBy === session.id);
        const bookings = (read(KEY.BOOKINGS)||[]).filter(b => b.clientId === session.id);
        dash.innerHTML = `<div class="card"><h3>Your Posted Jobs</h3>${jobs.map(j=>`<div class="muted">${j.title} • ${j.type} • ₹${j.budget} • ${j.date}</div>`).join('') || '<div class="muted">No jobs</div>'}</div>
                          <div class="card"><h3>Your Bookings</h3>${bookings.map(b=>`<div>${b.date} • ₹${b.budget} • Status: ${b.status}</div>`).join('') || '<div class="muted">No bookings</div>'}</div>`;
      } else if(session.role === 'worker'){
        const bookings = (read(KEY.BOOKINGS)||[]).filter(b => b.workerId === session.workerId || b.workerId === session.id);
        dash.innerHTML = `<div class="card"><h3>Assigned Bookings</h3>${bookings.map(b=>`<div>${new Date(b.createdAt).toLocaleDateString()} • ${b.date} • ₹${b.budget} • ${b.status}</div>`).join('') || '<div class="muted">No bookings</div>'}</div>`;
      } else if(session.role === 'admin'){
        dash.innerHTML = `<div class="card"><h3>Admin Summary</h3><div class="muted">See admin panel</div></div>`;
      }
    }
  
    // --- Admin view ---
    function renderAdmin(){
      const area = $('#adminArea');
      if(!area) return;
      const users = read(KEY.USERS) || [];
      const workers = read(KEY.WORKERS) || [];
      const jobs = read(KEY.JOBS) || [];
      const bookings = read(KEY.BOOKINGS) || [];
      area.innerHTML = `<h3>Users (${users.length})</h3>
        <div class="muted">${users.map(u=>`${u.email} • ${u.role}`).join('<br>')}</div>
        <h3 style="margin-top:10px">Workers (${workers.length})</h3>
        <div class="muted">${workers.map(w=>`${w.name} • ${w.type} • ${w.location}`).join('<br>')}</div>
        <h3 style="margin-top:10px">Jobs (${jobs.length})</h3>
        <div class="muted">${jobs.map(j=>`${j.title} • ${j.location} • ₹${j.budget}`).join('<br>')}</div>
        <h3 style="margin-top:10px">Bookings (${bookings.length})</h3>
        <div class="muted">${bookings.map(b=>`${b.id} • ${b.date} • ${b.status}`).join('<br>')}</div>
      `;
    }
  
    // --- Auth UI prompt (simple) ---
    function showAuthPrompt(){
      const email = prompt('Enter email for login/signup (demo uses client@demo / worker@demo)') || '';
      if(!email) return;
      const users = read(KEY.USERS) || [];
      let user = users.find(u=>u.email === email);
      if(!user){
        // Signup flow:
        const name = prompt('Name:') || email.split('@')[0];
        const role = prompt('Role: client or worker? (type exactly)') || 'client';
        const pass = prompt('Set a password (min 3 chars)') || '1234';
        user = { id: uid(), name, email, role, password: pass };
        users.push(user);
        write(KEY.USERS, users);
        setSession(user);
        alert('Signed up and logged in as ' + user.name);
        renderDashboard();
        return;
      } else {
        const pass = prompt('Password: (hint: try 1234 or 123)');
        if(pass === user.password){
          setSession(user);
          alert('Logged in as ' + user.name);
          renderDashboard();
          return;
        } else {
          alert('Wrong password');
        }
      }
    }
  
    // --- Init for index page elements ---
    function bindIndex(){
      const authBtn = $('#authBtn');
      if(authBtn){
        authBtn.addEventListener('click', showAuthPrompt);
      }
      const searchBtn = $('#searchBtn');
      function doSearch(){
        const q = $('#searchQuery').value;
        const type = $('#filterType').value;
        const loc = $('#filterLocation').value;
        renderWorkers({ q, type, location: loc });
      }
      if(searchBtn) searchBtn.addEventListener('click', doSearch);
      const modalClose = $('#closeModal');
      if(modalClose) modalClose.addEventListener('click', closeModal);
      // initial data show
      renderWorkers({});
      renderJobs();
    }
  
    function bindPostJob(){
      initPostJobForm();
    }
  
    function bindDashboard(){
      renderDashboard();
      const session = getSession();
      if(session){
        // small sign-out link
        const el = document.createElement('div');
        el.innerHTML = `<div class="muted">Signed in as ${session.name} (${session.role}) — <a href="#" id="signout">Sign out</a></div>`;
        $('#dashContent').prepend(el);
        $('#signout').addEventListener('click', e=>{
          e.preventDefault(); clearSession(); renderDashboard(); alert('Signed out');
        });
      }
    }
  
    function bindAdmin(){
      renderAdmin();
    }
  
    // --- run on load ---
    document.addEventListener('DOMContentLoaded', ()=>{
      seedIfEmpty();
      // bind based on page
      if(document.body.contains($('#workersGrid'))) bindIndex();
      if(document.body.contains($('#postJobForm'))) bindPostJob();
      if(document.body.contains($('#dashContent'))) bindDashboard();
      if(document.body.contains($('#adminArea'))) bindAdmin();
  
      // simple helper: if admin user exists, allow direct admin login button at top (optional)
      // Close modal when clicking outside
      const modal = $('#modal');
      if(modal) modal.addEventListener('click', e=>{ if(e.target === modal) modal.classList.add('hidden'); });
    });
  
  })();
  