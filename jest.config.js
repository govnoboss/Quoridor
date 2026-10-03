module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/tests/**/*.test.js'],
    verbose: true,
    collectCoverage: false,
    roots: ['<rootDir>'],
    testTimeout: 60000,
    // quoridor-engine is plain CommonJS and perf-sensitive (perft walks millions of nodes).
    // Running it through babel-jest made the rules tests ~10x slower for no benefit.
    // Written with an explicit separator class so it matches on Windows paths too.
    transformIgnorePatterns: ['/node_modules/', '[\\\\/]quoridor-engine[\\\\/]'],
};
