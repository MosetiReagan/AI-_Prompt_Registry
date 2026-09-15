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
      // Dynamic import of pg only when DATABASE_URL is configured
      const { default: pg } = await import("pg" as any);
      const pool = new pg.Pool({ connectionString: dbUrl });
      activeStorage = new PostgresStorage(pool);
      return activeStorage;
    } catch (err) {
      console.warn("Could not initialize PostgreSQL pool, falling back to in-memory storage:", err);
    }
  }

  activeStorage = new MemoryStorage();
  return activeStorage;
}

export function setStorage(storage: IRegistryStorage) {
  activeStorage = storage;
}
