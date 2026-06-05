import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { ensureSchema } from "./schema";
import { BUSY_TIMEOUT_MS, type Db } from "./shared";

export class IndexUnavailableError extends Error {
  constructor(public readonly dbPath: string) {
    super(`index not found: ${dbPath}`);
    this.name = "IndexUnavailableError";
  }
}

export class IndexSchemaUpgradeRequiredError extends Error {
  constructor(
    public readonly dbPath: string,
    public readonly missingColumns: string[],
  ) {
    super(`index schema is too old for source-aware read commands: ${dbPath}`);
    this.name = "IndexSchemaUpgradeRequiredError";
  }
}

export function openReadDb(dbPath: string): Db {
  if (!existsSync(dbPath)) {
    throw new IndexUnavailableError(dbPath);
  }

  const db = new Database(dbPath, { readonly: true });
  db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  db.pragma("query_only = ON");
  db.pragma("temp_store = MEMORY");
  return db;
}

// Why: callers used to do `const db = openReadDb(...); ... db.close();` which
// leaks the connection if work in between throws. Wrapping in try/finally at
// every callsite is noise — fold it once.
export function withReadDb<T>(dbPath: string, fn: (db: Db) => T): T {
  const db = openReadDb(dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export function withSourceAwareReadDb<T>(dbPath: string, fn: (db: Db) => T): T {
  const db = openReadDb(dbPath);
  try {
    assertSourceAwareReadSchema(db, dbPath);
    return fn(db);
  } finally {
    db.close();
  }
}

export function openWriteDb(dbPath: string): Db {
  const db = new Database(dbPath);
  db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("temp_store = MEMORY");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);
  return db;
}

function assertSourceAwareReadSchema(db: Db, dbPath: string): void {
  const requiredColumns = [
    ["sessions", "source_id"],
    ["sessions", "native_session_id"],
    ["sessions", "session_key"],
    ["coverage", "source_id"],
  ];
  const missingColumns = requiredColumns
    .filter(([tableName, columnName]) => !tableColumnExists(db, tableName, columnName))
    .map(([tableName, columnName]) => `${tableName}.${columnName}`);

  if (missingColumns.length > 0) {
    throw new IndexSchemaUpgradeRequiredError(dbPath, missingColumns);
  }
}

function tableColumnExists(db: Db, tableName: string, columnName: string): boolean {
  return db
    .prepare<[string, string], { name: string }>(`
      SELECT name
      FROM pragma_table_info(?)
      WHERE name = ?
      LIMIT 1
    `)
    .get(tableName, columnName) !== undefined;
}
