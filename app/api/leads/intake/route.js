import { bearerToken, serverRpc, serverRpcErrorStatus } from "@/lib/server-data-api";

export const dynamic = "force-dynamic";

const SOURCE_LABEL = {
  facebook:"Facebook", meta:"Facebook", tiktok:"TikTok", google:"Google", website:"Website",
  zalo:"Zalo", hotline:"Hotline", event:"Sự kiện", referral:"Giới thiệu", other:"Khác"
};

function text(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
  if (typeof value === "object") return "";
  return String(value).trim();
}

function objectFromFieldData(fields) {
  const out = {};
  for (const field of Array.isArray(fields) ? fields : []) {
    const key = text(field?.name).toLowerCase();
    if (!key) continue;
    out[key] = Array.isArray(field?.values) ? field.values[0] : field?.value;
  }
  return out;
}

function first(...values) {
  return values.map(text).find(Boolean) || "";
}

function unwrap(body) {
  const changeValue = body?.entry?.[0]?.changes?.[0]?.value || {};
  const leadData = body?.lead || body?.data || body?.payload || changeValue || body || {};
  const fieldData = objectFromFieldData(leadData?.field_data || changeValue?.field_data || body?.field_data);
  return { ...leadData, ...fieldData };
}

function parseUnitNumber(token) {
  let value=String(token || "").trim().replace(/\s+/g,"");
  if (!value) return 0;

  const separators=[...value.matchAll(/[.,]/g)].map((m)=>m.index);
  if (separators.length) {
    const last=separators[separators.length-1];
    const decimals=value.length-last-1;
    if (decimals>0 && decimals<=2) {
      value=value.slice(0,last).replace(/[.,]/g,"")+"."+value.slice(last+1).replace(/[.,]/g,"");
    } else {
      value=value.replace(/[.,]/g,"");
    }
  }

  const n=Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseBudgetValue(value) {
  const raw=text(value);
  if (!raw) return 0;

  const folded=raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const billion=folded.match(/([0-9][0-9.,\s]*)\s*(?:ty|billion|bn)\b/);
  const million=folded.match(/([0-9][0-9.,\s]*)\s*(?:trieu|tr|million|mn)\b/);

  if (billion || million) {
    const total=(billion ? parseUnitNumber(billion[1])*1e9 : 0)
      +(million ? parseUnitNumber(million[1])*1e6 : 0);
    return Number.isFinite(total) ? Math.round(total) : 0;
  }

  const match=folded.match(/[0-9][0-9.,\s]*/);
  if (!match) return 0;
  const digits=match[0].replace(/[^0-9]/g,"");
  const n=Number(digits);
  return Number.isFinite(n) ? n : 0;
}

function normalize(body, sourceHint) {
  const raw = unwrap(body);
  const sourceKey = first(sourceHint, raw.source, raw.platform, raw.channel, body?.source).toLowerCase();
  const source = SOURCE_LABEL[sourceKey] || (sourceKey ? sourceKey.slice(0, 80) : "Khác");
  const phone = first(raw.phone, raw.phone_number, raw.mobile, raw.telephone, raw.sdt, raw["số điện thoại"]);
  const email = first(raw.email, raw.email_address, raw.mail);
  const name = first(raw.name, raw.full_name, raw.fullname, raw.customer_name, raw.ho_ten, raw["họ tên"], raw["full name"]);
  const need = first(raw.need, raw.message, raw.requirement, raw.nhu_cau, raw["nhu cầu"]);
  const project = first(raw.project, raw.project_name, raw.product, raw.campaign_name, raw["dự án"]);
  const budgetRaw = first(raw.budget, raw.budget_max, raw.price_range, raw.ngan_sach, raw["ngân sách"]);
  const budget = parseBudgetValue(budgetRaw);
  const notes = first(raw.notes, raw.note, raw.comment, raw.content);
  const externalLeadId = first(raw.external_lead_id, raw.leadgen_id, raw.lead_id, raw.id, body?.leadgen_id);

  return {
    name:name || (phone ? `Khách ${phone.slice(-4)}` : ""),
    phone,
    email,
    source,
    need,
    project:project || "Thiên Phúc Vĩnh Hằng Viên",
    budget,
    notes,
    profile:{
      attribution:{
        provider:sourceKey || "other",
        external_lead_id:externalLeadId || null,
        form_id:first(raw.form_id, body?.form_id) || null,
        campaign_id:first(raw.campaign_id, body?.campaign_id) || null,
        ad_id:first(raw.ad_id, body?.ad_id) || null,
        adset_id:first(raw.adset_id, body?.adset_id) || null,
        utm_source:first(raw.utm_source, body?.utm_source) || sourceKey || null,
        utm_medium:first(raw.utm_medium, body?.utm_medium) || null,
        utm_campaign:first(raw.utm_campaign, body?.utm_campaign) || null,
        received_at:new Date().toISOString()
      }
    }
  };
}

function suppliedSecret(request) {
  return request.headers.get("x-ptm-webhook-secret") || bearerToken(request) || "";
}

export async function GET(request) {
  const url = new URL(request.url);
  const verifyToken = url.searchParams.get("hub.verify_token") || url.searchParams.get("verify_token") || "";
  const challenge = url.searchParams.get("hub.challenge") || url.searchParams.get("challenge") || "";

  try {
    if (challenge && verifyToken) {
      const verified = await serverRpc("crm_webhook_verify_v1", { p_secret:verifyToken, p_kind:"meta" });
      if (verified === true) return new Response(challenge, { status:200, headers:{ "Content-Type":"text/plain", "Cache-Control":"no-store" } });
      return Response.json({ ok:false, error:"INVALID_VERIFY_TOKEN" }, { status:403, headers:{ "Cache-Control":"no-store" } });
    }

    const status = await serverRpc("crm_integration_status_v1", {});
    return Response.json({ ok:true, endpoint:"PTM lead intake", configured:Boolean(status?.lead_webhook) }, { status:200, headers:{ "Cache-Control":"no-store" } });
  } catch (error) {
    return Response.json({ ok:false, error:error?.message || "LEAD_INTAKE_STATUS_FAILED" }, { status:503, headers:{ "Cache-Control":"no-store" } });
  }
}

export async function POST(request) {
  const url = new URL(request.url);
  try {
    if (url.searchParams.has("token")) {
      return Response.json(
        { ok:false, error:"QUERY_SECRET_NOT_ALLOWED", hint:"Dùng header x-ptm-webhook-secret hoặc Authorization: Bearer." },
        { status:400, headers:{ "Cache-Control":"no-store" } }
      );
    }
    const secret = suppliedSecret(request);
    if (!secret) return Response.json({ ok:false, error:"WEBHOOK_SECRET_REQUIRED" }, { status:401, headers:{ "Cache-Control":"no-store" } });

    const body = await request.json().catch(() => ({}));
    const lead = normalize(body, url.searchParams.get("source") || "");
    if (!lead.phone) {
      const directId = first(body?.leadgen_id, body?.entry?.[0]?.changes?.[0]?.value?.leadgen_id);
      if (directId) return Response.json({ ok:false, accepted:false, error:"LEAD_DETAILS_REQUIRED", external_lead_id:directId }, { status:202 });
      return Response.json({ ok:false, error:"PHONE_REQUIRED" }, { status:400 });
    }

    const result = await serverRpc("crm_lead_intake_v1", { p_secret:secret, p_lead:lead });
    if (!result?.ok) {
      const status = result?.error === "INVALID_WEBHOOK_SECRET" ? 401 : result?.error === "PHONE_REQUIRED" ? 400 : 400;
      return Response.json(result, { status, headers:{ "Cache-Control":"no-store" } });
    }
    return Response.json(result, { status:result.duplicate ? 200 : 201, headers:{ "Cache-Control":"no-store" } });
  } catch (error) {
    const message = error?.message || "LEAD_INTAKE_FAILED";
    if (/duplicate key|unique constraint/i.test(message)) return Response.json({ ok:false, error:"DUPLICATE_LEAD" }, { status:409 });
    const status=serverRpcErrorStatus(error);
    return Response.json(
      { ok:false, error:message, code:status===503 ? "DATA_API_TEMPORARY" : "LEAD_INTAKE_FAILED" },
      { status, headers:{ "Cache-Control":"no-store", ...(status===503 ? { "Retry-After":"3" } : {}) } }
    );
  }
}
