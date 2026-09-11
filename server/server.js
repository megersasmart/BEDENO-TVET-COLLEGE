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

// ---------- DATABASE ----------
const db = new Database(path.join(__dirname, 'bedeno.db'));

db.pragma('foreign_keys=ON');

const JWT_SECRET =
  process.env.JWT_SECRET || 'CHANGE_THIS_SECRET_BEDENO_TVET_COLLEGE';

// ---------- TABLES ----------
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
  UNIQUE(trainee_id, level),
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
`);

// ---------- SAFE MIGRATIONS ----------
const migrations = [
  'ALTER TABLE trainees ADD COLUMN photo TEXT',
  'ALTER TABLE trainees ADD COLUMN start_date TEXT',
  'ALTER TABLE trainees ADD COLUMN end_date TEXT'
];

for (const sql of migrations) {
  try {
    db.exec(sql);
  } catch (e) {
    if (!String(e.message).includes('duplicate column name')) {
      throw e;
    }
  }
}

// ---------- ROLES ----------
const roles = {
  ADMIN: 'Admin IT',
  COLLEGE: 'Register College / Registrar',
  DEAN: 'Dean College',
  COORDINATOR: 'Training Coordinator',
  TRAINER: 'Trainer',
  TRAINEE: 'Trainee'
};

// ---------- PERMISSIONS ----------
const permissions = {
  ADMIN: [
    'dashboard',
    'registration',
    'scores',
    'trainees',
    'certificates',
    'settings',
    'trainings'
  ],

  COLLEGE: [
    'dashboard',
    'registration',
    'trainees',
    'certificates'
  ],

  DEAN: [
    'dashboard',
    'trainees',
    'certificates'
  ],

  COORDINATOR: [
    'dashboard',
    'trainees',
    'scores',
    'trainings'
  ],

  TRAINER: [
    'dashboard',
    'scores',
    'trainees'
  ],

  TRAINEE: [
    'dashboard',
    'trainees',
    'certificates'
  ]
};

// ---------- DEFAULT ADMIN ----------
if (
  db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0
) {
  const hash = bcrypt.hashSync('admin123', 10);

  db.prepare(
    'INSERT INTO users(username,password,role) VALUES(?,?,?)'
  ).run(
    'admin',
    hash,
    'ADMIN'
  );
}

// ---------- DEFAULT PROFESSIONS ----------
if (
  db.prepare('SELECT COUNT(*) AS c FROM professions').get().c === 0
) {
  const professionList = [
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
  ];

  const insertProfession = db.prepare(
    'INSERT OR IGNORE INTO professions(name) VALUES(?)'
  );

  for (const name of professionList) {
    insertProfession.run(name);
  }
}

// ---------- AUTH ----------
function auth(req, res, next) {
  try {
    const header = req.headers.authorization || '';

    const token = header.startsWith('Bearer ')
      ? header.slice(7)
      : header;

    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized'
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    const user = db.prepare(
      'SELECT id,username,role,active FROM users WHERE id=?'
    ).get(decoded.id);

    if (!user || !user.active) {
      return res.status(401).json({
        error: 'Account disabled'
      });
    }

    req.user = user;

    next();
  } catch (e) {
    return res.status(401).json({
      error: 'Unauthorized'
    });
  }
}

// ---------- ROLE CHECK ----------
function allow(...allowedRoles) {
  return (req, res, next) => {
    if (allowedRoles.includes(req.user.role)) {
      return next();
    }

    return res.status(403).json({
      error: 'Permission denied'
    });
  };
}

// ---------- GRADE ----------
function grade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

// ---------- FIND TRAINEE ----------
function traineeByCode(code) {
  return db.prepare(`
    SELECT
      t.*,
      p.name AS profession,
      tr.name AS training,
      tr.levels,
      tr.pass_mark
    FROM trainees t
    JOIN professions p
      ON p.id = t.profession_id
    JOIN trainings tr
      ON tr.id = t.training_id
    WHERE t.trainee_id = ?
  `).get(code);
}

// ---------- AUTOMATIC TRAINEE ID ----------
function nextId() {
  const year = new Date().getFullYear();

  const row = db.prepare(`
    SELECT COUNT(*) AS c
    FROM trainees
    WHERE trainee_id LIKE ?
  `).get(`BTC-${year}-%`);

  return `BTC-${year}-${String(row.c + 1).padStart(4, '0')}`;
}

// ---------- CREATE TRAINEE ----------
function createTrainee(data) {
  const professionId = Number(data.profession_id);
  const trainingId = Number(data.training_id);

  const profession = db.prepare(`
    SELECT *
    FROM professions
    WHERE id = ?
  `).get(professionId);

  if (!profession) {
    throw new Error('Profession not found');
  }

  const training = db.prepare(`
    SELECT *
    FROM trainings
    WHERE id = ?
      AND active = 1
  `).get(trainingId);

  if (!training) {
    throw new Error('Training not found');
  }

  if (Number(training.profession_id) !== professionId) {
    throw new Error(
      'Selected training does not belong to the selected profession'
    );
  }

  const fullName = String(data.full_name || '').trim();

  if (!fullName) {
    throw new Error('Full name is required');
  }

  let level = Number(data.level || 1);

  if (!Number.isInteger(level)) {
    level = 1;
  }

  if (level < 1 || level > training.levels) {
    throw new Error('Invalid starting level');
  }

  let code = String(data.trainee_id || '').trim();

  if (!code) {
    code = nextId();
  }

  while (
    db.prepare(
      'SELECT 1 FROM trainees WHERE trainee_id=?'
    ).get(code)
  ) {
    code = nextId();
  }

  db.prepare(`
    INSERT INTO trainees(
      trainee_id,
      full_name,
      phone,
      gender,
      profession_id,
      training_id,
      current_level,
      status,
      local_id,
      photo,
      start_date,
      end_date
    )
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    code,
    fullName,
    data.phone || '',
    data.gender || '',
    professionId,
    trainingId,
    level,
    'Active',
    data.local_id || null,
    data.photo || null,
    data.start_date || null,
    data.end_date || null
  );

  return traineeByCode(code);
}

