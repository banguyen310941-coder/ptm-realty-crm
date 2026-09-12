const DEFAULT_MODEL = String(process.env.PTM_AI_MODEL || "openai/gpt-5.6-sol").trim();
const MODEL_CACHE_MS = 60 * 60 * 1000;
let modelCache = { at:0, ids:null };

function authToken() {
  return String(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || "").trim();
}

export function aiGatewayStatus() {
  return {
    configured:Boolean(authToken()),
    model:DEFAULT_MODEL,
    auth_mode:process.env.AI_GATEWAY_API_KEY ? "api_key" : (process.env.VERCEL_OIDC_TOKEN ? "oidc" : "none")
  };
}

export function sanitizeAiText(value) {
  return String(value || "")
    .replace(/(?:\+?84|0)(?:[\s.\-()]?\d){9,10}/g, "[SĐT_ẨN]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL_ẨN]")
    .slice(0,4000);
}

function parseJsonContent(value) {
  const raw = String(value || "").trim();
  const cleaned = raw
    .replace(/^\`\`\`(?:json)?\s*/i, "")
    .replace(/\s*\`\`\`$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(cleaned.slice(first,last + 1));
    throw new Error("INVALID_JSON");
  }
}

async function availableModelIds() {
  if (modelCache.ids && Date.now() - modelCache.at < MODEL_CACHE_MS) return modelCache.ids;

  try {
    const response = await fetch("https://ai-gateway.vercel.sh/v1/models", {
      cache:"no-store",
      signal:AbortSignal.timeout(5000)
    });
    const data = await response.json().catch(() => ({}));
    const ids = new Set(
      Array.isArray(data?.data)
        ? data.data.filter((item) => item?.type === "language" || !item?.type).map((item) => String(item?.id || "")).filter(Boolean)
        : []
    );
    if (ids.size) modelCache = { at:Date.now(), ids };
    return ids;
  } catch {
    return new Set();
  }
}

async function resolveModel(requested) {
  const ids = await availableModelIds();
  if (!ids.size) return requested || DEFAULT_MODEL;
  if (requested && ids.has(requested)) return requested;

  const preferred = [
    DEFAULT_MODEL,
    "openai/gpt-5.6-sol",
    "openai/gpt-5.4",
    "anthropic/claude-sonnet-5"
  ];
  for (const model of preferred) {
    if (model && ids.has(model)) return model;
  }

  return [...ids].find((id) => id.startsWith("openai/"))
    || [...ids].find((id) => id.startsWith("anthropic/"))
    || [...ids][0];
}

export async function generateGatewayJson({ system, prompt, model = DEFAULT_MODEL }) {
  const token = authToken();
  if (!token) {
    const error = new Error("AI Gateway chưa được bật cho project Vercel.");
    error.code = "AI_GATEWAY_NOT_CONFIGURED";
    throw error;
  }

  const resolvedModel = await resolveModel(model);
  const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method:"POST",
    headers:{
      Authorization:`Bearer ${token}`,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      model:resolvedModel,
      messages:[
        { role:"system", content:String(system || "") },
        { role:"user", content:String(prompt || "") }
      ],
      temperature:0.3,
      max_tokens:1200
    }),
    cache:"no-store",
    signal:AbortSignal.timeout(20000)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    const error = new Error(data?.error?.message || "AI Gateway không tạo được đề xuất.");
    error.code = data?.error?.code || "AI_GATEWAY_REQUEST_FAILED";
    error.status = response.status;
    throw error;
  }

  const content = data?.choices?.[0]?.message?.content || "";
  try {
    return {
      data:parseJsonContent(content),
      model:data?.model || resolvedModel,
      usage:data?.usage || null
    };
  } catch {
    const error = new Error("AI trả về dữ liệu không đúng định dạng JSON.");
    error.code = "AI_INVALID_RESPONSE";
    error.raw = content;
    throw error;
  }
}
