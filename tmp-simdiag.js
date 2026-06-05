const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const bots = await mongoose.connection.db.collection('users').find({isBot:true}).toArray();
  console.log('Total bot users:', bots.length);
  bots.forEach(b => console.log(' -', b.username, '(rating:', b.rating, ')', 'seedId:', b.seedId));

  const games = await mongoose.connection.db.collection('gameresults').find({}).sort({createdAt:-1}).limit(5).toArray();
  console.log('\nRecent game results:', games.length);
  games.forEach(g => console.log(' -', g._id, g.playerWhite?.username, 'vs', g.playerBlack?.username, 'winner:', g.winner));

  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
