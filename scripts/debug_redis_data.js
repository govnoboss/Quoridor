require('dotenv').config();
const { createClient } = require('redis');

async function debugRedis() {
    // Force 127.0.0.1 instead of localhost to avoid IPv6 ::1 lookup on Windows
    const client = createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' });

    client.on('error', (err) => console.error('Redis Client Error', err));

    await client.connect();

    console.log('\n--- REDIS DEBUG DUMP ---');

    // Games
    const gameKeys = await client.keys('game:*');
    console.log(`\n--- Active Games (${gameKeys.length}) ---`);
    for (const key of gameKeys) {
        const data = await client.get(key);
        console.log(`${key}: ${data.substr(0, 100)}...`);
    }

    // Timer ZSETs
    console.log('\n--- Disconnect Timers (ZSET) ---');
    const dTimers = await client.zRangeWithScores('timers:disconnect', 0, -1);
    dTimers.forEach(t => console.log(`  ${t.value}: ${new Date(t.score).toLocaleTimeString()}`));

    console.log('\n--- Turn Timeouts (ZSET) ---');
    const tTimeouts = await client.zRangeWithScores('timers:turn', 0, -1);
    tTimeouts.forEach(t => console.log(`  ${t.value}: ${new Date(t.score).toLocaleTimeString()}`));

    // Queues
    const queueKeys = await client.keys('queue:*');
    console.log(`\n--- Matchmaking Queues (${queueKeys.length}) --- ${queueKeys.join(', ') || 'None'}`);

    // 3. Tokens (Rejoin Mappings)
    const tokenKeys = await client.keys('token:*');
    console.log(`\nFound ${tokenKeys.length} token mappings (reconnect data).`);

    // 4. Sessions
    const sessKeys = await client.keys('sess:*');
    console.log(`Found ${sessKeys.length} active sessions.`);

    await client.disconnect();
    console.log('\n------------------------');
}

debugRedis();
