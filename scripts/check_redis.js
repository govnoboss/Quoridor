const connectRedis = require('connect-redis');
console.log('Type of exports:', typeof connectRedis);
console.log('Exports keys:', Object.keys(connectRedis));
console.log('Exports.default:', connectRedis.default);
if (connectRedis.default) {
    console.log('Type of default:', typeof connectRedis.default);
}
