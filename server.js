const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(cookieParser());

const adminBadges = new Set(['12345', '528987', 'admin1']);
const totalCells = 100;

const historyPath = path.join(__dirname, 'cell_history.json');
const serialsPath = path.join(__dirname, 'serials.json');

let cellHistory = fs.existsSync(historyPath)
  ? JSON.parse(fs.readFileSync(historyPath, 'utf-8'))
  : Object.fromEntries(Array.from({ length: totalCells }, (_, i) => [i + 1, []]));

let serials = fs.existsSync(serialsPath)
  ? JSON.parse(fs.readFileSync(serialsPath, 'utf-8'))
  : {};

let cellStatus = {};
for (let i = 1; i <= totalCells; i++) {
  cellStatus[i] = {
    busy: false,
    badge: null,
    time: null,
    inRepair: false,
    repairType: null // может быть 'repair' или 'broken'
  };
}

function saveHistory() {
  fs.writeFileSync(historyPath, JSON.stringify(cellHistory, null, 2), 'utf-8');
}

function addHistory(cell, action, badge, admin = false) {
  const event = {
    timestamp: new Date().toISOString(),
    action,
    badge,
    admin
  };
  cellHistory[cell].push(event);
  saveHistory();
}

function checkAdminAuth(req, res, next) {
  const badge = req.cookies['adminBadge'];
  if (badge && adminBadges.has(badge)) next();
  else res.redirect('/admin/login');
}

app.use(express.static(path.join(__dirname, 'frontend')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'admin-login.html'));
});

app.post('/admin/login', (req, res) => {
  const { badge } = req.body;
  if (adminBadges.has(badge)) {
    res.cookie('adminBadge', badge, { httpOnly: true, maxAge: 3600 * 1000 });
    res.send({ success: true });
  } else {
    res.status(401).send({ success: false, message: 'Недействительный ID' });
  }
});

app.get('/admin', checkAdminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'admin.html'));
});

app.get('/admin/history-page', checkAdminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'history.html'));
});

app.get('/admin/serials', checkAdminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'serials.html'));
});

app.get('/status', (req, res) => {
  res.json(cellStatus);
});

app.get('/admin/history', checkAdminAuth, (req, res) => {
  res.json(cellHistory);
});

app.post('/select-cell', (req, res) => {
  const { cell } = req.body;
  if (!cellStatus[cell]) return res.status(400).send('Ячейка не найдена');
  if (cellStatus[cell].inRepair) return res.status(423).send('Ячейка недоступна');

  if (cellStatus[cell].busy) return res.status(409).send('Занята');

  cellStatus[cell].busy = true;
  cellStatus[cell].time = new Date();
  res.sendStatus(200);
});

app.post('/manual-badge', (req, res) => {
  const { badge, cell } = req.body;
  if (!cellStatus[cell]) return res.status(400).send('Ячейка не найдена');
  if (!cellStatus[cell].busy) return res.status(409).send('Ячейка не занята');

  if (cellStatus[cell].badge && cellStatus[cell].badge !== badge) {
    return res.status(403).send('Чужая ячейка');
  }

  if (!cellStatus[cell].badge) {
    cellStatus[cell].badge = badge;
    cellStatus[cell].time = new Date();
    addHistory(cell, 'occupied', badge);
    return res.sendStatus(200);
  } else {
    addHistory(cell, 'released', badge);
    cellStatus[cell] = {
      busy: false,
      badge: null,
      time: new Date(),
      inRepair: false,
      repairType: null
    };
    return res.sendStatus(200);
  }
});

app.post('/admin/release-cell', checkAdminAuth, (req, res) => {
  const { cell } = req.body;
  if (!cellStatus[cell]) return res.status(400).send('Ячейка не найдена');

  const badge = req.cookies['adminBadge'];
  addHistory(cell, 'released', badge, true);

  cellStatus[cell] = {
    busy: false,
    badge: null,
    time: new Date(),
    inRepair: false,
    repairType: null
  };
  res.sendStatus(200);
});

app.post('/admin/occupy', checkAdminAuth, (req, res) => {
  const { cell, badge } = req.body;
  if (!cellStatus[cell]) return res.status(400).send('Ячейка не найдена');

  cellStatus[cell] = {
    busy: true,
    badge,
    time: new Date(),
    inRepair: false,
    repairType: null
  };
  addHistory(cell, 'occupied', badge, true);
  res.sendStatus(200);
});

app.post('/admin/repair', checkAdminAuth, (req, res) => {
  const { cell, badge } = req.body;
  if (!cellStatus[cell]) return res.status(400).send('Ячейка не найдена');

  cellStatus[cell].inRepair = true;
  cellStatus[cell].repairType = 'repair';
  cellStatus[cell].time = new Date();
  addHistory(cell, 'repaired', badge, true);
  res.sendStatus(200);
});

app.post('/admin/mark-broken', checkAdminAuth, (req, res) => {
  const { cell, badge } = req.body;
  if (!cellStatus[cell]) return res.status(400).send('Ячейка не найдена');

  cellStatus[cell].inRepair = true;
  cellStatus[cell].repairType = 'broken';
  cellStatus[cell].time = new Date();
  addHistory(cell, 'broken', badge, true);
  res.sendStatus(200);
});

app.post('/admin/repair-release', checkAdminAuth, (req, res) => {
  const { cell } = req.body;
  if (!cellStatus[cell]) return res.status(400).send('Ячейка не найдена');

  cellStatus[cell] = {
    busy: false,
    badge: null,
    time: new Date(),
    inRepair: false,
    isBroken: false
  };

  addHistory(cell, 'released', '-', true);
  res.sendStatus(200);
});

app.post('/admin/bind-serial', checkAdminAuth, (req, res) => {
  const { cell, serial } = req.body;
  if (!cell || !serial) return res.status(400).send('Неверные данные');

  serials[cell] = serial;
  fs.writeFileSync(serialsPath, JSON.stringify(serials, null, 2));
  res.sendStatus(200);
});

app.get('/admin/serial-by-cell', checkAdminAuth, (req, res) => {
  const { cell } = req.query;
  res.json({ serial: serials[cell] || null });
});

app.get('/admin/cell-by-serial', checkAdminAuth, (req, res) => {
  const { serial } = req.query;
  const entry = Object.entries(serials).find(([_, s]) => s === serial);
  res.json({ cell: entry ? entry[0] : null });
});

app.listen(port, () => {
  console.log(`Сервер работает на http://localhost:${port}`);
});