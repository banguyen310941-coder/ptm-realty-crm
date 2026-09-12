import { bearerToken, serverRpc } from "@/lib/server-data-api";
import { aiGatewayStatus, generateGatewayJson, sanitizeAiText } from "@/lib/ai-gateway";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json({ ok:true, ai:aiGatewayStatus() }, { headers:{ "Cache-Control":"no-store" } });
}

export async function POST(request) {
  const token = bearerToken(request);
  if (!token) {
    return Response.json({ ok:false, error:"UNAUTHENTICATED" }, { status:401, headers:{ "Cache-Control":"no-store" } });
  }

  const body = await request.json().catch(() => ({}));
  const conversationId = String(body?.conversation_id || "").trim();
  if (!conversationId) {
    return Response.json({ ok:false, error:"CONVERSATION_REQUIRED" }, { status:400, headers:{ "Cache-Control":"no-store" } });
  }

  try {
    const thread = await serverRpc("crm_facebook_api_v1", {
      p_token:token,
      p_action:"messages",
      p_payload:{ conversation_id:conversationId }
    });

    if (!thread?.ok) {
      const status = thread?.code === "UNAUTHENTICATED" ? 401 : thread?.code === "FORBIDDEN" ? 403 : 404;
      return Response.json(thread, { status, headers:{ "Cache-Control":"no-store" } });
    }

    const conv = thread?.conversation || {};
    const messages = (Array.isArray(thread?.messages) ? thread.messages : [])
      .slice(-16)
      .map((m) => ({
        role:m.direction === "outbound" ? "nhan_vien" : "khach",
        text:sanitizeAiText(m.text_content || "")
      }))
      .filter((m) => m.text);

    const system = [
      "Bạn là trợ lý soạn câu trả lời Messenger cho CRM Phúc Trường Minh.",
      "Viết ngắn, lịch sự, tự nhiên bằng tiếng Việt và phù hợp ngữ cảnh hội thoại.",
      "Không tự bịa giá, ưu đãi, pháp lý, chính sách, vị trí, thời hạn hoặc cam kết.",
      "Nếu thiếu dữ liệu, hãy hỏi thêm nhu cầu hoặc đề nghị nhân viên xác nhận thay vì khẳng định.",
      "Không lặp lại số điện thoại/email; dữ liệu nhạy cảm đã được ẩn trước khi gửi cho bạn.",
      "Chỉ trả về JSON thuần."
    ].join(" ");

    const prompt = JSON.stringify({
      lead_context:{
        status:String(conv?.lead_status || ""),
        has_phone:Boolean(conv?.lead_phone || conv?.phone_detected),
        assigned:Boolean(conv?.owner_id),
        within_24h:Boolean(conv?.within_24h)
      },
      conversation:messages,
      output_schema:{
        reply:"string",
        intent:"string",
        next_action:"string",
        caution:"string"
      },
      requirements:[
        "reply dài tối đa khoảng 3 câu",
        "ưu tiên trả lời câu hỏi mới nhất của khách",
        "nếu khách chưa để số điện thoại và phù hợp ngữ cảnh, có thể xin số một cách nhẹ nhàng",
        "không được tự gửi; chỉ đề xuất để nhân viên duyệt"
      ]
    });

    const generated = await generateGatewayJson({ system, prompt });
    const data = generated?.data || {};
    const reply = String(data?.reply || "").trim().slice(0,1800);
    if (!reply) {
      return Response.json({ ok:false, error:"AI chưa tạo được câu trả lời phù hợp.", code:"AI_EMPTY" }, { status:502 });
    }

    return Response.json({
      ok:true,
      reply,
      intent:String(data?.intent || "").trim().slice(0,200),
      next_action:String(data?.next_action || "").trim().slice(0,300),
      caution:String(data?.caution || "").trim().slice(0,300),
      ai:{ model:generated.model, usage:generated.usage }
    }, { headers:{ "Cache-Control":"no-store" } });
  } catch (error) {
    const status = error?.code === "AI_GATEWAY_NOT_CONFIGURED" ? 503 : 502;
    return Response.json(
      { ok:false, error:error?.message || "AI_REPLY_FAILED", code:error?.code || "AI_REPLY_FAILED" },
      { status, headers:{ "Cache-Control":"no-store" } }
    );
  }
}
