const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

const totalCells = 100;
const adminBadges = new Set(['12345', 'admin1', '528987']);

const serialsPath = path.join(__dirname, 'serials.json');
let serials = fs.existsSync(serialsPath) ? JSON.parse(fs.readFileSync(serialsPath, 'utf-8')) : {};

const historyPath = path.join(__dirname, 'cell_history.json');
let cellHistory = fs.existsSync(historyPath) ? JSON.parse(fs.readFileSync(historyPath, 'utf-8')) : {};
for (let i = 1; i <= totalCells; i++) {
  if (!cellHistory[i]) cellHistory[i] = [];
}

let cellStatus = {};
for (let i = 1; i <= totalCells; i++) {
  cellStatus[i] = {
    busy: false,
    badge: null,
    time: null,
    inRepair: false,
    broken: false,
    repairType: null
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
  else res.status(401).send('Unauthorized');
}

app.use(cors({
  origin: 'http://localhost:3000', // поменяй, если фронт на другом хосте
  credentials: true
}));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'frontend')));

// ---------------------- Публичные маршруты ----------------------

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'index.html')));

// Статус ячеек
app.get('/status', (req, res) => {
  res.json(cellStatus);
});

// Сотрудник выбирает и подтверждает ячейку с бейджем
app.post('/manual-badge', (req, res) => {
  const { badge, cell } = req.body;
  if (!badge || !cellStatus[cell]) return res.status(400).send('Ошибка');

  const currentCell = cellStatus[cell];

  if (currentCell.inRepair || currentCell.broken)
    return res.status(423).send('Ячейка в ремонте или сломана');

  // Проверка: нет ли другой занятой ячейки у этого бейджа
  for (let i = 1; i <= totalCells; i++) {
    if (i !== cell && cellStatus[i].badge === badge && cellStatus[i].busy) {
      return res.status(409).json({ conflictCell: i });
    }
  }

  // Если ячейка уже занята другим сотрудником
  if (currentCell.busy && currentCell.badge !== badge) {
    return res.status(403).send('Ячейка занята другим');
  }

  // Если повторно нажал на свою ячейку — освободить
  if (currentCell.busy && currentCell.badge === badge) {
    addHistory(cell, 'released', badge);
    cellStatus[cell] = {
      busy: false,
      badge: null,
      time: new Date(),
      inRepair: false,
      broken: false,
      repairType: null
    };
    return res.sendStatus(200);
  }

  // Всё ок — занимаем ячейку
  cellStatus[cell] = {
    busy: true,
    badge,
    time: new Date(),
    inRepair: false,
    broken: false,
    repairType: null
  };
  addHistory(cell, 'occupied', badge);
  res.sendStatus(200);
});

// ---------------------- Админ-панель ----------------------

app.get('/admin/login', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'admin-login.html')));
app.get('/admin', checkAdminAuth, (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'admin.html')));
app.get('/admin/history-page', checkAdminAuth, (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'history.html')));
app.get('/admin/serials', checkAdminAuth, (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'serials.html')));

// Авторизация
app.post('/admin/login', (req, res) => {
  const { badge } = req.body;
  if (adminBadges.has(badge)) {
    res.cookie('adminBadge', badge, { httpOnly: true, maxAge: 3600 * 1000 });
    res.send({ success: true });
  } else {
    res.status(401).send({ success: false });
  }
});

// История
app.get('/admin/history', checkAdminAuth, (req, res) => {
  res.json(cellHistory);
});

// ---------------------- Админ-действия ----------------------

app.post('/admin/release-cell', checkAdminAuth, (req, res) => {
  const { cell } = req.body;
  const badge = req.cookies['adminBadge'];
  if (!cellStatus[cell]) return res.status(400).send('Ошибка');
  addHistory(cell, 'released', badge, true);
  cellStatus[cell] = {
    busy: false,
    badge: null,
    time: new Date(),
    inRepair: false,
    broken: false,
    repairType: null
  };
  res.sendStatus(200);
});

app.post('/admin/occupy', checkAdminAuth, (req, res) => {
  const { cell, badge } = req.body;
  if (!cellStatus[cell]) return res.status(400).send('Ошибка');
  cellStatus[cell] = {
    busy: true,
    badge,
    time: new Date(),
    inRepair: false,
    broken: false,
    repairType: null
  };
  addHistory(cell, 'occupied', badge, true);
  res.sendStatus(200);
});

app.post('/admin/repair', checkAdminAuth, (req, res) => {
  const { cell, badge } = req.body;
  if (!cellStatus[cell]) return res.status(400).send('Ошибка');
  cellStatus[cell].inRepair = true;
  cellStatus[cell].broken = false;
  cellStatus[cell].repairType = 'repair';
  cellStatus[cell].time = new Date();
  addHistory(cell, 'repaired', badge, true);
  res.sendStatus(200);
});

app.post('/admin/mark-broken', checkAdminAuth, (req, res) => {
  const { cell, badge } = req.body;
  if (!cellStatus[cell]) return res.status(400).send('Ошибка');
  cellStatus[cell].broken = true;
  cellStatus[cell].inRepair = true;
  cellStatus[cell].repairType = 'broken';
  cellStatus[cell].time = new Date();
  addHistory(cell, 'broken', badge, true);
  res.sendStatus(200);
});

app.post('/admin/repair-release', checkAdminAuth, (req, res) => {
  const { cell } = req.body;
  if (!cellStatus[cell]) return res.status(400).send('Ошибка');
  cellStatus[cell] = {
    busy: false,
    badge: null,
    time: new Date(),
    inRepair: false,
    broken: false,
    repairType: null
  };
  addHistory(cell, 'repair_released', '-', true);
  res.sendStatus(200);
});

// ---------------------- Серийники ----------------------

app.post('/admin/bind-serial', checkAdminAuth, (req, res) => {
  const { cell, serial } = req.body;
  if (!cell || !serial) return res.status(400).send('Ошибка');
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