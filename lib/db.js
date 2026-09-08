import { neon } from "@neondatabase/serverless";

let client;

function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL chưa được cấu hình.");
  }
  if (!client) client = neon(process.env.DATABASE_URL);
  return client;
}

export async function query(text, params = []) {
  const sql = getSql();
  return sql.query(text, params);
}
