import { bearerToken, serverRpc } from "@/lib/server-data-api";
import { metaPageConfigs } from "@/lib/facebook-meta";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function mergeRuntimePages(result) {
  if (!result?.ok) return result;
  const configured = metaPageConfigs().map((page) => ({
    page_id:page.pageId,
    page_name:page.name || null,
    timezone:"Asia/Ho_Chi_Minh",
    business_days:[1,2,3,4,5,6],
    business_start:"08:00:00",
    business_end:"18:00:00"
  }));
  const existing = Array.isArray(result?.pages) ? result.pages : [];
  const map = new Map(existing.map((page) => [String(page.page_id),page]));
  for (const page of configured) {
    const current = map.get(String(page.page_id));
    map.set(String(page.page_id),current ? { ...page,...current,page_name:current.page_name || page.page_name } : page);
  }
  return { ...result,pages:[...map.values()] };
}

function statusFor(result) {
  if (result?.ok) return 200;
  if (result?.code === "UNAUTHENTICATED") return 401;
  if (result?.code === "FORBIDDEN") return 403;
  if (result?.code === "NOT_FOUND") return 404;
  if (result?.code === "BAD_REQUEST") return 400;
  return 400;
}

function infrastructureStatus(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return /PGRST202|schema cache|RPC_ERROR|fetch failed|network|connection|timeout|temporar|503|gateway/i.test(code + " " + message) ? 503 : 500;
}

export async function GET(request) {
  const token = bearerToken(request);
  if (!token) return Response.json({ ok:false, error:"UNAUTHENTICATED" }, { status:401 });

  try {
    const result = await serverRpc("crm_facebook_ops_api_v1", {
      p_token:token,
      p_action:"bootstrap",
      p_payload:{}
    });
    const response = mergeRuntimePages(result);
    return Response.json(response, { status:statusFor(response), headers:{ "Cache-Control":"no-store" } });
  } catch (error) {
    const status = infrastructureStatus(error);
    console.error("[facebook-ops] bootstrap failed", { code:error?.code || null,error:error?.message || "FACEBOOK_OPS_FAILED",status });
    return Response.json(
      { ok:false, error:status === 503 ? "Dịch vụ dữ liệu đang đồng bộ, vui lòng thử lại." : (error?.message || "FACEBOOK_OPS_FAILED"), code:status === 503 ? "DATA_API_TEMPORARY" : "FACEBOOK_OPS_FAILED" },
      { status, headers:{ "Cache-Control":"no-store", "Retry-After":status === 503 ? "3" : "0" } }
    );
  }
}

export async function POST(request) {
  const token = bearerToken(request);
  if (!token) return Response.json({ ok:false, error:"UNAUTHENTICATED" }, { status:401 });

  const body = await request.json().catch(() => ({}));
  const action = String(body?.action || "").trim();
  if (!action) return Response.json({ ok:false, error:"ACTION_REQUIRED" }, { status:400 });

  try {
    const result = await serverRpc("crm_facebook_ops_api_v1", {
      p_token:token,
      p_action:action,
      p_payload:body?.payload || {}
    });
    return Response.json(result, { status:statusFor(result), headers:{ "Cache-Control":"no-store" } });
  } catch (error) {
    const status = infrastructureStatus(error);
    console.error("[facebook-ops] action failed", { action,code:error?.code || null,error:error?.message || "FACEBOOK_OPS_FAILED",status });
    return Response.json(
      { ok:false, error:status === 503 ? "Dịch vụ dữ liệu đang đồng bộ, vui lòng thử lại." : (error?.message || "FACEBOOK_OPS_FAILED"), code:status === 503 ? "DATA_API_TEMPORARY" : "FACEBOOK_OPS_FAILED" },
      { status, headers:{ "Cache-Control":"no-store", "Retry-After":status === 503 ? "3" : "0" } }
    );
  }
}
