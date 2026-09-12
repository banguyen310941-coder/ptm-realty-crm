import { createHmac, timingSafeEqual } from "crypto";

export const META_GRAPH_VERSION = process.env.PTM_META_GRAPH_VERSION || "v26.0";

export function metaAppSecret() {
  return String(process.env.PTM_META_APP_SECRET || "").trim();
}

export function metaPageConfigs() {
  const out = [];
  const raw = String(process.env.PTM_META_PAGES_JSON || "").trim();

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      for (const item of Array.isArray(parsed) ? parsed : []) {
        const pageId = String(item?.page_id || item?.pageId || item?.id || "").trim();
        const accessToken = String(item?.access_token || item?.accessToken || item?.token || "").trim();
        if (pageId && accessToken) out.push({ pageId, accessToken, name:String(item?.name || "").trim() });
      }
    } catch {
      // Keep runtime alive; status endpoints will report no configured pages.
    }
  }

  const singlePageId = String(process.env.PTM_META_PAGE_ID || "").trim();
  const singleToken = String(process.env.PTM_META_PAGE_ACCESS_TOKEN || "").trim();
  if (singlePageId && singleToken && !out.some((item) => item.pageId === singlePageId)) {
    out.push({ pageId:singlePageId, accessToken:singleToken, name:String(process.env.PTM_META_PAGE_NAME || "").trim() });
  }

  return out;
}

export function metaRuntimeStatus() {
  const pages = metaPageConfigs();
  return {
    configured:Boolean(metaAppSecret() && pages.length),
    app_secret:Boolean(metaAppSecret()),
    page_count:pages.length,
    graph_version:META_GRAPH_VERSION
  };
}

export function getMetaPageConfig(pageId) {
  return metaPageConfigs().find((item) => item.pageId === String(pageId || "").trim()) || null;
}

export function verifyMetaSignature(rawBody, signature) {
  const secret = metaAppSecret();
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const actualBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function extractVietnamPhone(value) {
  const input = String(value || "");
  const candidates = input.match(/(?:\+?84|0)(?:[\s.\-()]?\d){9,10}/g) || [];

  for (const candidate of candidates) {
    let digits = candidate.replace(/\D/g, "");
    if (digits.startsWith("84") && digits.length === 11) digits = "0" + digits.slice(2);
    if (/^0\d{9,10}$/.test(digits)) return digits;
  }
  return "";
}

export async function fetchMetaProfile(pageId, psid) {
  const page = getMetaPageConfig(pageId);
  if (!page) return "";

  try {
    const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(psid)}`);
    url.searchParams.set("fields", "name,first_name,last_name");
    const response = await fetch(url, {
      headers:{ Authorization:`Bearer ${page.accessToken}` },
      cache:"no-store"
    });
    if (!response.ok) return "";
    const data = await response.json().catch(() => ({}));
    return String(data?.name || [data?.first_name,data?.last_name].filter(Boolean).join(" ") || "").trim();
  } catch {
    return "";
  }
}

export async function sendMetaText(pageId, psid, text) {
  const page = getMetaPageConfig(pageId);
  if (!page) {
    const error = new Error("Fanpage chưa có Page Access Token trên Vercel.");
    error.code = "META_PAGE_TOKEN_MISSING";
    throw error;
  }

  const response = await fetch(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(page.pageId)}/messages`,
    {
      method:"POST",
      headers:{
        Authorization:`Bearer ${page.accessToken}`,
        "Content-Type":"application/json"
      },
      body:JSON.stringify({
        recipient:{ id:String(psid) },
        messaging_type:"RESPONSE",
        message:{ text:String(text) }
      }),
      cache:"no-store"
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    const error = new Error(data?.error?.message || "Meta Send API từ chối gửi tin nhắn.");
    error.code = data?.error?.code || "META_SEND_FAILED";
    error.meta = data?.error || null;
    throw error;
  }
  return data;
}