// ======================================================
// AUTH API
// ======================================================

app.post('/api/login', (req, res) => {
  try {
    const username = String(
      req.body.username || ''
    ).trim();

    const password = String(
      req.body.password || ''
    );

    const user = db.prepare(`
      SELECT *
      FROM users
      WHERE username = ?
    `).get(username);

    if (
      !user ||
      !user.active ||
      !bcrypt.compareSync(password, user.password)
    ) {
      return res.status(401).json({
        error: 'Invalid login'
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role
      },
      JWT_SECRET,
      {
        expiresIn: '12h'
      }
    );

    res.json({
      token,
      role: user.role,
      username: user.username,
      roleName: roles[user.role],
      permissions: permissions[user.role] || []
    });
  } catch (e) {
    res.status(500).json({
      error: e.message
    });
  }
});

app.get('/api/me', auth, (req, res) => {
  res.json({
    username: req.user.username,
    role: req.user.role,
    roleName: roles[req.user.role],
    permissions: permissions[req.user.role] || []
  });
});

// ======================================================
// MASTER DATA
// ======================================================

app.get('/api/professions', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT *
    FROM professions
    ORDER BY name
  `).all();

  res.json(rows);
});

app.get('/api/trainings', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT
      tr.*,
      p.name AS profession
    FROM trainings tr
    JOIN professions p
      ON p.id = tr.profession_id
    WHERE tr.active = 1
    ORDER BY p.name, tr.name
  `).all();

  res.json(rows);
});

