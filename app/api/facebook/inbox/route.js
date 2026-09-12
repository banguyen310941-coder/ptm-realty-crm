import { bearerToken, serverRpc } from "@/lib/server-data-api";
import { metaRuntimeStatus } from "@/lib/facebook-meta";

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

    if (result?.ok && !conversationId) result.runtime = metaRuntimeStatus();
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

  try {
    const result = await serverRpc("crm_facebook_api_v1", {
      p_token:token,
      p_action:"mark_read",
      p_payload:{ conversation_id:conversationId }
    });
    return Response.json(result, { status:statusFor(result), headers:{ "Cache-Control":"no-store" } });
  } catch (error) {
    return Response.json(
      { ok:false, error:error?.message || "FACEBOOK_MARK_READ_FAILED" },
      { status:500, headers:{ "Cache-Control":"no-store" } }
    );
  }
}
