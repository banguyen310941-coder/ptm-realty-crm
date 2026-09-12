import { bearerToken, serverRpc } from "@/lib/server-data-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function statusFor(result) {
  if (result?.ok) return 200;
  if (result?.code === "UNAUTHENTICATED") return 401;
  if (result?.code === "FORBIDDEN") return 403;
  if (result?.code === "NOT_FOUND") return 404;
  if (result?.code === "BAD_REQUEST") return 400;
  return 400;
}

export async function GET(request) {
  const token = bearerToken(request);
  if (!token) return Response.json({ ok:false, error:"UNAUTHENTICATED" }, { status:401 });

  try {
    const result = await serverRpc("crm_facebook_automation_api_v2", {
      p_token:token,
      p_action:"bootstrap",
      p_payload:{}
    });
    return Response.json(result, { status:statusFor(result), headers:{ "Cache-Control":"no-store" } });
  } catch (error) {
    return Response.json(
      { ok:false, error:error?.message || "FACEBOOK_AUTOMATION_FAILED" },
      { status:500, headers:{ "Cache-Control":"no-store" } }
    );
  }
}

export async function POST(request) {
  const token = bearerToken(request);
  if (!token) return Response.json({ ok:false, error:"UNAUTHENTICATED" }, { status:401 });

  const body = await request.json().catch(() => ({}));
  const action = String(body?.action || "save").trim();

  try {
    const result = await serverRpc("crm_facebook_automation_api_v2", {
      p_token:token,
      p_action:action,
      p_payload:body?.payload || {}
    });
    return Response.json(result, { status:statusFor(result), headers:{ "Cache-Control":"no-store" } });
  } catch (error) {
    return Response.json(
      { ok:false, error:error?.message || "FACEBOOK_AUTOMATION_FAILED" },
      { status:500, headers:{ "Cache-Control":"no-store" } }
    );
  }
}
