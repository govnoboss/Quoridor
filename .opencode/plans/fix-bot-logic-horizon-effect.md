# Fix: Bot Logic — Horizon Effect Causes Backtracking into Mazes

## Problem
Bots repeatedly go back into dead-end mazes after exiting them. This is NOT random epsilon-greedy noise — the minimax evaluation genuinely prefers retreating at shallow search depths.

## Root Cause
**Horizon effect at depth 3 (medium):** The opponent can "waste" a move by placing a wall within the search horizon, making forward progress appear worse than going backward. Examples:
- Forward 3 plies: bot advances → opponent blocks with wall (within horizon) → bot stuck → evaluation: bad
- Backward 3 plies: bot retreats → opponent advances pawn → bot returns to start → evaluation: less bad

## Changes (all in `src/core/ai-core.js`)

### A. Stronger backtracking penalty — `think()` method
- `slice(-6)` → `slice(-10)` — track 10 instead of 6 recent pawn positions
- `score -= 2000` → `score -= 5000` — higher penalty for revisiting recent positions

Lines: 615, 656

### B. Asymmetric distance penalty — `evaluate()` method
After line 212 (`score += (dHuman - dBot) * 100;`), add:
```javascript
// Extra penalty when bot is behind opponent
if (dBot > dHuman) score -= (dBot - dHuman) * 30;
```

### C. Stronger progress weighting — `evaluate()` method
- Line 212: Change `(dHuman - dBot) * 100` → `(dHuman - dBot) * 120`
- Line 251: Change `if (dBot < dHuman) score += 50;` → `if (dBot < dHuman) score += 80;`

## Expected Result
- Bot avoids cycling back to recent positions (stronger penalty + longer memory)
- Bot is more motivated to advance (higher distance weight)
- Bot is punished more for falling behind the opponent (asymmetric penalty)
- Random epsilon-greedy moves (from previous fix) remain untouched

## Verification
- Deploy to server (`62.238.36.105`)
- Wait 2-3 minutes for games to accumulate
- Check bot games have varied turn counts and don't show repetitive back-and-forth patterns
