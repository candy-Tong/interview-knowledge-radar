import pg from "pg";
import { config } from "../config.js";

const { Pool } = pg;

export const databasePool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 3_000,
});
