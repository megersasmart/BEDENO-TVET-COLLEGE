const express = require('express');
const cors = require('cors');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const db = new Database(path.join(__dirname, 'bedeno.db'));
db.pragma('foreign_keys=ON');

const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_THIS_SECRET';

db.exec(
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password TEXT,
  role TEXT
);

CREATE TABLE IF NOT EXISTS professions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS trainings(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profession_id INTEGER,
  name TEXT,
  levels INTEGER DEFAULT 3,
  pass_mark REAL DEFAULT 60,
  FOREIGN KEY(profession_id) REFERENCES professions(id)
);

CREATE TABLE IF NOT EXISTS trainees(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trainee_id TEXT UNIQUE,
  full_name TEXT,
  phone TEXT,
  gender TEXT,
  profession_id INTEGER,
  training_id INTEGER,
  current_level INTEGER DEFAULT 1,
  status TEXT DEFAULT 'Active',
  registration_date TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(profession_id) REFERENCES professions(id),
  FOREIGN KEY(training_id) REFERENCES trainings(id)
);

CREATE TABLE IF NOT EXISTS results(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trainee_id INTEGER,
  level INTEGER,
  score REAL,
  grade TEXT,
  status TEXT,
  date TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(trainee_id, level),
  FOREIGN KEY(trainee_id) REFERENCES trainees(id)
);

CREATE TABLE IF NOT EXISTS certificates(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  certificate_no TEXT UNIQUE,
  trainee_id INTEGER,
  final_score REAL,
  final_grade TEXT,
  status TEXT DEFAULT 'PENDING',
  requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
  checked_by TEXT,
  approved_at TEXT,
  remarks TEXT,
  FOREIGN KEY(trainee_id) REFERENCES trainees(id)
);
);

const count = db.prepare(
  'SELECT COUNT(*) c FROM users'
).get().c;

if (!count) {
  const hash = bcrypt.hashSync('admin123', 10);

  db.prepare(
    INSERT INTO users(username,password,role)
    VALUES(?,?,?)
  ).run(
    'admin',
    hash,
    'ADMIN'
  );
}

const pcount = db.prepare(
  'SELECT COUNT(*) c FROM professions'
).get().c;

if (!pcount) {
  [
    'Computer Science',
    'Information Technology (IT)',
    'Accounting',
    'Management',
    'Marketing',
    'Secretarial Science',
    'Nursing',
    'Medical Laboratory',
    'Electrical Installation',
    'Automotive',
    'Construction',
    'Other'
  ].forEach(n => {
    db.prepare(
      'INSERT OR IGNORE INTO professions(name) VALUES(?)'
    ).run(n);
  });
}

function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';

    req.user = jwt.verify(
      h.replace('Bearer ', ''),
      JWT_SECRET
    );

    next();
  } catch (e) {
    res.status(401).json({
      error: 'Unauthorized'
    });
  }
}

function grade(s) {
  return s >= 90 ? 'A'
    : s >= 80 ? 'B'
    : s >= 70 ? 'C'
    : s >= 60 ? 'D'
    : 'F';
}

function traineeByCode(code) {
  return db.prepare(
    SELECT
      t.*,
      p.name profession,
      tr.name training,
      tr.levels,
      tr.pass_mark
    FROM trainees t
    JOIN professions p
      ON p.id=t.profession_id
    JOIN trainings tr
      ON tr.id=t.training_id
    WHERE t.trainee_id=?
  ).get(code);
}

app.post('/api/login', (req, res) => {
  const u = db.prepare(
    'SELECT * FROM users WHERE username=?'
  ).get(req.body.username);

  if (
    !u ||
    !bcrypt.compareSync(
      req.body.password,
      u.password
    )
  ) {
    return res.status(401).json({
      error: 'Invalid login'
    });
  }

  res.json({
    token: jwt.sign(
      {
        id: u.id,
        username: u.username,
        role: u.role
      },
      JWT_SECRET,
      { expiresIn: '12h' }
    ),
    role: u.role,
    username: u.username
  });
  });
app.get('/api/professions', auth, (req, res) => {
  res.json(
    db.prepare(
      'SELECT * FROM professions ORDER BY name'
    ).all()
  );
});

app.get('/api/trainings', auth, (req, res) => {
  res.json(
    db.prepare(
      SELECT
        tr.*,
        p.name profession
      FROM trainings tr
      JOIN professions p
        ON p.id=tr.profession_id
      ORDER BY p.name,tr.name
    ).all()
  );
});

