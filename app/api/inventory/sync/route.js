import { bearerToken, serverRpc } from "@/lib/server-data-api";

export const dynamic = "force-dynamic";

function suppliedSecret(request) {
  return request.headers.get("x-ptm-inventory-secret") || bearerToken(request) || "";
}

function noStore(status, body) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  return noStore(200, {
    ok: true,
    endpoint: "PTM inventory sync",
    source: "BẢNG GIÁ-DỰ ÁN QUẢNG NINH",
    max_rows: 500,
    auth: "header-only"
  });
}

export async function POST(request) {
  try {
    const secret = suppliedSecret(request);
    if (!secret) return noStore(401, { ok: false, error: "WEBHOOK_SECRET_REQUIRED" });

    const body = await request.json().catch(() => ({}));
    const rows = Array.isArray(body?.rows) ? body.rows : Array.isArray(body) ? body : [];

    if (!rows.length) {
      return noStore(200, {
        ok: true,
        seen: 0,
        changed: 0,
        conflict_count: 0,
        unknown_count: 0,
        invalid_count: 0,
        conflicts: [],
        unknown: [],
        invalid: []
      });
    }

    if (rows.length > 500) return noStore(413, { ok: false, error: "BATCH_TOO_LARGE", max_rows: 500 });

    const result = await serverRpc("crm_inventory_sync_v1", {
      p_secret: secret,
      p_rows: rows
    });

    if (!result?.ok) {
      const status = result?.error === "INVALID_WEBHOOK_SECRET" ? 401 : result?.error === "BATCH_TOO_LARGE" ? 413 : 400;
      return noStore(status, result || { ok: false, error: "INVENTORY_SYNC_FAILED" });
    }

    return noStore(200, result);
  } catch (error) {
    return noStore(500, { ok: false, error: error?.message || "INVENTORY_SYNC_FAILED" });
  }
}
