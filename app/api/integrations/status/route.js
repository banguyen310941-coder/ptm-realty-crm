import { serverRpc } from "@/lib/server-data-api";
import { metaRuntimeStatus } from "@/lib/facebook-meta";
import { aiGatewayStatus } from "@/lib/ai-gateway";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await serverRpc("crm_integration_status_v1", {});
    return Response.json({ ...(result || { ok:false, database:false }), facebook_messaging_runtime:metaRuntimeStatus(), ai_gateway_runtime:aiGatewayStatus() }, { status:result?.ok ? 200 : 503, headers:{ "Cache-Control":"no-store" } });
  } catch (error) {
    return Response.json({ ok:false, database:false, lead_webhook:false, email:false, zalo:false, facebook_verify:false, facebook_messaging_runtime:metaRuntimeStatus(), ai_gateway_runtime:aiGatewayStatus(), error:error?.message || "INTEGRATION_STATUS_FAILED" }, { status:503, headers:{ "Cache-Control":"no-store" } });
  }
}
