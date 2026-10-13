const path = require('node:path');
const Database = require(path.resolve(process.argv[2], 'node_modules/better-sqlite3'));
const db = new Database(':memory:');
db.exec('CREATE TABLE native_check(amount INTEGER); INSERT INTO native_check VALUES(12345)');
if (db.prepare('SELECT amount FROM native_check').get().amount !== 12345) throw Error('SQLite verification failed');
console.log(`SQLite ${db.prepare('SELECT sqlite_version() version').get().version} verified in Electron ${process.versions.electron} (${process.platform}/${process.arch}).`);
db.close();
