export function integrationStatus() {
  return {
    database: Boolean(process.env.DATABASE_URL),
    lead_webhook: Boolean(process.env.LEAD_WEBHOOK_SECRET),
    email: Boolean(process.env.RESEND_API_KEY && process.env.PTM_EMAIL_FROM),
    zalo: Boolean(process.env.PTM_ZALO_BRIDGE_URL),
    facebook_verify: Boolean(process.env.META_WEBHOOK_VERIFY_TOKEN || process.env.LEAD_WEBHOOK_SECRET),
    providers: {
      website: true,
      facebook: true,
      tiktok: true,
      zalo: true,
      google: true,
      hotline: true
    }
  };
}

export async function sendEmailMessage({ to, subject, text, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PTM_EMAIL_FROM;
  if (!apiKey || !from || !to) {
    return { ok:false, skipped:true, reason:"EMAIL_NOT_CONFIGURED" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method:"POST",
    headers:{
      "Authorization":`Bearer ${apiKey}`,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      from,
      to:[to],
      subject:subject || "Thông báo từ PTM CRM",
      text:text || undefined,
      html:html || undefined
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok:false, skipped:false, reason:"EMAIL_PROVIDER_ERROR", detail:body?.message || response.statusText };
  }
  return { ok:true, id:body?.id || null };
}

export async function sendZaloBridgeMessage({ phone, template, text, data = {} }) {
  const url = process.env.PTM_ZALO_BRIDGE_URL;
  if (!url || !phone) {
    return { ok:false, skipped:true, reason:"ZALO_NOT_CONFIGURED" };
  }

  const headers = { "Content-Type":"application/json" };
  if (process.env.PTM_ZALO_BRIDGE_SECRET) headers["Authorization"] = `Bearer ${process.env.PTM_ZALO_BRIDGE_SECRET}`;

  const response = await fetch(url, {
    method:"POST",
    headers,
    body:JSON.stringify({
      phone,
      template:template || process.env.PTM_ZALO_DEFAULT_TEMPLATE || "crm_notification",
      text:text || "Thông báo từ PTM CRM",
      data
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok:false, skipped:false, reason:"ZALO_BRIDGE_ERROR", detail:body?.message || response.statusText };
  }
  return { ok:true, id:body?.id || body?.message_id || null };
}
