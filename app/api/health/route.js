import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const secretReady = Boolean(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32);
    const rows = await query("SELECT 1 AS ok");
    const databaseReady = Number(rows?.[0]?.ok) === 1;

    return Response.json(
      { ok: secretReady && databaseReady, database: databaseReady, session: secretReady },
      { status: secretReady && databaseReady ? 200 : 503 }
    );
  } catch {
    return Response.json({ ok: false, database: false, session: false }, { status: 503 });
  }
}
