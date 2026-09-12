import { bearerToken, serverRpc } from "@/lib/server-data-api";
import { metaRuntimeStatus } from "@/lib/facebook-meta";
import { aiGatewayStatus } from "@/lib/ai-gateway";
import { runFacebookRetryBatch } from "@/lib/facebook-retry";

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
  if (!token) {
    return Response.json({ ok:false, error:"UNAUTHENTICATED" }, { status:401, headers:{ "Cache-Control":"no-store" } });
  }

  const url = new URL(request.url);
  const conversationId = String(url.searchParams.get("conversation_id") || "").trim();

  try {
    const result = await serverRpc("crm_facebook_api_v1", {
      p_token:token,
      p_action:conversationId ? "messages" : "bootstrap",
      p_payload:conversationId ? { conversation_id:conversationId } : {}
    });

    if (result?.ok && !conversationId) {
      result.runtime = { ...metaRuntimeStatus(), ai:aiGatewayStatus() };
      result.retry = await runFacebookRetryBatch({ limit:3, minIntervalMs:60000 }).catch((error) => ({
        ok:false,error:error?.message || "FACEBOOK_RETRY_FAILED"
      }));
    }
    return Response.json(result, { status:statusFor(result), headers:{ "Cache-Control":"no-store" } });
  } catch (error) {
    return Response.json(
      { ok:false, error:error?.message || "FACEBOOK_INBOX_FAILED" },
      { status:500, headers:{ "Cache-Control":"no-store" } }
    );
  }
}

export async function POST(request) {
  const token = bearerToken(request);
  if (!token) {
    return Response.json({ ok:false, error:"UNAUTHENTICATED" }, { status:401, headers:{ "Cache-Control":"no-store" } });
  }

  const body = await request.json().catch(() => ({}));
  const conversationId = String(body?.conversation_id || "").trim();
  if (!conversationId) {
    return Response.json({ ok:false, error:"CONVERSATION_REQUIRED" }, { status:400, headers:{ "Cache-Control":"no-store" } });
  }

  const action = String(body?.action || "mark_read").trim();
  const allowed = new Set(["mark_read","pause_automation","resume_automation"]);
  if (!allowed.has(action)) {
    return Response.json({ ok:false, error:"INVALID_ACTION" }, { status:400, headers:{ "Cache-Control":"no-store" } });
  }

  try {
    const result = await serverRpc("crm_facebook_api_v1", {
      p_token:token,
      p_action:action,
      p_payload:{
        conversation_id:conversationId,
        ...(action === "pause_automation" ? {
          minutes:Number(body?.minutes || 480),
          reason:String(body?.reason || "manual_pause").slice(0,120)
        } : {})
      }
    });
    return Response.json(result, { status:statusFor(result), headers:{ "Cache-Control":"no-store" } });
  } catch (error) {
    return Response.json(
      { ok:false, error:error?.message || "FACEBOOK_INBOX_ACTION_FAILED" },
      { status:500, headers:{ "Cache-Control":"no-store" } }
    );
  }
}
