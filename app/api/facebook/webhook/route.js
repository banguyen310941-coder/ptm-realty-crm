import { serverRpc } from "@/lib/server-data-api";
import { extractVietnamPhone, fetchMetaProfile, metaAppSecret, verifyMetaSignature } from "@/lib/facebook-meta";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function messageText(event) {
  const direct = String(event?.message?.text || "").trim();
  if (direct) return direct;

  const postback = String(event?.postback?.title || event?.postback?.payload || "").trim();
  if (postback) return postback;

  const attachments = Array.isArray(event?.message?.attachments) ? event.message.attachments : [];
  if (!attachments.length) return "";
  const labels = attachments.map((item) => {
    const type = String(item?.type || "attachment");
    if (type === "image") return "[Hình ảnh]";
    if (type === "video") return "[Video]";
    if (type === "audio") return "[Âm thanh]";
    if (type === "file") return "[Tệp]";
    if (type === "location") return "[Vị trí]";
    return "[Đính kèm]";
  });
  return labels.join(" ");
}

function eventPayload(event) {
  const attachments = Array.isArray(event?.message?.attachments) ? event.message.attachments : [];
  return {
    message_type:event?.postback ? "postback" : attachments[0]?.type || "text",
    quick_reply:event?.message?.quick_reply?.payload || null,
    postback:event?.postback || null,
    attachments:attachments.map((item) => ({
      type:item?.type || null,
      url:item?.payload?.url || null,
      coordinates:item?.payload?.coordinates || null
    }))
  };
}

function eventTimestamp(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString();
  const date = new Date(n);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export async function GET(request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode") || "";
  const verifyToken = url.searchParams.get("hub.verify_token") || "";
  const challenge = url.searchParams.get("hub.challenge") || "";

  if (mode && mode !== "subscribe") {
    return Response.json({ ok:false, error:"INVALID_HUB_MODE" }, { status:400, headers:{ "Cache-Control":"no-store" } });
  }
  if (!verifyToken || !challenge) {
    return Response.json({ ok:false, error:"VERIFY_TOKEN_AND_CHALLENGE_REQUIRED" }, { status:400, headers:{ "Cache-Control":"no-store" } });
  }

  try {
    const verified = await serverRpc("crm_webhook_verify_v1", { p_secret:verifyToken, p_kind:"meta" });
    if (verified === true) {
      return new Response(challenge, { status:200, headers:{ "Content-Type":"text/plain", "Cache-Control":"no-store" } });
    }
    return Response.json({ ok:false, error:"INVALID_VERIFY_TOKEN" }, { status:403, headers:{ "Cache-Control":"no-store" } });
  } catch (error) {
    return Response.json({ ok:false, error:error?.message || "META_VERIFY_FAILED" }, { status:503, headers:{ "Cache-Control":"no-store" } });
  }
}

export async function POST(request) {
  const secret = metaAppSecret();
  if (!secret) {
    return Response.json({ ok:false, error:"PTM_META_APP_SECRET_NOT_CONFIGURED" }, { status:503, headers:{ "Cache-Control":"no-store" } });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256") || "";
  if (!verifyMetaSignature(rawBody, signature)) {
    return Response.json({ ok:false, error:"INVALID_META_SIGNATURE" }, { status:401, headers:{ "Cache-Control":"no-store" } });
  }

  let body;
  try {
    body = JSON.parse(rawBody || "{}");
  } catch {
    return Response.json({ ok:false, error:"INVALID_JSON" }, { status:400, headers:{ "Cache-Control":"no-store" } });
  }

  if (body?.object !== "page") {
    return Response.json({ ok:true, ignored:true }, { status:200, headers:{ "Cache-Control":"no-store" } });
  }

  const results = [];
  const profileCache = new Map();

  try {
    for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
      const pageId = String(entry?.id || "").trim();

      for (const event of Array.isArray(entry?.messaging) ? entry.messaging : []) {
        if (event?.message?.is_echo) continue;
        if (!event?.message && !event?.postback) continue;

        const psid = String(event?.sender?.id || "").trim();
        if (!pageId || !psid) continue;

        const text = messageText(event);
        const phone = extractVietnamPhone(text);
        const messageId = String(event?.message?.mid || event?.postback?.mid || "").trim();
        const cacheKey = pageId + ":" + psid;

        let senderName = profileCache.get(cacheKey);
        if (senderName === undefined) {
          senderName = await fetchMetaProfile(pageId, psid);
          profileCache.set(cacheKey, senderName);
        }

        const result = await serverRpc("crm_facebook_receive_v1", {
          p_secret:secret,
          p_page_id:pageId,
          p_psid:psid,
          p_message_id:messageId || null,
          p_text:text || null,
          p_phone:phone || null,
          p_sender_name:senderName || null,
          p_payload:eventPayload(event),
          p_received_at:eventTimestamp(event?.timestamp)
        });
        results.push(result);
      }
    }

    return Response.json(
      { ok:true, processed:results.length, created_leads:results.filter((item) => item?.created_lead).length },
      { status:200, headers:{ "Cache-Control":"no-store" } }
    );
  } catch (error) {
    return Response.json(
      { ok:false, error:error?.message || "META_WEBHOOK_PROCESSING_FAILED" },
      { status:500, headers:{ "Cache-Control":"no-store" } }
    );
  }
}
