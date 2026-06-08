import { Pool, PoolClient } from 'pg';

let pool: Pool | null = null;

export function createPool(connectionString: string): Pool {
  pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    ssl: connectionString.includes('sslmode=require')
      ? { rejectUnauthorized: false }
      : undefined,
  });
  return pool;
}

export async function query<T = any>(
  client: Pool | PoolClient,
  sql: string,
  params: any[] = []
): Promise<T[]> {
  const result = await client.query(sql, params);
  return result.rows as T[];
}

export async function getPostgresVersion(client: Pool): Promise<string> {
  const rows = await query<{ version: string }>(client, 'SELECT version()');
  return rows[0]?.version ?? 'Unknown';
}

export async function checkExtension(
  client: Pool,
  extension: string
): Promise<boolean> {
  const rows = await query<{ exists: boolean }>(
    client,
    `SELECT EXISTS(
       SELECT 1 FROM pg_extension WHERE extname = $1
     ) AS exists`,
    [extension]
  );
  return rows[0]?.exists ?? false;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
