import { bearerToken, serverRpc } from "@/lib/server-data-api";
import { sendMetaText } from "@/lib/facebook-meta";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function resultStatus(result) {
  if (result?.ok) return 200;
  if (result?.code === "UNAUTHENTICATED") return 401;
  if (result?.code === "FORBIDDEN") return 403;
  if (result?.code === "NOT_FOUND") return 404;
  return 400;
}

export async function POST(request) {
  const token = bearerToken(request);
  if (!token) {
    return Response.json({ ok:false, error:"UNAUTHENTICATED" }, { status:401, headers:{ "Cache-Control":"no-store" } });
  }

  const body = await request.json().catch(() => ({}));
  const conversationId = String(body?.conversation_id || "").trim();
  const text = String(body?.text || "").trim();

  if (!conversationId) {
    return Response.json({ ok:false, error:"CONVERSATION_REQUIRED" }, { status:400, headers:{ "Cache-Control":"no-store" } });
  }
  if (!text) {
    return Response.json({ ok:false, error:"MESSAGE_REQUIRED" }, { status:400, headers:{ "Cache-Control":"no-store" } });
  }
  if (text.length > 2000) {
    return Response.json({ ok:false, error:"MESSAGE_TOO_LONG" }, { status:400, headers:{ "Cache-Control":"no-store" } });
  }

  try {
    const context = await serverRpc("crm_facebook_api_v1", {
      p_token:token,
      p_action:"send_context",
      p_payload:{ conversation_id:conversationId }
    });

    if (!context?.ok) {
      return Response.json(context, { status:resultStatus(context), headers:{ "Cache-Control":"no-store" } });
    }
    if (!context?.within_24h) {
      return Response.json(
        { ok:false, error:"Đã ngoài cửa sổ nhắn tin 24 giờ của Meta.", code:"OUTSIDE_24H_WINDOW" },
        { status:409, headers:{ "Cache-Control":"no-store" } }
      );
    }

    const metaResponse = await sendMetaText(context.page_id, context.psid, text);

    // Meta has accepted the message. A later CRM logging error must not be exposed
    // as a send failure, otherwise the Sale may press Send again and duplicate it.
    try {
      const logged = await serverRpc("crm_facebook_api_v1", {
        p_token:token,
        p_action:"log_outbound",
        p_payload:{
          conversation_id:conversationId,
          text,
          meta_message_id:metaResponse?.message_id || null,
          meta_response:metaResponse || {}
        }
      });

      if (!logged?.ok) {
        console.error("[facebook-send] Meta sent but CRM log returned not-ok", {
          conversation_id:conversationId,
          message_id:metaResponse?.message_id || null,
          code:logged?.code || null
        });
        return Response.json(
          {
            ok:true,
            conversation_id:conversationId,
            message_id:metaResponse?.message_id || null,
            warning:"MESSAGE_SENT_LOG_PENDING"
          },
          { status:200, headers:{ "Cache-Control":"no-store" } }
        );
      }
    } catch (logError) {
      console.error("[facebook-send] Meta sent but CRM log failed", {
        conversation_id:conversationId,
        message_id:metaResponse?.message_id || null,
        error:logError?.message || "LOG_FAILED"
      });
      return Response.json(
        {
          ok:true,
          conversation_id:conversationId,
          message_id:metaResponse?.message_id || null,
          warning:"MESSAGE_SENT_LOG_PENDING"
        },
        { status:200, headers:{ "Cache-Control":"no-store" } }
      );
    }

    return Response.json(
      { ok:true, conversation_id:conversationId, message_id:metaResponse?.message_id || null },
      { status:200, headers:{ "Cache-Control":"no-store" } }
    );
  } catch (error) {
    const code = error?.code || "META_SEND_FAILED";
    const status = code === "META_PAGE_TOKEN_MISSING" ? 503 : 502;
    return Response.json(
      { ok:false, error:error?.message || "Không gửi được tin nhắn Facebook.", code },
      { status, headers:{ "Cache-Control":"no-store" } }
    );
  }
}
