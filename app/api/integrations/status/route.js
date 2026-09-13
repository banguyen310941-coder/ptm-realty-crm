import { bearerToken, serverRpc, serverRpcErrorStatus } from "@/lib/server-data-api";
import { metaRuntimeStatus } from "@/lib/facebook-meta";
import { aiGatewayStatus } from "@/lib/ai-gateway";

export const dynamic = "force-dynamic";

function resultStatus(result) {
  if (result?.ok) return 200;
  if (result?.code === "UNAUTHENTICATED") return 401;
  if (result?.code === "FORBIDDEN") return 403;
  return 503;
}

export async function GET(request) {
  const token = bearerToken(request);
  if (!token) {
    return Response.json(
      { ok:false,error:"UNAUTHENTICATED" },
      { status:401,headers:{ "Cache-Control":"no-store" } }
    );
  }

  try {
    // Authorization is enforced inside the RPC as well as at the HTTP boundary.
    // This prevents bypass through the directly reachable Neon Data API.
    const result = await serverRpc("crm_integration_status_v2",{ p_token:token });

    if (!result?.ok) {
      return Response.json(
        result || { ok:false,error:"INTEGRATION_STATUS_FAILED" },
        { status:resultStatus(result),headers:{ "Cache-Control":"no-store" } }
      );
    }

    return Response.json(
      {
        ...result,
        facebook_messaging_runtime:metaRuntimeStatus(),
        ai_gateway_runtime:aiGatewayStatus()
      },
      { status:200,headers:{ "Cache-Control":"no-store" } }
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
