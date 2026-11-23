# AI Bots and Matchmaking Reference

## Components

| File | Responsibility |
|---|---|
| `src/bots/BotManager.js` | Creates server-side bot engines and manages bot game/move scheduling and fallback integration |
| `src/bots/think-worker.js` | Per-game engine in a Node worker; remaining-time-aware search budget; terminated when the game finishes |
| `src/bots/matchmaking.js` | Pure bot opponent selection helper |
| `src/bots/BotPresenceManager.js` | Simulated online presence/activity for bot accounts |
| `src/bots/defaultBots.js` | Default bot account seed definitions |
| `src/bots/botSeed.js` | Bot seed helper retained in the repository |
| `src/simulation/PopulationManager.js` | Synchronizes configured bot accounts into MongoDB |
| `src/models/BotSettings.js` | Persisted bot settings model |
| `quoridor-engine/engines/v3/` | Bot search engine |
| `quoridor-engine/engines/personality.js` | Per-bot deterministic personality/opening variation |

## Matchmaking helper

`src/bots/matchmaking.js` exports `botIdentity`, `styleOf` and `chooseBot`. The current architecture documentation describes the selection policy as avoid-repeat, least-recently-seen and occasional contrast selection. Inspect the implementation and tests before changing scoring/selection behavior.

## Bot lifecycle

1. Bot population can be synchronized through `syncBotPopulation` / `syncRankedBots` in `src/simulation/PopulationManager.js`.
2. Bot presence is simulated by `BotPresenceManager`.
3. During human matchmaking, `BotManager` can provide a bot fallback when enabled and the configured wait threshold is reached.
4. The bot engine is created from production AI v3 and produces server-side moves.
5. Redis tracks recent bot-vs-human match information to reduce repetitive opponents.

### Opponent mix (`BotManager.selectBot`)

- **Ranked queues** use account bots only (`User.isBot: true`), difficulty derived from account
  rating via `difficultyForRating` (`< 1100` → easy, `>= 1450` → hard, else medium).
- **Casual queues** draw an account bot with probability ~0.45 (when any exist), otherwise a fresh
  guest bot built from the `GUEST_BOTS` template list in `src/bots/defaultBots.js`.
- Every bot move uses a fresh engine seed + `personality(botId)` per game; engines are one instance
  per game and dropped in `finalizeGame` (anti-repetition state must not cross games).

## Relevant environment variables

Admin persistence policy: see `AI_ADMIN.md`. Environment values initialize missing settings; they no longer overwrite Mongo settings on GET/startup. `applyPersistedBotSettings()` applies saved settings at startup; PUT applies runtime changes only after a successful save. GET does not change runtime or persist defaults. Ten-second admin polling preserves dirty inputs. Recalculation errors propagate to the admin API, whose `updated` field is the actual updated count; startup recalculation remains best effort.

Clock v2 (`AI_CLOCKS.md`): the explicit local bot mode is untimed; server fallback bots retain the queue's timed control. Both move delay and search budget adapt to remaining time. `BotManager` keeps one worker/engine per active game and rejects results from a finished/cancelled or newer-revision position. The engine's synchronous search no longer runs on the server event loop. Local AI search tokens are invalidated on hidden/game-over/Undo/Restart and resumed only for the bot's current turn.

The following names appear in `.env.example` and/or Compose/server configuration. Defaults can differ between source and Compose; check both before changing deployment behavior.

- `BOTS_ENABLED`
- `BOT_RANKED_ENABLED`
- `BOT_FALLBACK_MIN_WAIT_MS`
- `BOT_FALLBACK_MAX_WAIT_MS`
- `BOT_MAX_ACTIVE_GAMES`
- `BOT_MOVE_MIN_DELAY_MS`
- `BOT_MOVE_MAX_DELAY_MS`
- `BOT_MAX_RECENT_MATCHES`
- `BOT_RECENT_WINDOW_MS`
- `BOT_ACCOUNT_PASSWORD`

## Tests and tools

- `tests/bot-matchmaking.test.js`
- `quoridor-engine/arena/` for measured engine comparisons
- `quoridor-engine/tools/site-selfplay.js` for production-like site bot self-play

Do not change bot difficulty or selection solely by intuition; use the existing tests/arena/self-play tooling where practical.
