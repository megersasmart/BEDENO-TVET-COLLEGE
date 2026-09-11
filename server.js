const express = require('express');
const cors = require('cors');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');

const app = express();
app.use(cors());
app.use(express.json({limit:'2mb'}));

const db = new Database(path.join(__dirname,'bedeno.db'));
db.pragma('foreign_keys=ON');
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_THIS_SECRET';

// ---------- DATABASE ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT UNIQUE NOT NULL,
 password TEXT NOT NULL,
 role TEXT NOT NULL,
 active INTEGER DEFAULT 1,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS professions(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS trainings(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 profession_id INTEGER NOT NULL,
 name TEXT NOT NULL,
 levels INTEGER DEFAULT 4,
 pass_mark REAL DEFAULT 60,
 active INTEGER DEFAULT 1,
 FOREIGN KEY(profession_id) REFERENCES professions(id)
);
CREATE TABLE IF NOT EXISTS trainees(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 trainee_id TEXT UNIQUE NOT NULL,
 full_name TEXT NOT NULL,
 phone TEXT,
 gender TEXT,
 profession_id INTEGER NOT NULL,
 training_id INTEGER NOT NULL,
 current_level INTEGER DEFAULT 1,
 status TEXT DEFAULT 'Active',
 local_id TEXT,
 photo TEXT,
 start_date TEXT,
 end_date TEXT,
 registration_date TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(profession_id) REFERENCES professions(id),
 FOREIGN KEY(training_id) REFERENCES trainings(id)
);
CREATE TABLE IF NOT EXISTS results(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 trainee_id INTEGER NOT NULL,
 level INTEGER NOT NULL,
 score REAL NOT NULL,
 grade TEXT NOT NULL,
 status TEXT NOT NULL,
 trainer TEXT,
 date TEXT DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(trainee_id,level),
 FOREIGN KEY(trainee_id) REFERENCES trainees(id)
);
CREATE TABLE IF NOT EXISTS certificates(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 certificate_no TEXT UNIQUE NOT NULL,
 trainee_id INTEGER NOT NULL,
 final_score REAL,
 final_grade TEXT,
 status TEXT DEFAULT 'PENDING',
 requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
 checked_by TEXT,
 approved_at TEXT,
 remarks TEXT,
 FOREIGN KEY(trainee_id) REFERENCES trainees(id)
);
CREATE TABLE IF NOT EXISTS app_settings(
 key TEXT PRIMARY KEY,
 value TEXT
);
CREATE TABLE IF NOT EXISTS login_logs(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER,
 username TEXT,
 success INTEGER NOT NULL,
 ip TEXT,
 user_agent TEXT,
 location TEXT,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// Safe migrations for databases created by earlier versions
for (const sql of [
 "ALTER TABLE trainees ADD COLUMN photo TEXT",
 "ALTER TABLE trainees ADD COLUMN start_date TEXT",
 "ALTER TABLE trainees ADD COLUMN end_date TEXT"
]) { try { db.exec(sql); } catch (e) { if (!String(e.message).includes('duplicate column name')) throw e; } }

const roles={
 ADMIN:'Admin IT',
 COLLEGE:'Register College / Registrar',
 DEAN:'Dean College',
 COORDINATOR:'Training Coordinator',
 TRAINER:'Trainer',
 TRAINEE:'Trainee'
};
const permissions={
 ADMIN:['dashboard','registration','scores','trainees','certificates','settings','trainings'],
 COLLEGE:['dashboard','registration','trainees','certificates'],
 DEAN:['dashboard','trainees','certificates'],
 COORDINATOR:['dashboard','trainees','scores','trainings'],
 TRAINER:['dashboard','scores','trainees'],
 TRAINEE:['dashboard','trainees','certificates']
};

function setSetting(key,value){db.prepare('INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,String(value));}
function getSetting(key){const r=db.prepare('SELECT value FROM app_settings WHERE key=?').get(key);return r?r.value:null;}
if(db.prepare('SELECT COUNT(*) c FROM users').get().c===0){ setSetting('setup_required','1'); }
else {
 const legacy=db.prepare('SELECT * FROM users WHERE username=?').get('admin');
 if(legacy && bcrypt.compareSync('admin123',legacy.password)){
   db.prepare('UPDATE users SET active=0 WHERE id=?').run(legacy.id);
   setSetting('setup_required','1');
 }
}
if(db.prepare('SELECT COUNT(*) c FROM professions').get().c===0){
 [
  'Computer Science','Information Technology (IT)','Accounting','Management','Marketing',
  'Secretarial Science','Nursing','Medical Laboratory','Electrical Installation','Automotive',
  'Construction','Other'
 ].forEach(n=>db.prepare('INSERT OR IGNORE INTO professions(name) VALUES(?)').run(n));
}

function auth(req,res,next){
 try{
  const h=req.headers.authorization||'';
  const token=h.startsWith('Bearer ')?h.slice(7):h;
  req.user=jwt.verify(token,JWT_SECRET);
  const u=db.prepare('SELECT id,username,role,active FROM users WHERE id=?').get(req.user.id);
  if(!u||!u.active) return res.status(401).json({error:'Account disabled'});
  req.user=u; next();
 }catch(e){return res.status(401).json({error:'Unauthorized'});}
}
function allow(...r){return (req,res,next)=>r.includes(req.user.role)?next():res.status(403).json({error:'Permission denied'});}
function grade(s){return s>=90?'A':s>=80?'B':s>=70?'C':s>=60?'D':'F';}
function traineeByCode(code){return db.prepare(`
 SELECT t.*,p.name profession,tr.name training,tr.levels,tr.pass_mark
 FROM trainees t JOIN professions p ON p.id=t.profession_id JOIN trainings tr ON tr.id=t.training_id
 WHERE t.trainee_id=?`).get(code);}
function nextId(){
 const y=new Date().getFullYear();
 const n=db.prepare("SELECT COUNT(*) c FROM trainees WHERE trainee_id LIKE ?").get(`BTC-${y}-%`).c+1;
 return `BTC-${y}-${String(n).padStart(4,'0')}`;
}
function createTrainee(d){
 const training=db.prepare('SELECT * FROM trainings WHERE id=? AND active=1').get(Number(d.training_id));
 if(!training) throw new Error('Training not found');
 const level=Number(d.level||1);
 if(level<1||level>training.levels) throw new Error('Invalid starting level');
 let code=d.trainee_id||nextId();
 while(db.prepare('SELECT 1 FROM trainees WHERE trainee_id=?').get(code)) code=nextId();
 db.prepare(`INSERT INTO trainees(trainee_id,full_name,phone,gender,profession_id,training_id,current_level,status,local_id,photo,start_date,end_date)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(code,String(d.full_name||'').trim(),d.phone||'',d.gender||'',Number(d.profession_id),Number(d.training_id),level,'Active',d.local_id||null,d.photo||null,d.start_date||null,d.end_date||null);
 return traineeByCode(code);
}

// ---------- AUTH ----------
app.get('/api/setup/status',(req,res)=>res.json({required:getSetting('setup_required')==='1'}));
app.post('/api/setup/admin',(req,res)=>{
 try{
  if(getSetting('setup_required')!=='1') return res.status(400).json({error:'Initial setup is already completed'});
  const username=String(req.body.username||'').trim(); const password=String(req.body.password||'');
  if(username.length<4||password.length<8) throw new Error('Username must be at least 4 characters and password at least 8 characters');
  const hash=bcrypt.hashSync(password,12);
  const old=db.prepare('SELECT id FROM users WHERE username=?').get(username);
  if(old) throw new Error('Username already exists');
  const r=db.prepare('INSERT INTO users(username,password,role,active) VALUES(?,?,?,1)').run(username,hash,'ADMIN');
  setSetting('setup_required','0');
  res.json({ok:true,id:r.lastInsertRowid,username});
 }catch(e){res.status(400).json({error:e.message});}
});
app.post('/api/login',async(req,res)=>{
 const username=String(req.body.username||'').trim();
 const u=db.prepare('SELECT * FROM users WHERE username=?').get(username);
 const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').toString().split(',')[0].trim();
 const ua=String(req.headers['user-agent']||'');
 if(!u||!u.active||!bcrypt.compareSync(String(req.body.password||''),u.password)){
   db.prepare('INSERT INTO login_logs(user_id,username,success,ip,user_agent,location) VALUES(?,?,?,?,?,?)').run(u?u.id:null,username,0,ip,ua,'Unknown');
   return res.status(401).json({error:'Invalid login'});
 }
 db.prepare('INSERT INTO login_logs(user_id,username,success,ip,user_agent,location) VALUES(?,?,?,?,?,?)').run(u.id,u.username,1,ip,ua,'IP-based location unavailable');
 res.json({token:jwt.sign({id:u.id,username:u.username,role:u.role},JWT_SECRET,{expiresIn:'12h'}),role:u.role,username:u.username,roleName:roles[u.role],permissions:permissions[u.role]||[]});
});
app.post('/api/auth/change-password',auth,async(req,res)=>{
 try{const current=String(req.body.current_password||'');const next=String(req.body.new_password||'');if(next.length<8)throw new Error('New password must be at least 8 characters');const u=db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);if(!u||!bcrypt.compareSync(current,u.password))throw new Error('Current password is incorrect');db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(next,12),u.id);res.json({ok:true});}catch(e){res.status(400).json({error:e.message});}
});
app.get('/api/audit/login',auth,allow('ADMIN'),(req,res)=>res.json(db.prepare('SELECT id,username,success,ip,user_agent,location,created_at FROM login_logs ORDER BY id DESC LIMIT 200').all()));

app.get('/api/me',auth,(req,res)=>res.json({username:req.user.username,role:req.user.role,roleName:roles[req.user.role],permissions:permissions[req.user.role]||[]}));

// ---------- MASTER DATA ----------
app.get('/api/professions',auth,(req,res)=>res.json(db.prepare('SELECT * FROM professions ORDER BY name').all()));
app.post('/api/professions',auth,allow('ADMIN'),(req,res)=>{
 try{
  const name=String(req.body.name||'').trim();
  if(!name) throw new Error('Profession name is required');
  const r=db.prepare('INSERT INTO professions(name) VALUES(?)').run(name);
  res.json(db.prepare('SELECT * FROM professions WHERE id=?').get(r.lastInsertRowid));
 }catch(e){res.status(400).json({error:e.message});}
});
app.get('/api/trainings',auth,(req,res)=>res.json(db.prepare(`SELECT tr.*,p.name profession FROM trainings tr JOIN professions p ON p.id=tr.profession_id WHERE tr.active=1 ORDER BY p.name,tr.name`).all()));
app.post('/api/trainings',auth,allow('ADMIN','COORDINATOR'),(req,res)=>{
 try{const r=db.prepare('INSERT INTO trainings(profession_id,name,levels,pass_mark) VALUES(?,?,?,?)').run(Number(req.body.profession_id),String(req.body.name||'').trim(),Math.min(4,Math.max(1,Number(req.body.levels||4))),Number(req.body.pass_mark||60));res.json({id:r.lastInsertRowid});}
 catch(e){res.status(400).json({error:e.message});}
});

// ---------- TRAINEES ----------
app.post('/api/trainees',auth,allow('ADMIN','COLLEGE'),(req,res)=>{try{if(!req.body.full_name)throw new Error('Full name is required');res.json(createTrainee(req.body));}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/sync/trainee',auth,allow('ADMIN','COLLEGE'),(req,res)=>{try{
 const d=req.body; if(!d.local_id) throw new Error('local_id required');
 const old=db.prepare('SELECT * FROM trainees WHERE local_id=?').get(d.local_id);
 if(old)return res.json({synced:true,duplicate:true,trainee:traineeByCode(old.trainee_id)});
 res.json({synced:true,duplicate:false,trainee:createTrainee(d)});
}catch(e){res.status(400).json({error:e.message});}});
app.get('/api/trainees',auth,(req,res)=>{
 let rows=db.prepare(`SELECT t.trainee_id,t.full_name,t.phone,t.gender,p.name profession,tr.name training,t.current_level,t.status,t.photo,t.start_date,t.end_date,t.registration_date FROM trainees t JOIN professions p ON p.id=t.profession_id JOIN trainings tr ON tr.id=t.training_id ORDER BY t.id DESC`).all();
 if(req.user.role==='TRAINEE') rows=rows.filter(x=>x.trainee_id===req.user.username);
 res.json(rows);
});
app.get('/api/trainees/:code',auth,(req,res)=>{
 const t=traineeByCode(req.params.code); if(!t)return res.status(404).json({error:'Trainee not found'});
 if(req.user.role==='TRAINEE'&&t.trainee_id!==req.user.username)return res.status(403).json({error:'Permission denied'});
 const results=db.prepare('SELECT * FROM results WHERE trainee_id=? ORDER BY level').all(t.id);
 const certificate=db.prepare('SELECT * FROM certificates WHERE trainee_id=? ORDER BY id DESC LIMIT 1').get(t.id)||null;
 res.json({...t,results,certificate});
});

// ---------- SCORES ----------
app.post('/api/results',auth,allow('ADMIN','COORDINATOR','TRAINER'),(req,res)=>{
 try{
  const t=traineeByCode(req.body.trainee_id); if(!t)throw new Error('Trainee not found');
  const level=Number(req.body.level),score=Number(req.body.score);
  if(!Number.isFinite(level)||!Number.isFinite(score)||level<1||level>t.levels||score<0||score>100)throw new Error('Invalid level or score');
  if(level!==t.current_level&&req.user.role!=='ADMIN')throw new Error(`Trainee is currently on Level ${t.current_level}`);
  const g=grade(score),status=score>=t.pass_mark?'PASS':'FAIL';
  db.prepare(`INSERT OR REPLACE INTO results(trainee_id,level,score,grade,status,trainer,date) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)`).run(t.id,level,score,g,status,req.user.username);
  const completed=status==='PASS'&&level>=t.levels;
  const next=completed?t.levels:status==='PASS'?level+1:level;
  db.prepare('UPDATE trainees SET current_level=?,status=? WHERE id=?').run(next,completed?'Completed':'Active',t.id);
  res.json({trainee:traineeByCode(t.trainee_id),grade:g,status});
 }catch(e){res.status(400).json({error:e.message});}
});

// ---------- CERTIFICATES ----------
app.post('/api/certificates/request',auth,allow('ADMIN','TRAINEE'),(req,res)=>{
 try{
  const t=traineeByCode(req.body.trainee_id);if(!t)throw new Error('Trainee not found');
  if(req.user.role==='TRAINEE'&&t.trainee_id!==req.user.username)throw new Error('Permission denied');
  if(t.status!=='Completed')throw new Error('Trainee has not completed all levels');
  const old=db.prepare("SELECT * FROM certificates WHERE trainee_id=? AND status IN ('PENDING','APPROVED') ORDER BY id DESC LIMIT 1").get(t.id);if(old)return res.json(old);
  const last=db.prepare('SELECT score,grade FROM results WHERE trainee_id=? ORDER BY level DESC LIMIT 1').get(t.id);if(!last)throw new Error('No final result found');
  const no='BTC-CERT-'+new Date().getFullYear()+'-'+String(t.trainee_id).replace(/^BTC-\d{4}-/,'');
  const r=db.prepare(`INSERT INTO certificates(certificate_no,trainee_id,final_score,final_grade,status) VALUES(?,?,?,?,?)`).run(no,t.id,last.score,last.grade,'PENDING');
  res.json(db.prepare('SELECT * FROM certificates WHERE id=?').get(r.lastInsertRowid));
 }catch(e){res.status(400).json({error:e.message});}
});
app.get('/api/certificates/pending',auth,allow('ADMIN','COLLEGE','DEAN'),(req,res)=>res.json(db.prepare(`SELECT c.*,t.trainee_id,t.full_name,p.name profession,tr.name training,tr.levels FROM certificates c JOIN trainees t ON t.id=c.trainee_id JOIN professions p ON p.id=t.profession_id JOIN trainings tr ON tr.id=t.training_id WHERE c.status='PENDING' ORDER BY c.id DESC`).all()));
app.post('/api/certificates/:no/decision',auth,allow('ADMIN','COLLEGE','DEAN'),(req,res)=>{
 const s=req.body.status;if(!['APPROVED','REJECTED'].includes(s))return res.status(400).json({error:'Invalid decision'});
 const c=db.prepare('SELECT * FROM certificates WHERE certificate_no=?').get(req.params.no);if(!c)return res.status(404).json({error:'Certificate not found'});
 db.prepare(`UPDATE certificates SET status=?,checked_by=?,approved_at=CASE WHEN ?='APPROVED' THEN CURRENT_TIMESTAMP ELSE NULL END,remarks=? WHERE id=?`).run(s,req.user.username,s,req.body.remarks||'',c.id);
 res.json(db.prepare('SELECT * FROM certificates WHERE id=?').get(c.id));
});
app.get('/api/certificates/:no',auth,async(req,res)=>{
 const c=db.prepare(`SELECT c.*,t.trainee_id,t.full_name,t.phone,t.photo,t.start_date,t.end_date,p.name profession,tr.name training,tr.levels FROM certificates c JOIN trainees t ON t.id=c.trainee_id JOIN professions p ON p.id=t.profession_id JOIN trainings tr ON tr.id=t.training_id WHERE c.certificate_no=?`).get(req.params.no);
 if(!c)return res.status(404).json({error:'Certificate not found'});if(c.status!=='APPROVED')return res.status(403).json({error:'Certificate not approved'});
 c.qr=await QRCode.toDataURL('CERT:'+c.certificate_no);res.json(c);
});

// ---------- USERS ----------
app.get('/api/users',auth,allow('ADMIN'),(req,res)=>res.json(db.prepare('SELECT id,username,role,active,created_at FROM users ORDER BY id').all()));
app.post('/api/users',auth,allow('ADMIN'),(req,res)=>{
 try{if(!roles[req.body.role])throw new Error('Invalid role');if(!req.body.username||!req.body.password)throw new Error('Username and password are required');if(String(req.body.password).length<8)throw new Error('Password must be at least 8 characters');const hash=bcrypt.hashSync(req.body.password,12);const r=db.prepare('INSERT INTO users(username,password,role) VALUES(?,?,?)').run(String(req.body.username).trim(),hash,req.body.role);res.json({id:r.lastInsertRowid});}catch(e){res.status(400).json({error:e.message});}
});
app.post('/api/users/:id/toggle',auth,allow('ADMIN'),(req,res)=>{try{const id=Number(req.params.id);if(id===req.user.id)throw new Error('You cannot disable your own account');const target=db.prepare('SELECT * FROM users WHERE id=?').get(id);if(!target)throw new Error('User not found');if(target.role==='ADMIN'&&target.active){const n=db.prepare("SELECT COUNT(*) c FROM users WHERE role='ADMIN' AND active=1").get().c;if(n<=1)throw new Error('At least one active admin is required');}db.prepare('UPDATE users SET active=CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id=?').run(id);res.json({ok:true});}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/users/:id/reset-password',auth,allow('ADMIN'),(req,res)=>{try{const id=Number(req.params.id);const password=String(req.body.password||'');if(password.length<8)throw new Error('Password must be at least 8 characters');if(!db.prepare('SELECT id FROM users WHERE id=?').get(id))throw new Error('User not found');db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(password,12),id);res.json({ok:true});}catch(e){res.status(400).json({error:e.message});}});

app.get('/api/roles',(req,res)=>res.json(roles));

// ---------- DASHBOARD ----------
app.get('/api/dashboard',auth,(req,res)=>res.json({
 trainees:db.prepare('SELECT COUNT(*) c FROM trainees').get().c,
 active:db.prepare("SELECT COUNT(*) c FROM trainees WHERE status='Active'").get().c,
 completed:db.prepare("SELECT COUNT(*) c FROM trainees WHERE status='Completed'").get().c,
 pending:db.prepare("SELECT COUNT(*) c FROM certificates WHERE status='PENDING'").get().c,
 approved:db.prepare("SELECT COUNT(*) c FROM certificates WHERE status='APPROVED'").get().c,
 role:req.user.role,roleName:roles[req.user.role]
}));

// ---------- HEALTH ----------
app.get('/api/health',(req,res)=>res.json({ok:true,service:'BEDENO TVET COLLEGE',version:'6.0.0'}));

// ---------- FRONTEND ----------
app.use(express.static(path.join(__dirname,'../client')));
app.get('/{*splat}',(req,res)=>res.sendFile(path.join(__dirname,'../client/index.html')));

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log('BEDENO TVET COLLEGE server running on port '+PORT));
