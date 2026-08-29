import path from "path";
import fs from "fs";

export interface DBUser {
  id: string;
  github_username: string;
  github_id: string;
  access_token: string;
  created_at: string;
}

export interface DBAnalysis {
  id: number;
  user_id: string | null;
  repo_url: string;
  files_json: string;
  edges_json: string;
  created_at: string;
}

// In-memory fallback store if native better-sqlite3 compilation mismatch occurs
const inMemoryUsers = new Map<string, DBUser>();
const inMemoryAnalyses: DBAnalysis[] = [];

// Lazy SQLite Database instance
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dbInstance: any = null;
let isNativeDbAvailable = false;

function getDb() {
  if (dbInstance !== null) return dbInstance;

  try {
    // Dynamic require to prevent top-level module load crash if ABI mismatch exists
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const Database = require("better-sqlite3");
    const dbPath = path.join(process.cwd(), "codebase-atlas.db");
    const dbDir = path.dirname(dbPath);

    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const db = new Database(dbPath);

    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        github_username TEXT,
        github_id TEXT UNIQUE,
        access_token TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        repo_url TEXT NOT NULL,
        files_json TEXT NOT NULL,
        edges_json TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
    `);

    dbInstance = db;
    isNativeDbAvailable = true;
    return db;
  } catch (err) {
    console.warn("[DB WARNING] Native better-sqlite3 unavailable, using in-memory store:", err);
    dbInstance = false;
    isNativeDbAvailable = false;
    return null;
  }
}

export function saveUser(id: string, username: string, githubId: string, accessToken: string) {
  try {
    const db = getDb();
    if (isNativeDbAvailable && db) {
      const stmt = db.prepare(`
        INSERT INTO users (id, github_username, github_id, access_token)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(github_id) DO UPDATE SET
          github_username = excluded.github_username,
          access_token = excluded.access_token
      `);
      stmt.run(id, username, githubId, accessToken);
      return;
    }
  } catch {
    // Fallback to in-memory store
  }

  inMemoryUsers.set(id, {
    id,
    github_username: username,
    github_id: githubId,
    access_token: accessToken,
    created_at: new Date().toISOString(),
  });
}

export function saveAnalysis(userId: string | null, repoUrl: string, files: unknown, edges: unknown) {
  const filesJson = JSON.stringify(files);
  const edgesJson = JSON.stringify(edges);

  try {
    const db = getDb();
    if (isNativeDbAvailable && db) {
      const stmt = db.prepare(`
        INSERT INTO analyses (user_id, repo_url, files_json, edges_json)
        VALUES (?, ?, ?, ?)
      `);
      stmt.run(userId, repoUrl, filesJson, edgesJson);
      return;
    }
  } catch {
    // Fallback
  }

  inMemoryAnalyses.unshift({
    id: inMemoryAnalyses.length + 1,
    user_id: userId,
    repo_url: repoUrl,
    files_json: filesJson,
    edges_json: edgesJson,
    created_at: new Date().toISOString(),
  });
}

export function getUserAnalyses(userId: string, limit = 10): DBAnalysis[] {
  try {
    const db = getDb();
    if (isNativeDbAvailable && db) {
      const stmt = db.prepare(`
        SELECT * FROM analyses
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `);
      return stmt.all(userId, limit) as DBAnalysis[];
    }
  } catch {
    // Fallback
  }

  return inMemoryAnalyses.filter((a) => a.user_id === userId).slice(0, limit);
}
