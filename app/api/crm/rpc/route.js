import { bearerToken, serverRpc, serverRpcErrorStatus } from "@/lib/server-data-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 45;

const MODULES = {
  core:"crm_api_v2",
  full:"crm_full_api",
  finance:"crm_finance_api_v2",
  inventory:"crm_inventory_api",
  cemetery:"crm_cemetery_api"
};

function statusFor(result) {
  if (result?.ok) return 200;
  if (result?.code === "UNAUTHENTICATED") return 401;
  if (result?.code === "FORBIDDEN") return 403;
  return 400;
}

export async function POST(request) {
  const token = bearerToken(request);
  if (!token) return Response.json({ ok:false,error:"UNAUTHENTICATED" },{ status:401,headers:{ "Cache-Control":"no-store" } });

  const body = await request.json().catch(() => ({}));
  const moduleName = String(body?.module || "");
  const action = String(body?.action || "");
  const payload = body?.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? body.payload : {};
  const rpcName = MODULES[moduleName];

  if (!rpcName || !action || action.length > 80) {
    return Response.json({ ok:false,error:"INVALID_RPC_REQUEST" },{ status:400,headers:{ "Cache-Control":"no-store" } });
  }

  try {
    const result = await serverRpc(rpcName,{ p_token:token,p_action:action,p_payload:payload });
    return Response.json(
      result || { ok:false,error:"RPC_EMPTY_RESPONSE" },
      { status:statusFor(result),headers:{ "Cache-Control":"no-store" } }
    );
  } catch (error) {
    const status = serverRpcErrorStatus(error);
    return Response.json(
      { ok:false,error:error?.message || "CRM_RPC_FAILED",code:error?.code || "CRM_RPC_FAILED" },
      { status,headers:{ "Cache-Control":"no-store",...(status===503 ? { "Retry-After":"3" } : {}) } }
    );
  }
}
