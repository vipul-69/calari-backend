import { Pool } from "pg";
import { config } from "dotenv";
config()
const connectionString = process.env.DB_URL

export const pool = new Pool({
  connectionString,
});