app.post(
  '/api/trainings',
  auth,
  allow('ADMIN', 'COORDINATOR'),
  (req, res) => {
    try {
      const professionId = Number(
        req.body.profession_id
      );

      const name = String(
        req.body.name || ''
      ).trim();

      if (!professionId) {
        throw new Error(
          'Profession is required'
        );
      }

      if (!name) {
        throw new Error(
          'Training name is required'
        );
      }

      const profession = db.prepare(`
        SELECT *
        FROM professions
        WHERE id = ?
      `).get(professionId);

      if (!profession) {
        throw new Error(
          'Profession not found'
        );
      }

      let levels = Number(
        req.body.levels || 4
      );

      levels = Math.min(
        4,
        Math.max(
          1,
          levels
        )
      );

      let passMark = Number(
        req.body.pass_mark || 60
      );

      if (
        !Number.isFinite(passMark) ||
        passMark < 0 ||
        passMark > 100
      ) {
        passMark = 60;
      }

      const result = db.prepare(`
        INSERT INTO trainings(
          profession_id,
          name,
          levels,
          pass_mark
        )
        VALUES(?,?,?,?)
      `).run(
        professionId,
        name,
        levels,
        passMark
      );

      res.json({
        id: result.lastInsertRowid,
        message: 'Training created successfully'
      });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

// ======================================================
// TRAINEES
// ======================================================

app.post(
  '/api/trainees',
  auth,
  allow('ADMIN', 'COLLEGE'),
  (req, res) => {
    try {
      const trainee = createTrainee(
        req.body
      );

      res.json(trainee);
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

// ---------- OFFLINE SYNC ----------
app.post(
  '/api/sync/trainee',
  auth,
  allow('ADMIN', 'COLLEGE'),
  (req, res) => {
    try {
      const data = req.body;

      if (!data.local_id) {
        throw new Error(
          'local_id required'
        );
      }

      const old = db.prepare(`
        SELECT *
        FROM trainees
        WHERE local_id = ?
      `).get(data.local_id);

      if (old) {
        return res.json({
          synced: true,
          duplicate: true,
          trainee: traineeByCode(
            old.trainee_id
          )
        });
      }

      const trainee = createTrainee(
        data
      );

      res.json({
        synced: true,
        duplicate: false,
        trainee
      });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

// ---------- ALL TRAINEES ----------
app.get(
  '/api/trainees',
  auth,
  (req, res) => {
    let rows = db.prepare(`
      SELECT
        t.trainee_id,
        t.full_name,
        t.phone,
        t.gender,
        p.name AS profession,
        tr.name AS training,
        t.current_level,
        t.status,
        t.photo,
        t.start_date,
        t.end_date,
        t.registration_date
      FROM trainees t
      JOIN professions p
        ON p.id = t.profession_id
      JOIN trainings tr
        ON tr.id = t.training_id
      ORDER BY t.id DESC
    `).all();

    if (req.user.role === 'TRAINEE') {
      rows = rows.filter(
        row =>
          row.trainee_id ===
          req.user.username
      );
    }

    res.json(rows);
  }
);

// ---------- SINGLE TRAINEE ----------
app.get(
  '/api/trainees/:code',
  auth,
  (req, res) => {
    const trainee = traineeByCode(
      req.params.code
    );

    if (!trainee) {
      return res.status(404).json({
        error: 'Trainee not found'
      });
    }

    if (
      req.user.role === 'TRAINEE' &&
      trainee.trainee_id !==
        req.user.username
    ) {
      return res.status(403).json({
        error: 'Permission denied'
      });
    }

    const results = db.prepare(`
      SELECT *
      FROM results
      WHERE trainee_id = ?
      ORDER BY level
    `).all(trainee.id);

    const certificate = db.prepare(`
      SELECT *
      FROM certificates
      WHERE trainee_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(trainee.id) || null;

    res.json({
      ...trainee,
      results,
      certificate
    });
  }
);

// ======================================================
// RESULTS / SCORES
// ======================================================

app.post(
  '/api/results',
  auth,
  allow('ADMIN', 'COORDINATOR', 'TRAINER'),
  (req, res) => {
    try {
      const trainee = traineeByCode(
        req.body.trainee_id
      );

      if (!trainee) {
        throw new Error(
          'Trainee not found'
        );
      }

      const level = Number(
        req.body.level
      );

      const score = Number(
        req.body.score
      );

      if (
        !Number.isInteger(level) ||
        !Number.isFinite(score) ||
        level < 1 ||
        level > trainee.levels ||
        score < 0 ||
        score > 100
      ) {
        throw new Error(
          'Invalid level or score'
        );
      }

      if (
        level !== trainee.current_level &&
        req.user.role !== 'ADMIN'
      ) {
        throw new Error(
          `Trainee is currently on Level ${trainee.current_level}`
        );
      }

      const finalGrade = grade(
        score
      );

      const status =
        score >= trainee.pass_mark
          ? 'PASS'
          : 'FAIL';

      db.prepare(`
        INSERT OR REPLACE INTO results(
          trainee_id,
          level,
          score,
          grade,
          status,
          trainer,
          date
        )
        VALUES(
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          CURRENT_TIMESTAMP
        )
      `).run(
        trainee.id,
        level,
        score,
        finalGrade,
        status,
        req.user.username
      );

      const completed =
        status === 'PASS' &&
        level >= trainee.levels;

      const nextLevel = completed
        ? trainee.levels
        : status === 'PASS'
          ? level + 1
          : level;

      const traineeStatus =
        completed
          ? 'Completed'
          : 'Active';

      db.prepare(`
        UPDATE trainees
        SET
          current_level = ?,
          status = ?
        WHERE id = ?
      `).run(
        nextLevel,
        traineeStatus,
        trainee.id
      );

      res.json({
        trainee: traineeByCode(
          trainee.trainee_id
        ),
        grade: finalGrade,
        status
      });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

// ======================================================
// CERTIFICATES
// ======================================================

// ---------- REQUEST CERTIFICATE ----------
app.post(
  '/api/certificates/request',
  auth,
  allow('ADMIN', 'TRAINEE'),
  (req, res) => {
    try {
      const trainee = traineeByCode(
        req.body.trainee_id
      );

      if (!trainee) {
        throw new Error(
          'Trainee not found'
        );
      }

      if (
        req.user.role === 'TRAINEE' &&
        trainee.trainee_id !==
          req.user.username
      ) {
        throw new Error(
          'Permission denied'
        );
      }

      if (
        trainee.status !== 'Completed'
      ) {
        throw new Error(
          'Trainee has not completed all levels'
        );
      }

      const existing = db.prepare(`
        SELECT *
        FROM certificates
        WHERE trainee_id = ?
          AND status IN ('PENDING','APPROVED')
        ORDER BY id DESC
        LIMIT 1
      `).get(trainee.id);

      if (existing) {
        return res.json(existing);
      }

      const lastResult = db.prepare(`
        SELECT
          score,
          grade
        FROM results
        WHERE trainee_id = ?
        ORDER BY level DESC
        LIMIT 1
      `).get(trainee.id);

      if (!lastResult) {
        throw new Error(
          'No final result found'
        );
      }

      const year =
        new Date().getFullYear();

      const number =
        String(
          trainee.trainee_id
        ).replace(
          /^BTC-\d{4}-/,
          ''
        );

      const certificateNo =
        `BTC-CERT-${year}-${number}`;

      const result = db.prepare(`
        INSERT INTO certificates(
          certificate_no,
          trainee_id,
          final_score,
          final_grade,
          status
        )
        VALUES(?,?,?,?,?)
      `).run(
        certificateNo,
        trainee.id,
        lastResult.score,
        lastResult.grade,
        'PENDING'
      );

      const certificate =
        db.prepare(`
          SELECT *
          FROM certificates
          WHERE id = ?
        `).get(
          result.lastInsertRowid
        );

      res.json(certificate);
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

// ---------- PENDING CERTIFICATES ----------
app.get(
  '/api/certificates/pending',
  auth,
  allow('ADMIN', 'COLLEGE', 'DEAN'),
  (req, res) => {
    const rows = db.prepare(`
      SELECT
        c.*,
        t.trainee_id,
        t.full_name,
        p.name AS profession,
        tr.name AS training,
        tr.levels
      FROM certificates c
      JOIN trainees t
        ON t.id = c.trainee_id
      JOIN professions p
        ON p.id = t.profession_id
      JOIN trainings tr
        ON tr.id = t.training_id
      WHERE c.status = 'PENDING'
      ORDER BY c.id DESC
    `).all();

    res.json(rows);
  }
);

// ---------- APPROVE / REJECT ----------
app.post(
  '/api/certificates/:no/decision',
  auth,
  allow('ADMIN', 'COLLEGE', 'DEAN'),
  (req, res) => {
    try {
      const status =
        String(
          req.body.status || ''
        ).toUpperCase();

      if (
        !['APPROVED', 'REJECTED'].includes(
          status
        )
      ) {
        return res.status(400).json({
          error: 'Invalid decision'
        });
      }

      const certificate =
        db.prepare(`
          SELECT *
          FROM certificates
          WHERE certificate_no = ?
        `).get(req.params.no);

      if (!certificate) {
        return res.status(404).json({
          error: 'Certificate not found'
        });
      }

      db.prepare(`
        UPDATE certificates
        SET
          status = ?,
          checked_by = ?,
          approved_at =
            CASE
              WHEN ? = 'APPROVED'
              THEN CURRENT_TIMESTAMP
              ELSE NULL
            END,
          remarks = ?
        WHERE id = ?
      `).run(
        status,
        req.user.username,
        status,
        req.body.remarks || '',
        certificate.id
      );

      const updated =
        db.prepare(`
          SELECT *
          FROM certificates
          WHERE id = ?
        `).get(
          certificate.id
        );

      res.json(updated);
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

// ---------- APPROVED CERTIFICATE ----------
app.get(
  '/api/certificates/:no',
  auth,
  async (req, res) => {
    try {
      const certificate =
        db.prepare(`
          SELECT
            c.*,
            t.trainee_id,
            t.full_name,
            t.phone,
            t.photo,
            t.start_date,
            t.end_date,
            p.name AS profession,
            tr.name AS training,
            tr.levels
          FROM certificates c
          JOIN trainees t
            ON t.id = c.trainee_id
          JOIN professions p
            ON p.id = t.profession_id
          JOIN trainings tr
            ON tr.id = t.training_id
          WHERE c.certificate_no = ?
        `).get(req.params.no);

      if (!certificate) {
        return res.status(404).json({
          error: 'Certificate not found'
        });
      }

      if (
        certificate.status !== 'APPROVED'
      ) {
        return res.status(403).json({
          error: 'Certificate not approved'
        });
      }

      certificate.qr =
        await QRCode.toDataURL(
          'CERT:' +
          certificate.certificate_no
        );

      res.json(certificate);
    } catch (e) {
      res.status(500).json({
        error: e.message
      });
    }
  }
);

// ======================================================
// USERS
// ======================================================

app.get(
  '/api/users',
  auth,
  allow('ADMIN'),
  (req, res) => {
    const users = db.prepare(`
      SELECT
        id,
        username,
        role,
        active,
        created_at
      FROM users
      ORDER BY id
    `).all();

    res.json(users);
  }
);

app.post(
  '/api/users',
  auth,
  allow('ADMIN'),
  (req, res) => {
    try {
      const role =
        String(
          req.body.role || ''
        ).toUpperCase();

      const username =
        String(
          req.body.username || ''
        ).trim();

      const password =
        String(
          req.body.password || ''
        );

      if (!roles[role]) {
        throw new Error(
          'Invalid role'
        );
      }

      if (!username || !password) {
        throw new Error(
          'Username and password are required'
        );
      }

      const hash =
        bcrypt.hashSync(
          password,
          10
        );

      const result =
        db.prepare(`
          INSERT INTO users(
            username,
            password,
            role
          )
          VALUES(?,?,?)
        `).run(
          username,
          hash,
          role
        );

      res.json({
        id: result.lastInsertRowid,
        message: 'User created successfully'
      });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

// ---------- ENABLE / DISABLE USER ----------
app.post(
  '/api/users/:id/toggle',
  auth,
  allow('ADMIN'),
  (req, res) => {
    try {
      db.prepare(`
        UPDATE users
        SET active =
          CASE active
            WHEN 1 THEN 0
            ELSE 1
          END
        WHERE id = ?
      `).run(
        Number(req.params.id)
      );

      res.json({
        ok: true
      });
    } catch (e) {
      res.status(400).json({
        error: e.message
      });
    }
  }
);

// ---------- ROLES ----------
app.get(
  '/api/roles',
  (req, res) => {
    res.json(roles);
  }
);

// ======================================================
// DASHBOARD
// ======================================================

app.get(
  '/api/dashboard',
  auth,
  (req, res) => {
    const total =
      db.prepare(`
        SELECT COUNT(*) AS c
        FROM trainees
      `).get().c;

    const active =
      db.prepare(`
        SELECT COUNT(*) AS c
        FROM trainees
        WHERE status = 'Active'
      `).get().c;

    const completed =
      db.prepare(`
        SELECT COUNT(*) AS c
        FROM trainees
        WHERE status = 'Completed'
      `).get().c;

    const pending =
      db.prepare(`
        SELECT COUNT(*) AS c
        FROM certificates
        WHERE status = 'PENDING'
      `).get().c;

    const approved =
      db.prepare(`
        SELECT COUNT(*) AS c
        FROM certificates
        WHERE status = 'APPROVED'
      `).get().c;

    res.json({
      trainees: total,
      active,
      completed,
      pending,
      approved,
      role: req.user.role,
      roleName: roles[req.user.role]
    });
  }
);

// ======================================================
// HEALTH CHECK
// ======================================================

app.get(
  '/api/health',
  (req, res) => {
    res.json({
      ok: true,
      service: 'BEDENO TVET COLLEGE',
      version: '4.0.0'
    });
  }
);

// ======================================================
// FRONTEND
// ======================================================

app.use(
  express.static(
    path.join(
      __dirname,
      '../client'
    )
  )
);

// Express 5 SPA fallback
app.get(
  '/{*splat}',
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        '../client/index.html'
      )
    );
  }
);

// ======================================================
// SERVER
// ======================================================

const PORT =
  process.env.PORT || 3000;

app.listen(
  PORT,
  () => {
    console.log(
      'BEDENO TVET COLLEGE server running on port ' +
      PORT
    );
  }
);
