import { createHash } from "crypto";
import { serverRpc } from "@/lib/server-data-api";
import { extractVietnamPhone, fetchMetaProfile, metaAppSecret, sendMetaText, verifyMetaSignature } from "@/lib/facebook-meta";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 45;

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

function eventMessageId(pageId, psid, event) {
  const direct = String(event?.message?.mid || event?.postback?.mid || "").trim();
  if (direct) return direct;
  if (!event?.postback) return "";

  const stable = [
    "postback",
    String(pageId || ""),
    String(psid || ""),
    String(event?.timestamp || ""),
    String(event?.postback?.payload || ""),
    String(event?.postback?.title || "")
  ].join("|");

  return "synthetic_postback_" + createHash("sha256").update(stable,"utf8").digest("hex").slice(0,40);
}

async function processMessagingEvent({ pageId, psid, event, senderName, secret }) {
  const text = messageText(event);
  const phone = extractVietnamPhone(text);
  const messageId = eventMessageId(pageId, psid, event);

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

  let autoReply = null;
  if (result?.ok && result?.conversation_id && text) {
    const claimed = await serverRpc("crm_facebook_auto_reply_claim_v3", {
      p_secret:secret,
      p_conversation_id:result.conversation_id,
      p_inbound_message_id:messageId || null,
      p_text:text
    });

    if (claimed?.ok && claimed?.matched && claimed?.reply_text && claimed?.attempt_id) {
      let sent = null;
      try {
        sent = await sendMetaText(pageId, psid, claimed.reply_text);
      } catch (sendError) {
        await serverRpc("crm_facebook_auto_reply_finish_v2", {
          p_secret:secret,
          p_attempt_id:claimed.attempt_id,
          p_success:false,
          p_outbound_message_id:null,
          p_error:sendError?.message || "AUTO_REPLY_SEND_FAILED",
          p_payload:{ source:"scenario" }
        }).catch(() => {});

        autoReply = {
          sent:false,
          attempt_id:claimed.attempt_id,
          scenario_id:claimed.scenario_id,
          scenario_name:claimed.scenario_name,
          error:sendError?.message || "AUTO_REPLY_SEND_FAILED"
        };
      }

      if (sent) {
        try {
          const finalized = await serverRpc("crm_facebook_auto_reply_finish_v2", {
            p_secret:secret,
            p_attempt_id:claimed.attempt_id,
            p_success:true,
            p_outbound_message_id:sent?.message_id || null,
            p_error:null,
            p_payload:{
              source:"scenario",
              scenario_name:claimed.scenario_name || null,
              meta_response:sent || {}
            }
          });
          autoReply = {
            sent:true,
            logged:Boolean(finalized?.ok && finalized?.status === "sent"),
            attempt_id:claimed.attempt_id,
            scenario_id:claimed.scenario_id,
            scenario_name:claimed.scenario_name,
            message_id:sent?.message_id || null
          };
        } catch (finalizeError) {
          // Meta already accepted this message; never mark it retryable.
          console.error("[facebook-webhook] Meta sent but DB finalize failed", {
            attempt_id:claimed.attempt_id,
            message_id:sent?.message_id || null,
            error:finalizeError?.message || "FINALIZE_FAILED"
          });
          autoReply = {
            sent:true,
            logged:false,
            reconciliation_needed:true,
            attempt_id:claimed.attempt_id,
            scenario_id:claimed.scenario_id,
            scenario_name:claimed.scenario_name,
            message_id:sent?.message_id || null
          };
        }
      }
    } else if (claimed?.reason) {
      autoReply = { sent:false, skipped:true, reason:claimed.reason };
    }
  }

  return { ...result, auto_reply:autoReply };
}

async function processConversationGroup(group, secret) {
  const senderName = await fetchMetaProfile(group.pageId, group.psid);
  const results = [];
  const events = [...group.events].sort(
    (a,b) => (Number(a?.timestamp) || 0) - (Number(b?.timestamp) || 0)
  );

  // Keep one customer's events ordered so automation conditions and unread
  // counters cannot race each other.
  for (const event of events) {
    results.push(await processMessagingEvent({
      pageId:group.pageId,
      psid:group.psid,
      event,
      senderName,
      secret
    }));
  }
  return results;
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
    console.error("[facebook-webhook] verification failed", { error:error?.message || "META_VERIFY_FAILED" });
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

  try {
    const groupMap = new Map();

    for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
      const pageId = String(entry?.id || "").trim();
      if (!pageId) continue;

      for (const event of Array.isArray(entry?.messaging) ? entry.messaging : []) {
        if (event?.message?.is_echo) continue;
        if (!event?.message && !event?.postback) continue;

        const psid = String(event?.sender?.id || "").trim();
        if (!psid) continue;

        const key = pageId + ":" + psid;
        if (!groupMap.has(key)) groupMap.set(key,{ pageId,psid,events:[] });
        groupMap.get(key).events.push(event);
      }
    }

    const groups = [...groupMap.values()];
    const results = [];
    const concurrency = 4;

    // Process up to four different customers in parallel while preserving
    // strict ordering inside each customer's conversation.
    for (let offset=0; offset<groups.length; offset+=concurrency) {
      const batch = groups.slice(offset,offset+concurrency);
      const batchResults = await Promise.all(
        batch.map((group) => processConversationGroup(group,secret))
      );
      for (const rows of batchResults) results.push(...rows);
    }

    return Response.json(
      {
        ok:true,
        processed:results.length,
        conversations:groups.length,
        created_leads:results.filter((item) => item?.created_lead).length,
        auto_replies:results.filter((item) => item?.auto_reply?.sent).length,
        reconciliation_needed:results.filter((item) => item?.auto_reply?.reconciliation_needed).length
      },
      { status:200, headers:{ "Cache-Control":"no-store" } }
    );
  } catch (error) {
    console.error("[facebook-webhook] processing failed", { error:error?.message || "META_WEBHOOK_PROCESSING_FAILED" });
    return Response.json(
      { ok:false, error:error?.message || "META_WEBHOOK_PROCESSING_FAILED" },
      { status:500, headers:{ "Cache-Control":"no-store" } }
    );
  }
}
