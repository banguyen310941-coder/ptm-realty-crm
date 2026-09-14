import { bearerToken, serverRpc, serverRpcErrorStatus } from "@/lib/server-data-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 45;

const ACTIONS = {
  "attendance.status":{ rpc:"crm_attendance_status",fields:[] },
  "attendance.team":{ rpc:"crm_team_attendance",fields:[] },
  "attendance.check_in":{ rpc:"crm_check_in",fields:["p_work_mode","p_evening_opt_in","p_photo_data","p_client_name","p_note"] },
  "attendance.check_out":{ rpc:"crm_check_out",fields:[] },
  "lead_offer.tick":{ rpc:"crm_lead_offer_tick",fields:[] },
  "lead_offer.mine":{ rpc:"crm_my_lead_offers",fields:[] },
  "lead_offer.accept":{ rpc:"crm_accept_lead_offer",fields:["p_offer_id"] }
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
  const action = String(body?.action || "");
  const config = ACTIONS[action];
  if (!config) return Response.json({ ok:false,error:"INVALID_DIRECT_ACTION" },{ status:400,headers:{ "Cache-Control":"no-store" } });

  const source = body?.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? body.payload : {};
  const args = { p_token:token };
  for (const key of config.fields) if (Object.prototype.hasOwnProperty.call(source,key)) args[key]=source[key];

  try {
    const result = await serverRpc(config.rpc,args);
    return Response.json(result || { ok:false,error:"RPC_EMPTY_RESPONSE" },{ status:statusFor(result),headers:{ "Cache-Control":"no-store" } });
  } catch (error) {
    const status = serverRpcErrorStatus(error);
    return Response.json(
      { ok:false,error:error?.message || "CRM_DIRECT_RPC_FAILED",code:error?.code || "CRM_DIRECT_RPC_FAILED" },
      { status,headers:{ "Cache-Control":"no-store",...(status===503 ? { "Retry-After":"3" } : {}) } }
    );
  }
}
