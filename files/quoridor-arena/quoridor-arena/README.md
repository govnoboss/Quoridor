# quoridor-arena

Арена для сравнения движков: парные партии (одна и та же дебютная позиция с обменом цветов), Elo с доверительным интервалом, SPRT (ранняя остановка), round-robin с рейтингом Bradley-Terry, параллельные партии через `worker_threads`, лог каждой партии в JSONL.

Проверено на игре-заглушке (`adapters/toy.js`, Nim): `npm test`, `npm run rr-test`. Адаптер под Quoridor (`adapters/site.js`) **не запускался**: сигнатуры в нём предположительные (помечены `ADAPT`).

## Запуск

```bash
# матч с SPRT: принять новую версию, только если она лучше на >= 5 Elo
node src/cli.js match --adapter ./adapters/site.js --bots ./bots.json \
     --a v1 --b v0-hard --games 4000 --movetime 100 --sprt 0,5 --out results/v1-vs-v0.jsonl

# все против всех + рейтинг (якорь: v0-medium = 0)
node src/cli.js roundrobin --adapter ./adapters/site.js --bots ./bots.json \
     --games 200 --movetime 100 --anchor v0-medium
```

Флаги: `--threads N` (по умолчанию ядра-1), `--seed`, `--movetime ms | --depth N | --nodes N`, `--opening-plies N` (по умолчанию 4 случайных полухода), `--max-plies 300`, `--no-moves`.

## Что нужно доделать под сайт (для ИИ-помощника)

1. **`adapters/site.js`**: подставить реальные сигнатуры `Shared.createInitialState`, `gameReducer`, `getJumpTargets`, формат хода-стены, проверку победы. `applyMove` обязан использовать ту же валидацию, что и сервер (иначе арена будет судить по другим правилам).
2. **`ai-core.js` -> `think(state, botIdx, difficulty, opts)`**: учитывать `opts.timeMs`, `opts.depth`, `opts.nodes` (сейчас захардкожено 2000 мс и глубины по сложности), `opts.params` (веса оценки, `MAX_WALL_MOVES`, радиус кандидатов стен), `opts.rng` (seedable вместо `Math.random`).
3. **Убрать глобальное состояние**: `tt`, `killerMoves`, `deadline`, `nodesVisited` должны жить в экземпляре движка (`new Engine(params)`), метод `reset()` вызывается в начале партии. Иначе два бота в одном процессе портят друг другу кэш.
4. **Исправить перспективу TT**: оценка в TT должна быть с точки зрения стороны, чей ход (negamax), либо ключ должен включать `botIdx`.
5. **Ограничение по узлам** (`limits.nodes`) для воспроизводимых тестов: проверять счётчик узлов рядом с проверкой дедлайна.
6. Добавить в `bots.json` версии: `{ "v1": { "difficulty": "hard", "params": { ... } } }`.
7. Отдельно написать **perft** для правил (число листьев на глубине 1-4) и сверить с независимой реализацией.

## Правила методики

- `--games` чётное: партии 2k и 2k+1 начинаются с одной позиции, цвета меняются.
- Для сравнения версий используйте **одинаковый лимит** (время или узлы) обоим ботам. Во время матчей по времени не нагружайте машину.
- Изменение принимается только по SPRT. Погрешность Elo ≈ ±680/sqrt(N) (95%).
- В пуле держите якоря: старые версии, `easy`, `medium`.

## Формат лога (одна строка = одна партия)

`{a, b, gameId, openingId, aFirst, aScore, plies, openingLen, reason, timeMs:[a,b], moves:[...]}`
`reason`: `win | repetition | maxplies | illegal:.. | crash:.. | no-move`. Нелегальный ход или падение = поражение виновного.
