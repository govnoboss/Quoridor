const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

let searchQueue = [];
let lobbyCounter = 1;

app.use(express.static(__dirname));

io.on('connection', (socket) => {
    console.log(`Пользователь подключен: ${socket.id}`);

    // --- Логика поиска игры ---
    socket.on('findGame', () => {
        if (!searchQueue.includes(socket.id)) {
            searchQueue.push(socket.id);
            console.log(`[DEBUG] Игрок ${socket.id} в очереди. Всего: ${searchQueue.length}`);
            
            if (searchQueue.length >= 2) {
                const p1 = searchQueue.shift();
                const p2 = searchQueue.shift();
                const lobbyId = `lobby-${lobbyCounter++}`;
                
                const s1 = io.sockets.sockets.get(p1);
                const s2 = io.sockets.sockets.get(p2);
                
                if (s1 && s2) {
                    s1.join(lobbyId);
                    s2.join(lobbyId);
                    
                    console.log(`[DEBUG] Лобби ${lobbyId} создано. P1(White): ${p1}, P2(Black): ${p2}`);

                    // Отправляем P1, что он играет за БЕЛЫХ
                    s1.emit('gameStart', { lobbyId, color: 'white', opponent: p2 });
                    // Отправляем P2, что он играет за ЧЕРНЫХ
                    s2.emit('gameStart', { lobbyId, color: 'black', opponent: p1 });
                }
            }
        }
    });

    // --- Ретрансляция хода (Relay) ---
    // Сервер получает ход от игрока и отправляет его ВСЕМ ОСТАЛЬНЫМ в комнате
    socket.on('playerMove', (data) => {
        console.log(`[DEBUG] Ход от ${socket.id} в лобби ${data.lobbyId}:`, data.move);
        // socket.to(...) отправляет всем в комнате, КРОМЕ отправителя
        socket.to(data.lobbyId).emit('opponentMove', data.move);
    });

    // --- Отмена и выход ---
    socket.on('cancelSearch', () => {
        const index = searchQueue.indexOf(socket.id);
        if (index > -1) {
            searchQueue.splice(index, 1);
            console.log(`[DEBUG] Игрок ${socket.id} ушел из поиска.`);
        }
    });

    socket.on('disconnect', () => {
        console.log(`[DEBUG] Отключен: ${socket.id}`);
        const index = searchQueue.indexOf(socket.id);
        if (index > -1) searchQueue.splice(index, 1);
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});
