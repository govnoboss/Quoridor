require('dotenv').config();
const mongoose = require('mongoose');
const AnalyticsEvent = require('../src/models/AnalyticsEvent');
const User = require('../src/models/User');
const { loadProductMetrics } = require('../src/analytics/product-metrics');

async function main() {
    const days = process.argv[2] === undefined ? 28 : Number(process.argv[2]);
    if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error('Usage: node scripts/retention_report.js [days: 1..30]');
    try {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/quoridor', { serverSelectionTimeoutMS: 5000 });
        const report = await loadProductMetrics({ AnalyticsEvent, User, days });
        console.log(JSON.stringify(report, null, 2));
    } finally {
        await mongoose.disconnect();
    }
}

main().catch(error => { console.error('[RETENTION]', error.message); process.exitCode = 1; });
