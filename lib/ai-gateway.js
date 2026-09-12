const DEFAULT_MODEL = String(process.env.PTM_AI_MODEL || "openai/gpt-5.6-luna").trim();

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

function parseJsonContent(value) {
  const raw = String(value || "").trim();
  const cleaned = raw
    .replace(/^\`\`\`(?:json)?\s*/i, "")
    .replace(/\s*\`\`\`$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

export async function generateGatewayJson({ system, prompt, model = DEFAULT_MODEL }) {
  const token = authToken();
  if (!token) {
    const error = new Error("AI Gateway chưa được bật cho project Vercel.");
    error.code = "AI_GATEWAY_NOT_CONFIGURED";
    throw error;
  }

  const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method:"POST",
    headers:{
      Authorization:`Bearer ${token}`,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      model,
      messages:[
        { role:"system", content:String(system || "") },
        { role:"user", content:String(prompt || "") }
      ],
      temperature:0.35
    }),
    cache:"no-store"
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
      model:data?.model || model,
      usage:data?.usage || null
    };
  } catch {
    const error = new Error("AI trả về dữ liệu không đúng định dạng kịch bản.");
    error.code = "AI_INVALID_RESPONSE";
    error.raw = content;
    throw error;
  }
}
