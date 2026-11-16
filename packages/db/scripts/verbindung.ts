import mysql from "mysql2/promise";

export async function verbinde() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL fehlt");
  const parsed = new URL(url);
  const ssl = parsed.searchParams.get("ssl") === "true";
  parsed.searchParams.delete("ssl");
  return mysql.createConnection({
    uri: parsed.toString(),
    multipleStatements: true,
    timezone: "Z",
    ...(ssl ? { ssl: { rejectUnauthorized: true } } : {}),
  });
}
