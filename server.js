const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const port = 3000;

let cellStatus = {};
let currentCell = null;

app.use(bodyParser.json());
app.use(express.static('frontend'));

app.post('/select-cell', (req, res) => {
  currentCell = req.body.cell;
  res.sendStatus(200);
});

app.post('/scan', (req, res) => {
  if (!currentCell) return res.status(400).send("Ячейка не выбрана");
  const badge = req.body.badge;
  const isBusy = cellStatus[currentCell]?.busy;

  cellStatus[currentCell] = {
    busy: !isBusy,
    user: isBusy ? null : badge,
    time: new Date().toLocaleString()
  };

  console.log(`Ячейка ${currentCell}: ${isBusy ? 'возврат' : 'выдача'} ТСД сотруднику ${badge}`);
  currentCell = null;
  res.send({ success: true });
});

app.get('/status', (req, res) => {
  res.json(cellStatus);
});

app.listen(port, () => {
  console.log(`Сервер работает на http://localhost:${port}`);
});