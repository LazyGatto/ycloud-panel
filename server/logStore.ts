import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export type LogRecord = {
  id: number;
  jobId: string;
  level: "info" | "error";
  message: string;
  createdAt: number;
};

type DB = any;
let db: DB | undefined;

function getDb(): DB {
  if (db) return db;
  const dbPath = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.resolve(process.cwd(), "data", "logs.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(
    `
    CREATE TABLE IF NOT EXISTS logs(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jobId TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS job_status(
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      lastError TEXT,
      startedAt INTEGER,
      updatedAt INTEGER
    );
    `,
  );
  return db;
}

export function addLog(jobId: string, level: "info" | "error", message: string): void {
  const database = getDb();
  const stmt = database.prepare("INSERT INTO logs (jobId, level, message, createdAt) VALUES (?, ?, ?, ?)");
  stmt.run(jobId, level, message, Date.now());
}

export function listLogs(jobId?: string, limit = 200): LogRecord[] {
  const database = getDb();
  if (jobId) {
    const stmt = database.prepare("SELECT * FROM logs WHERE jobId = ? ORDER BY id DESC LIMIT ?");
    return stmt.all(jobId, limit) as LogRecord[];
  }
  const stmt = database.prepare("SELECT * FROM logs ORDER BY id DESC LIMIT ?");
  return stmt.all(limit) as LogRecord[];
}

export function setJobStatus(id: string, status: string, lastError?: string, startedAt?: number, updatedAt?: number): void {
  const database = getDb();
  const stmt = database.prepare(
    `
    INSERT INTO job_status (id, status, lastError, startedAt, updatedAt)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status=excluded.status,
      lastError=excluded.lastError,
      startedAt=excluded.startedAt,
      updatedAt=excluded.updatedAt;
    `,
  );
  stmt.run(id, status, lastError ?? null, startedAt ?? null, updatedAt ?? Date.now());
}

export function getJobStatuses(): { id: string; status: string; lastError?: string; startedAt?: number; updatedAt?: number }[] {
  const database = getDb();
  const stmt = database.prepare("SELECT * FROM job_status");
  return stmt.all() as { id: string; status: string; lastError?: string; startedAt?: number; updatedAt?: number }[];
}
