import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { databasePool } from "../server/database/client.js";

/** Applies the idempotent PostgreSQL and pgvector schema. */
async function initializeDatabase() {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const schemaPath = resolve(scriptDirectory, "../server/database/schema.sql");
  const schema = await readFile(schemaPath, "utf8");
  await databasePool.query(schema);
  console.log("Database schema is ready.");
}

try {
  await initializeDatabase();
} finally {
  await databasePool.end();
}
