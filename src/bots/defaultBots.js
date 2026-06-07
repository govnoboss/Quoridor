const ACCOUNT_BOTS = [
    { seedId: 'qbot-1', username: 'WallRider_X', rating: 1200, country: 'US' },
    { seedId: 'qbot-2', username: 'pathfinder_99', rating: 1200, country: 'DE' },
    { seedId: 'qbot-3', username: 'QuoridorWolf', rating: 1200, country: 'PL' },
    { seedId: 'qbot-4', username: 'block_master', rating: 1200, country: 'GB' },
    { seedId: 'qbot-5', username: 'MazeLord7', rating: 1200, country: 'FR' },
    { seedId: 'qbot-6', username: 'xGhostRoute', rating: 1200, country: 'CA' },
];

const RANKED_BOTS = [
    { seedId: 'qbot-1', username: 'WallRider_X', rating: 1200, country: 'US' },
    { seedId: 'qbot-2', username: 'pathfinder_99', rating: 1200, country: 'DE' },
    { seedId: 'qbot-3', username: 'QuoridorWolf', rating: 1200, country: 'PL' },
    { seedId: 'qbot-4', username: 'block_master', rating: 1200, country: 'GB' },
    { seedId: 'qbot-5', username: 'MazeLord7', rating: 1200, country: 'FR' },
    { seedId: 'qbot-6', username: 'xGhostRoute', rating: 1200, country: 'CA' },
    { seedId: 'qbot-7', username: 'NovaRush', rating: 1200, country: 'RU' },
    { seedId: 'qbot-8', username: 'xDarkMaze', rating: 1200, country: 'BR' },
    { seedId: 'qbot-9', username: 'QuorKing42', rating: 1200, country: 'US' },
    { seedId: 'qbot-10', username: 'Pawn_Wall', rating: 1200, country: 'SE' },
    { seedId: 'qbot-11', username: 'FenceCrusher', rating: 1200, country: 'FI' },
    { seedId: 'qbot-12', username: 'RapidMover', rating: 1200, country: 'JP' },
    { seedId: 'qbot-13', username: 'StoneWall_9', rating: 1200, country: 'KR' },
    { seedId: 'qbot-14', username: 'MazeWalker', rating: 1200, country: 'NL' },
    { seedId: 'qbot-15', username: 'BlitzKnight', rating: 1200, country: 'UA' },
    { seedId: 'qbot-16', username: 'WallBreaker', rating: 1200, country: 'CL' },
    { seedId: 'qbot-17', username: 'xShadowFox', rating: 1200, country: 'TR' },
    { seedId: 'qbot-18', username: 'IronBarrier', rating: 1200, country: 'AU' },
    { seedId: 'qbot-19', username: 'FastLane_7', rating: 1200, country: 'ID' },
    { seedId: 'qbot-20', username: 'CrowMaze', rating: 1200, country: 'AR' },
];

const GUEST_BOTS = [
    { name: 'Guest-a1b2', rating: 850, difficulty: 'easy' },
    { name: 'Guest-c3d4', rating: 920, difficulty: 'easy' },
    { name: 'Guest-e5f6', rating: 1000, difficulty: 'medium' },
    { name: 'Guest-g7h8', rating: 1080, difficulty: 'medium' },
    { name: 'Guest-i9j0', rating: 1150, difficulty: 'medium' },
    { name: 'Guest-k1l2', rating: 880, difficulty: 'easy' },
    { name: 'Guest-m3n4', rating: 960, difficulty: 'easy' },
    { name: 'Guest-o5p6', rating: 1040, difficulty: 'medium' },
    { name: 'Guest-q7r8', rating: 1120, difficulty: 'medium' },
    { name: 'Guest-s9t0', rating: 1200, difficulty: 'medium' },
];

function randomGuestBot() {
    const hex = Math.random().toString(16).substring(2, 6);
    const rating = 800 + Math.floor(Math.random() * 500);
    const difficulties = ['easy', 'easy', 'medium', 'medium', 'medium'];
    const difficulty = difficulties[Math.floor(Math.random() * difficulties.length)];
    return { name: `Guest-${hex}`, rating, difficulty };
}

module.exports = { ACCOUNT_BOTS, RANKED_BOTS, GUEST_BOTS, randomGuestBot };
