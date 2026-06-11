import { Pool, PoolClient } from 'pg';

export function parseSSL(connectionString: string, noSslVerify = false): object | boolean | undefined {
  if (noSslVerify) {
    console.warn('⚠  WARNING: SSL certificate verification disabled via --no-ssl-verify. Do not use in production.');
    return { rejectUnauthorized: false };
  }

  try {
    const url = new URL(connectionString);
    const sslmode = url.searchParams.get('sslmode') ?? '';

    if (sslmode === 'disable') return false;
    if (sslmode === 'no-verify') return { rejectUnauthorized: false };

    const host = url.hostname;
    const isCloudHost =
      host.endsWith('.neon.tech') ||
      host.endsWith('.supabase.co') ||
      host.includes('amazonaws.com') ||
      host.includes('azure.com') ||
      host.includes('cloudsql.google.com');

    if (isCloudHost || sslmode === 'require' || sslmode === 'verify-full') {
      return { rejectUnauthorized: true };
    }
  } catch {
    // not a valid URL
  }

  return undefined;
}

export function maskPassword(connectionString: string): string {
  return connectionString.replace(/:([^:@]+)@/, ':****@');
}

let pool: Pool | null = null;

export function createPool(connectionString: string, noSslVerify = false): Pool {
  pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 15000,
    ssl: parseSSL(connectionString, noSslVerify) as any,
  });
  return pool;
}

export async function query<T = any>(client: Pool | PoolClient, sql: string, params: any[] = []): Promise<T[]> {
  const result = await client.query(sql, params);
  return result.rows as T[];
}

export async function getPostgresVersion(client: Pool): Promise<string> {
  const rows = await query<{ version: string }>(client, 'SELECT version()');
  return rows[0]?.version ?? 'Unknown';
}

export async function checkExtension(client: Pool, extension: string): Promise<boolean> {
  const rows = await query<{ exists: boolean }>(
    client,
    `SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = $1) AS exists`,
    [extension]
  );
  return rows[0]?.exists ?? false;
}

export async function withReadOnlyTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('SET statement_timeout = 30000');
    await client.query('BEGIN TRANSACTION READ ONLY');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { });
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
