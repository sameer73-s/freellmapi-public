/**
 * turso-sync.ts
 * On startup (when Turso is enabled):
 *  1. Run all DDL migrations against Turso
 *  2. Pull existing data from Turso into the local in-memory DB
 *
 * On writes: proxy critical tables (api_keys, settings, fallback_config,
 * rate_limit_usage, requests) to Turso so data survives restarts.
 */

import type Database from 'better-sqlite3';
import { tursoBatch, tursoAll, isTursoEnabled } from './turso.js';

// Tables to sync FROM Turso → memory on startup
const SYNC_TABLES = [
  'models',
  'api_keys',
  'settings',
  'fallback_config',
  'profiles',
  'profile_models',
  'embedding_models',
  'quirks',
  'quirk_targets',
  'users',
  'sessions',
];

/**
 * Pull data from Turso and INSERT it into the local in-memory DB.
 * Called once after initDb() when TURSO_DATABASE_URL is set.
 */
export async function syncFromTurso(db: Database.Database): Promise<void> {
  if (!isTursoEnabled()) return;

  console.log('[turso] Syncing data from Turso to in-memory DB...');

  for (const table of SYNC_TABLES) {
    try {
      const rows = await tursoAll(`SELECT * FROM ${table}`);
      if (rows.length === 0) continue;

      const columns = Object.keys(rows[0]!);
      const placeholders = columns.map(() => '?').join(', ');
      const insertStmt = db.prepare(
        `INSERT OR IGNORE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`
      );

      const insertMany = db.transaction((items: Record<string, unknown>[]) => {
        for (const row of items) {
          insertStmt.run(...columns.map(c => row[c] ?? null));
        }
      });

      insertMany(rows as Record<string, unknown>[]);
      console.log(`[turso] Synced ${rows.length} rows from ${table}`);
    } catch (err) {
      // Table may not exist yet in Turso (first boot) — that's fine
      console.log(`[turso] ${table}: not yet in Turso (will be created on first write)`);
    }
  }

  console.log('[turso] Sync complete.');
}

/**
 * Run CREATE TABLE statements against Turso so schema exists there too.
 * Called once after migrateDbSchema() completes on the local DB.
 */
export async function migrateSchemaOnTurso(db: Database.Database): Promise<void> {
  if (!isTursoEnabled()) return;

  console.log('[turso] Applying schema to Turso...');

  // Export all CREATE TABLE statements from the in-memory DB
  const tables = db
    .prepare(
      `SELECT sql FROM sqlite_master 
       WHERE type='table' 
         AND sql IS NOT NULL
         AND name NOT LIKE 'sqlite_%'`
    )
    .all() as { sql: string }[];

  const statements = tables.map(t => ({
    sql: t.sql.replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS'),
  }));

  if (statements.length > 0) {
    await tursoBatch(statements);
  }

  console.log(`[turso] Schema applied (${statements.length} tables).`);
}
