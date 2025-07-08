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

app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'frontend')));

// ----------- Страницы
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'index.html')));
app.get('/admin/login', (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'admin-login.html')));
app.get('/admin', checkAdminAuth, (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'admin.html')));
app.get('/admin/history-page', checkAdminAuth, (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'history.html')));
app.get('/admin/serials', checkAdminAuth, (req, res) => res.sendFile(path.join(__dirname, 'frontend', 'serials.html')));

// ----------- API
app.post('/admin/login', (req, res) => {
  const { badge } = req.body;
  if (adminBadges.has(badge)) {
    res.cookie('adminBadge', badge, { httpOnly: true, maxAge: 3600 * 1000 });
    res.send({ success: true });
  } else {
    res.status(401).send({ success: false });
  }
});

app.get('/status', (req, res) => res.json(cellStatus));

app.post('/manual-badge', (req, res) => {
  const { badge, cell } = req.body;
  if (!badge || !cellStatus[cell]) return res.status(400).send('Ошибка');

  const currentCell = cellStatus[cell];

  if (currentCell.inRepair || currentCell.broken)
    return res.status(423).send('Ячейка в ремонте или сломана');

  // Проверка: нет ли другой занятой ячейки у этого бейджа
  for (let i = 1; i <= totalCells; i++) {
    if (i !== parseInt(cell) && cellStatus[i].badge === badge && cellStatus[i].busy) {
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

app.get('/admin/history', checkAdminAuth, (req, res) => res.json(cellHistory));
app.get('/admin/serials-data', checkAdminAuth, (req, res) => res.json(serials));

app.post('/admin/bind-serial', checkAdminAuth, (req, res) => {
  const { cell, serial, model } = req.body;
  if (!cell || !serial || !model) return res.status(400).send('Ошибка');

  const imgMap = {
    "ulefone armor x8": "https://img.joomcdn.net/6b21ff0cb47bcebfbab158d0e97e108044656aa8_original.jpeg",
    "ulefone armor 8": "https://avatars.mds.yandex.net/get-mpic/4252138/2a0000019233e47cf0f3607df0272733b0c5/orig",
    "urovo u2": "https://avatars.mds.yandex.net/get-mpic/13969676/2a000001965a96397635354f4f34a53275df/orig",
    "urovo rt40": "https://avatars.mds.yandex.net/get-mpic/4365206/2a000001905e7c5cbaef438cc1276a2860fd/orig",
    "zebra WT6300": "https://scanberry.ru/cache/products/30788/wt6300_front_facing_3x2_3600_0_600_600.webp"
  };

  serials[cell] = {
    serial,
    model,
    imgUrl: imgMap[model.toLowerCase()] || ''
  };

  fs.writeFileSync(serialsPath, JSON.stringify(serials, null, 2));
  res.sendStatus(200);
});

app.post('/admin/verify-admin', (req, res) => {
  const { badge } = req.body;
  if (adminBadges.has(badge)) res.sendStatus(200);
  else res.sendStatus(403);
});

app.delete('/admin/clear-history/:cell', (req, res) => {
  const cell = req.params.cell;
  if (!cellHistory.hasOwnProperty(cell)) return res.status(404).send('Не найдена ячейка');
  cellHistory[cell] = [];
  saveHistory();

  try {
    const data = fs.readFileSync(historyPath, 'utf-8');
    cellHistory = JSON.parse(data);
  } catch (e) {
    console.error('Ошибка при перезагрузке истории после очистки', e);
  }

  res.sendStatus(200);
});

app.post('/admin/update-cell', checkAdminAuth, (req, res) => {
  const { cell, status, badge } = req.body;
  if (!cell || !cellStatus[cell]) return res.status(400).send('Ячейка не найдена');

  switch (status) {
    case 'busy':
      if (!badge) return res.status(400).send('Не указан бейдж');
      cellStatus[cell] = {
        busy: true,
        badge,
        time: new Date(),
        inRepair: false,
        broken: false,
        repairType: null
      };
      addHistory(cell, 'occupied', badge, true);
      break;

    case 'free':
      addHistory(cell, 'released', cellStatus[cell].badge, true);
      cellStatus[cell] = {
        busy: false,
        badge: null,
        time: new Date(),
        inRepair: false,
        broken: false,
        repairType: null
      };
      break;

    case 'repair':
      cellStatus[cell] = {
        busy: false,
        badge: null,
        time: new Date(),
        inRepair: true,
        broken: false,
        repairType: null
      };
      addHistory(cell, 'inRepair', null, true);
      break;

    case 'broken':
      cellStatus[cell] = {
        busy: false,
        badge: null,
        time: new Date(),
        inRepair: false,
        broken: true,
        repairType: null
      };
      addHistory(cell, 'broken', null, true);
      break;

    default:
      return res.status(400).send('Неизвестный статус');
  }

  res.sendStatus(200);
});

app.listen(port, () => {
  console.log(`Сервер работает на http://localhost:${port}`);
});