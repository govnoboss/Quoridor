# Game Logic: Quoridor

Quoridor is a strategic board game. This document explains the implementation of the game rules and state.

## Board Representation
- **Grid**: 9x9 cells.
- **Pawns**: Two pawns starts at (8, 4) and (0, 4).
- **Walls**: Horizontal and vertical walls, each spanning 2 cells.

## State Object Structure
```javascript
{
  hWalls: Array(8).fill(Array(8).fill(false)), // Horizontal walls
  vWalls: Array(8).fill(Array(8).fill(false)), // Vertical walls
  players: [
    { color: 'white', pos: { r: 8, c: 4 }, wallsLeft: 10 },
    { color: 'black', pos: { r: 0, c: 4 }, wallsLeft: 10 }
  ],
  currentPlayer: 0, // 0 for white, 1 for black
  timers: [600, 600],
  history: [] // Move sequence
}
```

## Core Mechanics

### 1. Pawn Movement (`canMovePawn`)
- Standard: 1 step up, down, left, or right.
- Jumping: If an opponent is in an adjacent square, the player can jump over them.
- Diagonal Jumping: If jumping over an opponent is blocked by a wall or the edge, the player can move diagonally to the squares beside the opponent.

### 2. Wall Placement (`checkWallPlacement`)
- Requirements:
  - Must not overlap or cross another wall.
  - Must leave at least one valid path for BOTH players to their respective target rows (BFS check).
- Orientation: `isVertical` boolean determines if it's a vertical or horizontal wall.

### 3. Victory Conditions
- White wins: Reaches Row 0.
- Black wins: Reaches Row 8.
- Timeout: Current player's timer reaches 0.

## Implementation Details

The `shared.js` file uses a **Reducer Pattern**:
- `gameReducer(state, action)`: Pure function that validates the action and returns a new state.
- **Actions**:
  - `{ type: 'pawn', r, c, playerIdx }`
  - `{ type: 'wall', r, c, isVertical, playerIdx }`

### Utility Functions
- `hasPathToGoal(state, playerIdx)`: Uses Breadth-First Search (BFS) to verify path availability.
- `isWallBetween(state, fr, fc, tr, tc)`: Advanced check to see if a specific step is blocked by any surrounding wall.