app.post('/api/trainings', auth, (req, res) => {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({
      error: 'Admin only'
    });
  }

  const r = db.prepare(
    INSERT INTO trainings(
      profession_id,
      name,
      levels,
      pass_mark
    )
    VALUES(?,?,?,?)
  ).run(
    req.body.profession_id,
    req.body.name,
    req.body.levels || 3,
    req.body.pass_mark || 60
  );

  res.json({
    id: r.lastInsertRowid
  });
});

app.post('/api/trainees', auth, (req, res) => {
  const d = req.body;

  const n = db.prepare(
    'SELECT COUNT(*) c FROM trainees'
  ).get().c + 1;

  const code =
    'TR-' + String(n).padStart(5, '0');

  const training = db.prepare(
    'SELECT levels FROM trainings WHERE id=?'
  ).get(d.training_id);

  if (!training) {
    return res.status(400).json({
      error: 'Training not found'
    });
  }

  const level = Number(d.level) || 1;

  if (
    level < 1 ||
    level > training.levels
  ) {
    return res.status(400).json({
      error: 'Invalid starting level'
    });
  }

  db.prepare(
    INSERT INTO trainees(
      trainee_id,
      full_name,
      phone,
      gender,
      profession_id,
      training_id,
      current_level
    )
    VALUES(?,?,?,?,?,?,?)
  ).run(
    code,
    d.full_name,
    d.phone,
    d.gender || '',
    d.profession_id,
    d.training_id,
    level
  );

  res.json(
    traineeByCode(code)
  );
});

app.get('/api/trainees', auth, (req, res) => {
  res.json(
    db.prepare(
      SELECT
        t.trainee_id,
        t.full_name,
        t.phone,
        t.gender,
        p.name profession,
        tr.name training,
        t.current_level,
        t.status,
        t.registration_date
      FROM trainees t
      JOIN professions p
        ON p.id=t.profession_id
      JOIN trainings tr
        ON tr.id=t.training_id
      ORDER BY t.id DESC
    ).all()
  );
});

app.get('/api/trainees/:code', auth, (req, res) => {
  const t = traineeByCode(
    req.params.code
  );

  if (!t) {
    return res.status(404).json({
      error: 'Trainee not found'
    });
  }

  const results = db.prepare(
    SELECT *
    FROM results
    WHERE trainee_id=?
    ORDER BY level
  ).all(t.id);

  const cert =
    db.prepare(
      SELECT *
      FROM certificates
      WHERE trainee_id=?
      ORDER BY id DESC
      LIMIT 1
    ).get(t.id) || null;

  res.json({
    ...t,
    results,
    certificate: cert
  });
});
app.post('/api/results', auth, (req, res) => {
  const t = traineeByCode(req.body.trainee_id);

  if (!t) {
    return res.status(404).json({
      error: 'Trainee not found'
    });
  }

  const level = Number(req.body.level);
  const score = Number(req.body.score);

  if (
    !Number.isFinite(level) ||
    !Number.isFinite(score) ||
    level < 1 ||
    level > t.levels ||
    score < 0 ||
    score > 100
  ) {
    return res.status(400).json({
      error: 'Invalid level or score'
    });
  }

  const g = grade(score);
  const status =
    score >= t.pass_mark ? 'PASS' : 'FAIL';

  db.prepare(
    INSERT OR REPLACE INTO results(
      trainee_id,
      level,
      score,
      grade,
      status,
      date
    )
    VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)
  ).run(
    t.id,
    level,
    score,
    g,
    status
  );

  const next =
    status === 'PASS'
      ? Math.min(level + 1, t.levels)
      : level;

  const final =
    status === 'PASS' &&
    level >= t.levels;

  db.prepare(
    UPDATE trainees
    SET current_level=?,
        status=?
    WHERE id=?
  ).run(
    next,
    final ? 'Completed' : 'Active',
    t.id
  );

  res.json({
    trainee: traineeByCode(t.trainee_id),
    grade: g,
    status
  });
});


app.post('/api/certificates/request', auth, (req, res) => {

  const t = traineeByCode(
    req.body.trainee_id
  );

  if (!t || t.status !== 'Completed') {
    return res.status(400).json({
      error: 'Trainee has not completed all levels'
    });
  }

  const existing = db.prepare(
    SELECT *
    FROM certificates
    WHERE trainee_id=?
      AND status IN ('PENDING','APPROVED')
    ORDER BY id DESC
    LIMIT 1
  ).get(t.id);

  if (existing) {
    return res.json(existing);
  }

  const last = db.prepare(
    SELECT score,grade
    FROM results
    WHERE trainee_id=?
    ORDER BY level DESC
    LIMIT 1
  ).get(t.id);

  if (!last) {
    return res.status(400).json({
      error: 'No final result found'
    });
  }

  const no =
    'CERT-' +
    new Date()
      .toISOString()
      .slice(0, 10)
      .replaceAll('-', '') +
    '-' +
    Math.floor(1000 + Math.random() * 9000);

  const r = db.prepare(
    INSERT INTO certificates(
      certificate_no,
      trainee_id,
      final_score,
      final_grade,
      status
    )
    VALUES(?,?,?,?, 'PENDING')
  ).run(
    no,
    t.id,
    last.score,
    last.grade
  );

  res.json(
    db.prepare(
      SELECT *
      FROM certificates
      WHERE id=?
    ).get(r.lastInsertRowid)
  );
});


