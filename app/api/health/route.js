import { serverRpc } from "@/lib/server-data-api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await serverRpc("crm_api_v2", {
      p_token: "",
      p_action: "bootstrap",
      p_payload: {}
    });

    const databaseReady = Boolean(
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
