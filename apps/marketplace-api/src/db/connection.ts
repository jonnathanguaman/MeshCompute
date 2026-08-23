import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

export type SqliteDatabase = Database.Database;

function defaultMigrationsRoot(): string {
  return fileURLToPath(new URL('../../migrations', import.meta.url));
}

export function openDatabase(databaseUrl: string): SqliteDatabase {
  const database = new Database(databaseUrl);
  database.pragma('foreign_keys = ON');
  if (databaseUrl !== ':memory:') {
    database.pragma('journal_mode = WAL');
  }
  return database;
}

export function runMigrations(
  database: SqliteDatabase,
  migrationsRoot = defaultMigrationsRoot(),
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = database
    .prepare('SELECT id FROM schema_migrations')
    .all()
    .map((row) => (row as { id: string }).id);
  const appliedSet = new Set(applied);

  const migrationFiles = ['core', 'economy']
    .flatMap((domain) => {
      const directory = join(migrationsRoot, domain);
      try {
        return readdirSync(directory)
          .filter((name) => extname(name) === '.sql')
          .map((name) => ({ id: `${domain}/${name}`, path: join(directory, name) }));
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return [];
        throw error;
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const apply = database.transaction((id: string, sql: string) => {
    database.exec(sql);
    database
      .prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)')
      .run(id, new Date().toISOString());
  });

  for (const migration of migrationFiles) {
    if (appliedSet.has(migration.id)) continue;
    apply(migration.id, readFileSync(migration.path, 'utf8'));
  }
}

export function databaseDirectory(databaseUrl: string): string | undefined {
  if (databaseUrl === ':memory:') return undefined;
  return dirname(databaseUrl);
}
