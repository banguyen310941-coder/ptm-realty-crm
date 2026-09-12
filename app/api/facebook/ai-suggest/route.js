import { bearerToken, serverRpc } from "@/lib/server-data-api";
import { aiGatewayStatus, generateGatewayJson, sanitizeAiText } from "@/lib/ai-gateway";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_TRIGGERS = new Set(["first_message","keyword","no_phone","has_phone","always"]);

function cleanSuggestion(item, index) {
  const trigger = VALID_TRIGGERS.has(item?.trigger_type) ? item.trigger_type : "keyword";
  const keywords = Array.isArray(item?.keywords)
    ? item.keywords.map((x) => String(x || "").trim()).filter(Boolean).slice(0,12)
    : [];

  return {
    name:String(item?.name || `Kịch bản AI ${index + 1}`).trim().slice(0,160),
    trigger_type:trigger,
    keywords,
    response_text:String(item?.response_text || "").trim().slice(0,5000),
    priority:Math.max(1,Math.min(9999,Number(item?.priority || 50))),
    cooldown_minutes:Math.max(0,Math.min(10080,Number(item?.cooldown_minutes || 120))),
    rationale:String(item?.rationale || "").trim().slice(0,500)
  };
}

export async function GET() {
  return Response.json({ ok:true, ai:aiGatewayStatus() }, { headers:{ "Cache-Control":"no-store" } });
}

export async function POST(request) {
  const token = bearerToken(request);
  if (!token) return Response.json({ ok:false, error:"UNAUTHENTICATED" }, { status:401 });

  const body = await request.json().catch(() => ({}));
  const goal = String(body?.goal || "").trim();
  const conversationId = String(body?.conversation_id || "").trim();

  try {
    const automation = await serverRpc("crm_facebook_automation_api_v2", {
      p_token:token,
      p_action:"bootstrap",
      p_payload:{}
    });
    if (!automation?.ok) {
      const status = automation?.code === "FORBIDDEN" ? 403 : 401;
      return Response.json(automation, { status });
    }

    let recentMessages = [];
    if (conversationId) {
      const thread = await serverRpc("crm_facebook_api_v1", {
        p_token:token,
        p_action:"messages",
        p_payload:{ conversation_id:conversationId }
      });
      if (thread?.ok && Array.isArray(thread?.messages)) {
        recentMessages = thread.messages.slice(-20).map((m) => ({
          direction:m.direction,
          text:sanitizeAiText(m.text_content || "").slice(0,1200)
        }));
      }
    }

    const existing = (automation?.scenarios || []).slice(0,30).map((s) => ({
      name:s.name,
      trigger_type:s.trigger_type,
      keywords:s.keywords,
      response_text:s.response_text,
      enabled:s.enabled
    }));

    const system = [
      "Bạn là chuyên gia thiết kế kịch bản chăm sóc khách hàng cho CRM Phúc Trường Minh.",
      "Hãy đề xuất kịch bản Messenger ngắn, lịch sự, tự nhiên bằng tiếng Việt.",
      "Không được tự bịa giá, khuyến mãi, pháp lý, chính sách, vị trí hoặc cam kết chưa có trong dữ liệu.",
      "Khi thiếu dữ liệu, dùng cách hỏi nhu cầu hoặc xin số điện thoại thay vì khẳng định.",
      "Mỗi kịch bản phải phù hợp để tự động gửi, không gây spam, không gây áp lực cho khách.",
      "Chỉ trả về JSON thuần, không markdown."
    ].join(" ");

    const prompt = JSON.stringify({
      business:"Phúc Trường Minh · CRM tư vấn khách hàng qua Fanpage",
      goal:goal || "Tạo bộ kịch bản giúp chào khách, xác định nhu cầu và xin số điện thoại tự nhiên.",
      allowed_trigger_types:["first_message","keyword","no_phone","has_phone","always"],
      existing_scenarios:existing,
      selected_conversation:recentMessages,
      output_schema:{
        suggestions:[{
          name:"string",
          trigger_type:"first_message|keyword|no_phone|has_phone|always",
          keywords:["string"],
          response_text:"string",
          priority:50,
          cooldown_minutes:120,
          rationale:"string"
        }]
      },
      requirements:[
        "Đề xuất 3 kịch bản khác nhau.",
        "Nếu trigger_type không phải keyword thì keywords để mảng rỗng.",
        "Ưu tiên câu trả lời 1-3 câu, có lời kêu gọi hành động nhẹ.",
        "Không lặp lại kịch bản đang có nếu không cần thiết."
      ]
    });

    const generated = await generateGatewayJson({ system, prompt });
    const suggestions = Array.isArray(generated?.data?.suggestions)
      ? generated.data.suggestions.map(cleanSuggestion).filter((x) => x.response_text)
      : [];

    if (!suggestions.length) {
      return Response.json({ ok:false, error:"AI chưa tạo được kịch bản phù hợp.", code:"AI_EMPTY" }, { status:502 });
    }

    return Response.json({
      ok:true,
      suggestions,
      ai:{ model:generated.model, usage:generated.usage }
    }, { headers:{ "Cache-Control":"no-store" } });
  } catch (error) {
    const status = error?.code === "AI_GATEWAY_NOT_CONFIGURED" ? 503 : 502;
    return Response.json(
      { ok:false, error:error?.message || "AI_SUGGEST_FAILED", code:error?.code || "AI_SUGGEST_FAILED" },
      { status, headers:{ "Cache-Control":"no-store" } }
    );
  }
}