app.get('/api/certificates/pending', auth, (req, res) => {

  if (
    !['ADMIN', 'COLLEGE']
      .includes(req.user.role)
  ) {
    return res.status(403).json({
      error: 'College approval role required'
    });
  }

  res.json(
    db.prepare(
      SELECT
        c.*,
        t.trainee_id,
        t.full_name,
        p.name profession,
        tr.name training,
        tr.levels
      FROM certificates c
      JOIN trainees t
        ON t.id=c.trainee_id
      JOIN professions p
        ON p.id=t.profession_id
      JOIN trainings tr
        ON tr.id=t.training_id
      WHERE c.status='PENDING'
      ORDER BY c.id DESC
    ).all()
  );
});


app.post('/api/certificates/:no/decision', auth, (req, res) => {

  if (
    !['ADMIN', 'COLLEGE']
      .includes(req.user.role)
  ) {
    return res.status(403).json({
      error: 'College approval role required'
    });
  }

  const c = db.prepare(
    SELECT *
    FROM certificates
    WHERE certificate_no=?
  ).get(req.params.no);

  if (!c) {
    return res.status(404).json({
      error: 'Certificate not found'
    });
  }

  const s = req.body.status;

  if (
    !['APPROVED', 'REJECTED']
      .includes(s)
  ) {
    return res.status(400).json({
      error: 'Invalid decision'
    });
  }

  db.prepare(`
  UPDATE certificates
    SET
      status=?,
      checked_by=?,
      approved_at=
        CASE
          WHEN ?='APPROVED'
          THEN CURRENT_TIMESTAMP
          ELSE NULL
        END,
      remarks=?
    WHERE id=?
  ).run(
    s,
    req.body.checked_by ||
      req.user.username,
    s,
    req.body.remarks || '',
    c.id
  );

  res.json(
    db.prepare(
      SELECT *
      FROM certificates
      WHERE id=?
    ).get(c.id)
  );
});


app.get('/api/certificates/:no', auth, async (req, res) => {

  const c = db.prepare(
    SELECT
      c.*,
      t.trainee_id,
      t.full_name,
      t.phone,
      p.name profession,
      tr.name training,
      tr.levels
    FROM certificates c
    JOIN trainees t
      ON t.id=c.trainee_id
    JOIN professions p
      ON p.id=t.profession_id
    JOIN trainings tr
      ON tr.id=t.training_id
    WHERE c.certificate_no=?
  ).get(req.params.no);

  if (!c) {
    return res.status(404).json({
      error: 'Certificate not found'
    });
  }

  if (c.status !== 'APPROVED') {
    return res.status(403).json({
      error: 'Certificate not approved'
    });
  }

  c.qr = await QRCode.toDataURL(
    'CERT:' + c.certificate_no
  );

  res.json(c);
});


app.get('/api/dashboard', auth, (req, res) => {

  res.json({
    trainees:
      db.prepare(
        'SELECT COUNT(*) c FROM trainees'
      ).get().c,

    active:
      db.prepare(
        SELECT COUNT(*) c
        FROM trainees
        WHERE status='Active'
      ).get().c,

    completed:
      db.prepare(
        SELECT COUNT(*) c
        FROM trainees
        WHERE status='Completed'
      ).get().c,

    pending:
      db.prepare(
        SELECT COUNT(*) c
        FROM certificates
        WHERE status='PENDING'
      ).get().c,

    approved:
      db.prepare(
        SELECT COUNT(*) c
        FROM certificates
        WHERE status='APPROVED'
      `).get().c
  });
});


app.use(
  express.static(
    path.join(__dirname, '../client')
  )
);


app.get(
  '/{*splat}',
  (req, res) =>
    res.sendFile(
      path.join(
        __dirname,
        '../client/index.html'
      )
    )
);


app.listen(
  process.env.PORT || 3000,
  () =>
    console.log(
      'BEDENO server running on port ' +
      (process.env.PORT || 3000)
    )
);
);
