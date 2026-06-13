import { SQL } from "bun";

let db: SQL | null = null;

function getDatabaseUrl(): string {
  return (
    process.env.DATABASE_URL ||
    "postgres://mikrotik:mikrotik@localhost:5432/mikrotik"
  );
}

export async function initializeDatabase() {
  const sql = getDatabase();

  await sql.connect();

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      "passwordHash" TEXT NOT NULL,
      "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
      "maxDevices" INTEGER NOT NULL DEFAULT 2,
      role TEXT NOT NULL DEFAULT 'user',
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )
  `;

  await sql`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "deviceName" TEXT NOT NULL,
      "macAddress" TEXT UNIQUE NOT NULL,
      "ipAddress" TEXT,
      "isConnected" BOOLEAN NOT NULL DEFAULT FALSE,
      "connectedAt" TEXT,
      "disconnectedAt" TEXT,
      "lastSeenAt" TEXT,
      "bytesIn" BIGINT NOT NULL DEFAULT 0,
      "bytesOut" BIGINT NOT NULL DEFAULT 0,
      "lastSessionId" TEXT,
      "lastSessionBytesIn" BIGINT NOT NULL DEFAULT 0,
      "lastSessionBytesOut" BIGINT NOT NULL DEFAULT 0,
      "discoveredBy" TEXT NOT NULL DEFAULT 'manual',
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )
  `;

  await sql`ALTER TABLE devices ADD COLUMN IF NOT EXISTS "lastSeenAt" TEXT`;
  await sql`ALTER TABLE devices ADD COLUMN IF NOT EXISTS "bytesIn" BIGINT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE devices ADD COLUMN IF NOT EXISTS "bytesOut" BIGINT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE devices ADD COLUMN IF NOT EXISTS "lastSessionId" TEXT`;
  await sql`ALTER TABLE devices ADD COLUMN IF NOT EXISTS "lastSessionBytesIn" BIGINT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE devices ADD COLUMN IF NOT EXISTS "lastSessionBytesOut" BIGINT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE devices ADD COLUMN IF NOT EXISTS "discoveredBy" TEXT NOT NULL DEFAULT 'manual'`;

  await sql`
    CREATE TABLE IF NOT EXISTS session_tokens (
      id TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      "macAddress" TEXT NOT NULL,
      "createdAt" TEXT NOT NULL,
      "expiresAt" TEXT NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      "userId" TEXT REFERENCES users(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      details TEXT,
      "ipAddress" TEXT,
      "createdAt" TEXT NOT NULL
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS "idx_devices_userId" ON devices("userId")`;
  await sql`CREATE INDEX IF NOT EXISTS "idx_devices_macAddress" ON devices("macAddress")`;
  await sql`ALTER TABLE devices DROP CONSTRAINT IF EXISTS "devices_macAddress_key"`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "idx_devices_user_mac"
    ON devices("userId", "macAddress")
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_username_lower" ON users(LOWER(username))`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_email_lower" ON users(LOWER(email))`;
  await sql`CREATE INDEX IF NOT EXISTS "idx_session_tokens_userId" ON session_tokens("userId")`;
  await sql`CREATE INDEX IF NOT EXISTS "idx_session_tokens_expiresAt" ON session_tokens("expiresAt")`;
  await sql`CREATE INDEX IF NOT EXISTS "idx_audit_logs_userId" ON audit_logs("userId")`;
  await sql`CREATE INDEX IF NOT EXISTS "idx_audit_logs_createdAt" ON audit_logs("createdAt")`;

  return sql;
}

export function getDatabase(): SQL {
  if (!db) {
    db = new SQL(getDatabaseUrl(), {
      adapter: "postgres",
      max: Number(process.env.DATABASE_POOL_SIZE || 10),
    });
  }

  return db;
}
