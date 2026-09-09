import { createClient } from "@neondatabase/neon-js";

export const dynamic = "force-dynamic";

const DB_URL = process.env.NEXT_PUBLIC_NEON_DATA_API_URL ||
  "https://ep-dawn-feather-az232vpl.c-3.ap-southeast-1.aws.neon.tech/neondb";

function unwrap(data) {
  return Array.isArray(data) ? data[0] : data;
}

export async function GET() {
  try {
    const client = createClient(DB_URL, { auth: { allowAnonymous: true } });
    const { data, error } = await client.rpc("crm_api_v2", {
      p_token: "",
      p_action: "bootstrap",
      p_payload: {}
    });

    const result = unwrap(data);
    const databaseReady = !error && Boolean(
      result?.ok === true ||
      result?.ok === false ||
      result?.code === "UNAUTHENTICATED"
    );

    return Response.json(
      {
        ok: databaseReady,
        database: databaseReady,
        auth: databaseReady,
        mode: "neon-data-api"
      },
      {
        status: databaseReady ? 200 : 503,
        headers: { "Cache-Control": "no-store" }
      }
    );
  } catch {
    return Response.json(
      { ok: false, database: false, auth: false, mode: "neon-data-api" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
