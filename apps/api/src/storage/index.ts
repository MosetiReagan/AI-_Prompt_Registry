import { IRegistryStorage } from "./interface.js";
import { MemoryStorage } from "./memory.js";
import { PostgresStorage } from "./postgres.js";

export * from "./interface.js";
export * from "./memory.js";
export * from "./postgres.js";

let activeStorage: IRegistryStorage | null = null;

export async function getStorage(): Promise<IRegistryStorage> {
  if (activeStorage) return activeStorage;

  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    try {
      const { default: pg } = await import("pg");
      const pool = new pg.Pool({ connectionString: dbUrl });

      // Apply schema migrations on startup if schema file is present
      try {
        const schemaPath = new URL("./schema.sql", import.meta.url);
        const { readFileSync, existsSync } = await import("fs");
        if (existsSync(schemaPath)) {
          const sql = readFileSync(schemaPath, "utf-8");
          await pool.query(sql);
        }
      } catch (migrationErr) {
        console.warn("Schema initialization notice:", migrationErr);
      }

      activeStorage = new PostgresStorage(pool);
      return activeStorage;
    } catch (err) {
      console.error("FATAL: DATABASE_URL is set but failed to initialize PostgreSQL storage:", err);
      throw new Error(`Failed to initialize PostgreSQL storage from DATABASE_URL: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
  }

  activeStorage = new MemoryStorage();
  return activeStorage;
}

export function setStorage(storage: IRegistryStorage | null) {
  activeStorage = storage;
}
