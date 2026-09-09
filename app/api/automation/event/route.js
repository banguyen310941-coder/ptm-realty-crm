import { bearerToken, serverRpc } from "@/lib/server-data-api";

export const dynamic = "force-dynamic";

const ALLOWED_EVENTS = new Set([
  "lead_created","lead_assigned","lead_accepted","lead_status_changed","followup_due",
  "opportunity_stage_changed","ticket_created","deal_completed"
]);

export async function POST(request) {
  try {
    const token = bearerToken(request);
    if (!token) return Response.json({ ok:false, error:"UNAUTHENTICATED" }, { status:401 });

    const body = await request.json().catch(() => ({}));
    const eventType = String(body.event_type || "");
    if (!ALLOWED_EVENTS.has(eventType)) {
      return Response.json({ ok:false, error:"INVALID_EVENT" }, { status:400 });
    }

    const result = await serverRpc("crm_automation_event_v1", {
      p_token:token,
      p_event_type:eventType,
      p_lead_id:body.lead_id || null,
      p_owner_id:body.owner_id || null,
      p_payload:body.payload || body || {}
    });

    if (!result?.ok && result?.code === "UNAUTHENTICATED") {
      return Response.json(result, { status:401, headers:{ "Cache-Control":"no-store" } });
    }
    return Response.json(result || { ok:false, error:"AUTOMATION_EVENT_FAILED" }, { status:result?.ok ? 200 : 400, headers:{ "Cache-Control":"no-store" } });
  } catch (error) {
    return Response.json({ ok:false, error:error?.message || "AUTOMATION_EVENT_FAILED" }, { status:500 });
  }
}
