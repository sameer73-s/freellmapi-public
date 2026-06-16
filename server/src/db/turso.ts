/**
 * turso.ts
 * Thin synchronous wrapper around @libsql/client so the rest of the codebase
 * keeps using the same synchronous better-sqlite3 API.
 *
 * Strategy:
 *  - If TURSO_DATABASE_URL is set → use libsql (Turso remote DB)
 *  - Otherwise → fall through to better-sqlite3 (local dev)
 */

import { createClient, type Client } from '@libsql/client';

let tursoClient: Client | null = null;

export function isTursoEnabled(): boolean {
  return !!process.env.TURSO_DATABASE_URL;
}

export function getTursoClient(): Client {
  if (!tursoClient) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (!url) throw new Error('TURSO_DATABASE_URL is not set');
    tursoClient = createClient({ url, authToken });
  }
  return tursoClient;
}

/**
 * Execute a write statement on Turso (INSERT/UPDATE/DELETE/CREATE).
 * Returns { changes, lastInsertRowid }.
 */
export async function tursoRun(
  sql: string,
  args: (string | number | null | bigint)[] = []
): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
  const client = getTursoClient();
  const result = await client.execute({ sql, args });
  return {
    changes: result.rowsAffected,
    lastInsertRowid: result.lastInsertRowid ?? 0,
  };
}

/**
 * Execute a read statement on Turso (SELECT).
 * Returns rows as plain objects.
 */
export async function tursoAll<T = Record<string, unknown>>(
  sql: string,
  args: (string | number | null | bigint)[] = []
): Promise<T[]> {
  const client = getTursoClient();
  const result = await client.execute({ sql, args });
  return result.rows.map(row => Object.fromEntries(
    result.columns.map((col, i) => [col, row[i]])
  )) as T[];
}

/**
 * Execute a read statement and return the first row or undefined.
 */
export async function tursoGet<T = Record<string, unknown>>(
  sql: string,
  args: (string | number | null | bigint)[] = []
): Promise<T | undefined> {
  const rows = await tursoAll<T>(sql, args);
  return rows[0];
}

/**
 * Execute multiple statements in a batch (used for migrations).
 */
export async function tursoBatch(statements: { sql: string; args?: (string | number | null | bigint)[] }[]): Promise<void> {
  const client = getTursoClient();
  await client.batch(
    statements.map(s => ({ sql: s.sql, args: s.args ?? [] })),
    'write'
  );
}
