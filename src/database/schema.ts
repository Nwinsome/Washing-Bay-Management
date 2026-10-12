import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const databasePath =
  process.env.WASH_BAY_DATABASE_PATH ?? 'wash-bay-manager.sqlite';

export function initializeDatabase(path = databasePath) {
  const database = new Database(path);

  database.pragma('foreign_keys = ON');
  database.pragma('journal_mode = WAL');

  database.exec(readFileSync(join(__dirname, 'schema.sql'), 'utf8'));

  return database;
}

export const db = initializeDatabase();
