import { Pool } from "pg";
import { config } from "dotenv";
config()
const connectionString = process.env.DATABASE_URL

export const pool = new Pool({
  connectionString,
});
