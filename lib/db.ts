import { Pool } from "pg";

// Next dev mode re-evaluates modules on hot reload; cache the pool on globalThis
// so we don't leak connections.
const globalForPg = globalThis as unknown as { pgPool?: Pool };

/**
 * Returns the connection pool, creating it on first use.
 *
 * Creation is lazy on purpose. Building the pool at module scope would throw
 * during import for anyone running without Postgres — including the chat routes,
 * which only reach this module transitively and work fine on the in-memory
 * store (see lib/store.ts).
 */
export function getPool(): Pool {
  if (globalForPg.pgPool) return globalForPg.pgPool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Add it to .env to enable persistence.");
  }

  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    // Managed Postgres (Neon, Supabase, RDS) rejects plaintext connections.
    ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: false },
  });

  globalForPg.pgPool = pool;
  return pool;
}

/** Parameterized query. Never interpolate values into the SQL string. */
export async function query<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query(sql, params);
  return result.rows as T[];
}

export async function queryOne<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}
