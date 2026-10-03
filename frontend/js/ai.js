const AI = {
    worker: null,
    // Difficulty of the game the worker currently holds an engine for. Sent on every think so a lazily
    // created engine (worker started before newGame arrived) matches the game being played.
    difficulty: 'medium',

    init() {
        if (this.worker) return;
        this.worker = new Worker('/js/ai-worker.js');
        this.worker.onmessage = (e) => {
            const data = e.data;
            if (!data) return;

            if (data.type === 'debug') {
                console.log('%c[LOCAL-AI] ' + data.message, 'color: #d63384; background: #fff0f6; padding: 2px 5px; border-radius: 3px;');
                return;
            }

            if (data.type === 'ready' || data.type === 'error') {
                if (data.type === 'error') console.error('[LOCAL-AI] engine error:', data.message);
                return;
            }

            if (data.type !== 'move') return;

            if (data.move) {
                console.log(`[LOCAL-AI] ${data.move.type} d=${data.depth} n=${data.nodes} ${data.ms}ms`);
                Game.applyBotMove(data.move);
            } else {
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

    /**
     * Start a new game. Must be called before the first makeMove of a game: it makes the worker throw
     * away the engine it used for the previous game so its transposition table cannot leak across games.
     */
    newGame(difficulty = 'medium') {
        this.init();
        this.difficulty = difficulty;
        this.worker.postMessage({ type: 'newGame', difficulty });
    },

    endGame() {
        if (this.worker) this.worker.postMessage({ type: 'endGame' });
    },

    makeMove(difficulty = this.difficulty) {
        this.init();
        this.difficulty = difficulty;

        const botIdx = this.getBotIndex();

        // Ввод блокируется в Game.nextTurn, но подтверждаем ещё раз.
        Game.isInputBlocked = true;

        // Воркер делает глубокий поиск, поэтому клиент не должен ждать его синхронно — состояние
        // уходит structured clone, движок работает с копией и не трогает Game.state.
        this.worker.postMessage({
            state: Game.state,
            botIdx: botIdx,
            difficulty: difficulty
        });
    }
};
