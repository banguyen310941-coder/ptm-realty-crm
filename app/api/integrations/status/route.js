import { serverRpc } from "@/lib/server-data-api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await serverRpc("crm_integration_status_v1", {});
    return Response.json(result || { ok:false, database:false }, { status:result?.ok ? 200 : 503, headers:{ "Cache-Control":"no-store" } });
  } catch (error) {
    return Response.json({ ok:false, database:false, lead_webhook:false, email:false, zalo:false, facebook_verify:false, error:error?.message || "INTEGRATION_STATUS_FAILED" }, { status:503, headers:{ "Cache-Control":"no-store" } });
  }
}
