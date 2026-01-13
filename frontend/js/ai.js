const AI = {
    worker: null,

    init() {
        if (this.worker) return;
        this.worker = new Worker('js/ai-worker.js');
        this.worker.onmessage = (e) => {
            const move = e.data;
            if (move) {
                // Преобразуем vertical в isVertical для совместимости с Game
                if (move.type === 'wall' && move.isVertical === undefined) {
                    move.isVertical = move.vertical;
                }

                // Разблокировка ввода и применение хода происходят в Game.applyBotMove
                Game.applyBotMove(move);
            } else {
                // Если бот не нашел ходов (не должно быть в норме)
                Game.isInputBlocked = false;
                Game.nextTurn();
            }
        };
        this.worker.onerror = (err) => {
            console.error('[AI] Worker error:', err);
            Game.isInputBlocked = false;
        };
    },

    getBotIndex() {
        return Game.myPlayerIndex === 0 ? 1 : 0;
    },

    makeMove(difficulty = 'medium') {
        this.init();

        const botIdx = this.getBotIndex();

        // Блокировка ввода уже установлена в Game.nextTurn, 
        // но на всякий случай подтверждаем
        Game.isInputBlocked = true;

        console.log(`[AI] Бот (сложность: ${difficulty}) начинает расчет...`);

        // Отправляем состояние в воркер
        this.worker.postMessage({
            state: Game.state,
            botIdx: botIdx,
            difficulty: difficulty
        });
    }
};