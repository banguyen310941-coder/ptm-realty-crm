import { bearerToken, serverRpc, serverRpcErrorStatus } from "@/lib/server-data-api";
import { metaRuntimeStatus } from "@/lib/facebook-meta";
import { aiGatewayStatus } from "@/lib/ai-gateway";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set(["admin","ceo","manager","marketing"]);

export async function GET(request) {
  const token = bearerToken(request);
  if (!token) {
    return Response.json(
      { ok:false,error:"UNAUTHENTICATED" },
      { status:401,headers:{ "Cache-Control":"no-store" } }
    );
  }

  try {
    const auth = await serverRpc("crm_auth_context_v1",{ p_token:token });
    if (!auth?.ok) {
      return Response.json(
        { ok:false,error:auth?.error || "UNAUTHENTICATED",code:auth?.code || "UNAUTHENTICATED" },
        { status:401,headers:{ "Cache-Control":"no-store" } }
      );
    }

    const role = String(auth?.user?.role || "");
    if (!ALLOWED_ROLES.has(role)) {
      return Response.json(
        { ok:false,error:"FORBIDDEN" },
        { status:403,headers:{ "Cache-Control":"no-store" } }
      );
    }

    const result = await serverRpc("crm_integration_status_v1",{});
    return Response.json(
      {
        ...(result || { ok:false,database:false }),
        facebook_messaging_runtime:metaRuntimeStatus(),
        ai_gateway_runtime:aiGatewayStatus()
      },
      {
        status:result?.ok ? 200 : 503,
        headers:{ "Cache-Control":"no-store" }
      }
    );
  } catch (error) {
    const status = serverRpcErrorStatus(error);
    return Response.json(
      {
        ok:false,
        database:false,
        error:error?.message || "INTEGRATION_STATUS_FAILED",
        code:status===503 ? "DATA_API_TEMPORARY" : "INTEGRATION_STATUS_FAILED"
      },
      {
        status,
        headers:{
          "Cache-Control":"no-store",
          ...(status===503 ? { "Retry-After":"3" } : {})
        }
      }
    );
  }
}
