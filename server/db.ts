import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = process.env.DB_PATH || path.resolve(process.cwd(), 'chat.db');
const db = new Database(dbPath);

// Initialize database tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    avatar TEXT,
    is_online INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL,
    receiver_id TEXT NOT NULL,
    content TEXT NOT NULL,
    file_url TEXT,
    file_name TEXT,
    file_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users (id),
    FOREIGN KEY (receiver_id) REFERENCES users (id)
  );
`);

// Migration for existing databases
try {
  db.exec('ALTER TABLE users ADD COLUMN avatar TEXT;');
} catch (e) {
  // Column already exists or other error, ignore
}

try {
  db.exec('ALTER TABLE messages ADD COLUMN file_url TEXT;');
  db.exec('ALTER TABLE messages ADD COLUMN file_name TEXT;');
  db.exec('ALTER TABLE messages ADD COLUMN file_type TEXT;');
} catch (e) {
  // Columns already exist or other error, ignore
}

export default db;
