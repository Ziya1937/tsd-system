const readline = require('readline');
const axios = require('axios');

readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);

let badge = '';

process.stdin.on('data', async (chunk) => {
  const char = chunk.toString();

  if (char === '\r' || char === '\n') {
    if (badge.trim()) {
      try {
        await axios.post('http://localhost:3000/scan', { badge });
        console.log(`✅ Отправлен бейдж: ${badge}`);
      } catch (err) {
        console.log('❌ Ошибка отправки:', err.message);
      }
      badge = '';
    }
  } else {
    badge += char;
  }
});