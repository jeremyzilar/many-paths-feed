'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'digest.db'), { readonly: true });

const divider = '\u2500'.repeat(52);

console.log(`\nSource Statistics (all time)\n${divider}`);

const stats = db
  .prepare(
    `SELECT source_name, article_count, last_seen
     FROM source_stats
     ORDER BY article_count DESC`
  )
  .all();

for (const s of stats) {
  const lastSeen = s.last_seen ? new Date(s.last_seen).toLocaleDateString() : 'never';
  console.log(
    `${s.source_name.padEnd(34)} ${String(s.article_count).padStart(5)} articles   (last: ${lastSeen})`
  );
}

const total = db.prepare('SELECT COUNT(*) AS count FROM articles').get();
console.log(`${divider}`);
console.log(`Total articles in database: ${total.count}\n`);
