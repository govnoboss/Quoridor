require('dotenv').config();

const connectDB = require('../src/storage/db');
const { getTodayPuzzle, utcDateKey } = require('../src/puzzles/puzzleGenerator');

async function main() {
    await connectDB();
    const puzzle = await getTodayPuzzle();
    console.log(`[PUZZLE] ${utcDateKey()} ready: difficulty=${puzzle.difficulty}, moves=${puzzle.moves.length}, solutionLength=${puzzle.solutionLength}, sourceGameId=${puzzle.sourceGameId || 'fallback'}`);
    process.exit(0);
}

main().catch((err) => {
    console.error('[PUZZLE] Generation failed:', err);
    process.exit(1);
});