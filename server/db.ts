// One SQL dialect over two drivers: SQLite (node:sqlite, local) and Postgres (`postgres`, production).
// Queries use `?` placeholders; the Postgres driver rewrites them to $1, $2, ...
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { TransactionSql } from "postgres";

export type Value = string | number | null | Uint8Array;
export type Row = Record<string, unknown>;

export interface Tx {
  readonly postgres: boolean;
  all(sql: string, params?: Value[]): Promise<Row[]>;
  get(sql: string, params?: Value[]): Promise<Row | undefined>;
  /** Runs a statement and returns how many rows it changed. */
  run(sql: string, params?: Value[]): Promise<number>;
}

export interface Db {
  readonly postgres: boolean;
  /** Runs `fn` in one transaction: committed when it resolves, rolled back when it throws. */
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export type Target = { sqlite: string } | { postgres: string; schema?: string };

export const SQLITE_FILE = new URL("../.data/lemo.sqlite", import.meta.url).pathname;

export function defaultTarget(): Target {
  const url = process.env.DATABASE_URL;
  if (url) return { postgres: url };
  if (process.env.VERCEL) throw new Error("DATABASE_URL is not set");
  return { sqlite: SQLITE_FILE };
}

export function openDb(target: Target): Promise<Db> {
  return "sqlite" in target ? openSqlite(target.sqlite) : openPostgres(target.postgres, target.schema);
}

async function openSqlite(file: string): Promise<Db> {
  const { DatabaseSync } = await import("node:sqlite");
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  if (file !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  const statements = new Map<string, ReturnType<typeof db.prepare>>();
  const prepare = (sql: string) => {
    let statement = statements.get(sql);
    if (!statement) statements.set(sql, (statement = db.prepare(sql)));
    return statement;
  };
  const tx: Tx = {
    postgres: false,
    all: async (sql, params = []) => prepare(sql).all(...params) as Row[],
    get: async (sql, params = []) => prepare(sql).get(...params) as Row | undefined,
    run: async (sql, params = []) => Number(prepare(sql).run(...params).changes),
  };
  // One connection, so transactions take turns; without this, two requests' awaits would interleave inside one BEGIN.
  let tail: Promise<unknown> = Promise.resolve();
  return {
    postgres: false,
    tx<T>(fn: (tx: Tx) => Promise<T>) {
      const run = tail.then(async () => {
        db.exec("BEGIN IMMEDIATE");
        try {
          const result = await fn(tx);
          db.exec("COMMIT");
          return result;
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      });
      tail = run.catch(() => undefined);
      return run;
    },
    close: async () => {
      await tail;
      db.close();
    },
  };
}

const dollars = (sql: string) => {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
};

async function openPostgres(url: string, schema?: string): Promise<Db> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, {
    max: process.env.VERCEL ? 3 : 10,
    idle_timeout: 20,
    onnotice: () => {},
    ...(schema ? { connection: { search_path: schema } } : {}),
  });
  const wrap = (t: TransactionSql): Tx => ({
    postgres: true,
    all: async (q, params = []) => [...(await t.unsafe(dollars(q), params as never[]))] as Row[],
    get: async (q, params = []) => (await t.unsafe(dollars(q), params as never[]))[0] as Row | undefined,
    run: async (q, params = []) => (await t.unsafe(dollars(q), params as never[])).count,
  });
  return {
    postgres: true,
    tx: <T>(fn: (tx: Tx) => Promise<T>) => sql.begin((t) => fn(wrap(t))) as Promise<T>,
    close: () => sql.end({ timeout: 5 }),
  };
}
