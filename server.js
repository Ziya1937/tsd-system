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

// Загружаем историю или создаём пустую
let cellHistory = {};
if (fs.existsSync(historyPath)) {
  cellHistory = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
} else {
  for (let i = 1; i <= totalCells; i++) {
    cellHistory[i] = [];
  }
}

// Статус ячеек
let cellStatus = {};
for (let i = 1; i <= totalCells; i++) {
  cellStatus[i] = { busy: false, badge: null, time: null, inRepair: false };
}

// Сохраняем историю в файл
function saveHistory() {
  fs.writeFileSync(historyPath, JSON.stringify(cellHistory, null, 2), 'utf-8');
}

// Добавить событие
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

// Middleware для авторизации админа
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
    res.status(401).send({ success: false, message: 'Недействительный бейдж' });
  }
});

app.get('/admin', checkAdminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'admin.html'));
});

// Получить статус
app.get('/status', (req, res) => {
  res.json(cellStatus);
});

// Получить историю
app.get('/admin/history', checkAdminAuth, (req, res) => {
  res.json(cellHistory);
});

// Сотрудник выбирает ячейку
app.post('/select-cell', (req, res) => {
  const { cell } = req.body;
  if (!cellStatus[cell]) return res.status(400).send('Ячейка не найдена');
  if (cellStatus[cell].inRepair) return res.status(409).send('Ячейка в ремонте');

  if (cellStatus[cell].busy) {
    return res.status(409).send('Занята');
  }

  cellStatus[cell].busy = true;
  cellStatus[cell].time = new Date();
  res.sendStatus(200);
});

// Сотрудник вручную вводит бейдж
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
    cellStatus[cell] = { busy: false, badge: null, time: new Date(), inRepair: false };
    return res.sendStatus(200);
  }
});

// Освободить ячейку вручную
app.post('/admin/release-cell', checkAdminAuth, (req, res) => {
  const { cell } = req.body;
  if (!cellStatus[cell]) return res.status(400).send('Ячейка не найдена');
  const badge = req.cookies['adminBadge'];

  addHistory(cell, 'released', badge, true);
  cellStatus[cell] = { busy: false, badge: null, time: new Date(), inRepair: false };
  res.sendStatus(200);
});

// Занять ячейку вручную
app.post('/admin/occupy', checkAdminAuth, (req, res) => {
  const { cell, badge } = req.body;
  if (!cellStatus[cell]) return res.status(400).send('Ячейка не найдена');

  cellStatus[cell] = {
    busy: true,
    badge,
    time: new Date(),
    inRepair: false
  };
  addHistory(cell, 'occupied', badge, true);
  res.sendStatus(200);
});

// Отправить в ремонт
app.post('/admin/repair', checkAdminAuth, (req, res) => {
  const { cell, badge } = req.body;
  if (!cellStatus[cell]) return res.status(400).send('Ячейка не найдена');

  cellStatus[cell].inRepair = true;
  cellStatus[cell].time = new Date();
  addHistory(cell, 'repaired', badge, true);
  res.sendStatus(200);
});

// Вернуть из ремонта
app.post('/admin/repair-release', checkAdminAuth, (req, res) => {
  const { cell } = req.body;
  if (!cellStatus[cell]) return res.status(400).send('Ячейка не найдена');

  cellStatus[cell].inRepair = false;
  cellStatus[cell].time = new Date();
  addHistory(cell, 'repair_released', '-', true);
  res.sendStatus(200);
});

app.listen(port, () => {
  console.log`(Сервер работает на http://localhost:${port})`;
});