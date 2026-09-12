import { serverRpc } from "@/lib/server-data-api";
import { metaAppSecret, sendMetaText } from "@/lib/facebook-meta";

let lastRunAt = 0;

export async function runFacebookRetryBatch({ limit = 5, minIntervalMs = 60000, force = false } = {}) {
  const secret = metaAppSecret();
  if (!secret) return { ok:true, skipped:true, reason:"META_NOT_CONFIGURED", processed:0, sent:0, failed:0, reconciliation_needed:0 };

  const now = Date.now();
  if (!force && now - lastRunAt < minIntervalMs) {
    return { ok:true, skipped:true, reason:"THROTTLED", processed:0, sent:0, failed:0, reconciliation_needed:0 };
  }
  lastRunAt = now;

  const claimed = await serverRpc("crm_facebook_retry_claim_v1", {
    p_secret:secret,
    p_limit:Math.max(1,Math.min(Number(limit) || 5,10))
  });

  if (!claimed?.ok) return claimed || { ok:false, error:"RETRY_CLAIM_FAILED" };

  const items = Array.isArray(claimed?.items) ? claimed.items : [];
  let sent = 0;
  let failed = 0;
  let reconciliationNeeded = 0;

  for (const item of items) {
    let meta;
    try {
      meta = await sendMetaText(item.page_id, item.psid, item.reply_text);
    } catch (error) {
      failed += 1;
      await serverRpc("crm_facebook_auto_reply_finish_v2", {
        p_secret:secret,
        p_attempt_id:item.attempt_id,
        p_success:false,
        p_outbound_message_id:null,
        p_error:error?.message || "AUTO_REPLY_RETRY_FAILED",
        p_payload:{ source:"scenario_retry", retry_count:item.retry_count || 0 }
      }).catch(() => {});
      continue;
    }

    // Meta has accepted the message. From this point on we must never mark it as
    // failed/retryable, otherwise a transient DB logging error can duplicate-send.
    try {
      const done = await serverRpc("crm_facebook_auto_reply_finish_v2", {
        p_secret:secret,
        p_attempt_id:item.attempt_id,
        p_success:true,
        p_outbound_message_id:meta?.message_id || null,
        p_error:null,
        p_payload:{
          source:"scenario_retry",
          retry_count:item.retry_count || 0,
          meta_response:meta || {}
        }
      });
      if (done?.ok) sent += 1;
      else {
        sent += 1;
        reconciliationNeeded += 1;
        console.error("[facebook-retry] Meta sent but DB finalize returned not-ok", { attempt_id:item.attempt_id });
      }
    } catch (error) {
      sent += 1;
      reconciliationNeeded += 1;
      console.error("[facebook-retry] Meta sent but DB finalize failed", {
        attempt_id:item.attempt_id,
        message_id:meta?.message_id || null,
        error:error?.message || "FINALIZE_FAILED"
      });
    }
  }

  return { ok:true, processed:items.length, sent, failed, reconciliation_needed:reconciliationNeeded };
}
