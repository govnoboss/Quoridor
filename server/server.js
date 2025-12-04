const http = require('http');

const server = http.createServer((req, res) => {
  res.end('Привет! Сервер работает! 🎉');
});

server.listen(3000, () => {
  console.log('Сервер запущен — открой в браузере: http://localhost:3000');
});