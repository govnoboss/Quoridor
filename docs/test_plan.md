# Quoridor Test Plan

This document outlines the key game mechanics and scenarios that need to be tested to ensure the robustness of the Quoridor game logic.

## Goal
Create a suite of automated tests (using `test_shared.js` or similar) to verify core rules and edge cases.

## Test Scenarios

### 1. Pawn Movement ♟️
- [ ] **Basic Movement:** Verify orthogonal movement (up, down, left, right) to adjacent empty cells.
- [ ] **Boundaries:** Ensure pawns cannot move off the board (0-8 index range).
- [ ] **Wall Collision:** Ensure pawns cannot move through placed walls (horizontal and vertical).
- [ ] **Opponent Interaction (Jumps):**
    - [ ] **Straight Jump:** Jump over an adjacent opponent into the cell behind them.
    - [ ] **Diagonal Jump:** When the cell behind the opponent is blocked (by wall or board edge), jump diagonally to the sides of the opponent.
    - [ ] **Invalid Jump:** Ensure cannot jump if both straight and diagonal paths are blocked.

### 2. Wall Placement 🧱
- [ ] **Basic Placement:** Place horizontal and vertical walls in valid slots.
- [ ] **Overlap/Intersection:**
    - [ ] Cannot place a wall on top of another wall.
    - [ ] Cannot place a vertical wall crossing a horizontal wall (and vice versa).
    - [ ] Cannot partially overlap (though Quoridor walls are 2 cells long, standard logic treats them as atomic units).
- [ ] **Bounds:** Cannot place walls outside the 8x8 slot grid.
- [ ] **Wall Count:** Verify player's wall count decreases after placement.
- [ ] **Path Validation (Critical):**
    - [ ] **Blocking Goal:** It is ILLEGAL to place a wall that completely cuts off ANY player from their goal line.
    - [ ] Verify `isValidWallPlacement` correctly identifies blocking states for both players.

### 3. Game State & Win Conditions 🏆
- [ ] **Turn Management:** Ensure current player index toggles correctly after a move.
- [ ] **Victory:** Detect win condition immediately when a player reaches their target row (Row 0 for White/Player 0, Row 8 for Black/Player 1).

## Implementation Strategy
- Expand `test_shared.js` into a more robust test suite.
- Use a simple assert-based approach (Node.js built-in `assert`).
- Create helper functions to set up specific board states (e.g., `setupBoardWithWalls(...)`) to make tests readable.
