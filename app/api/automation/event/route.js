import { bearerToken, sessionUserFromToken } from "@/lib/server-auth";
import { runAutomationEvent } from "@/lib/automation-engine";

export const dynamic = "force-dynamic";

const ALLOWED_EVENTS = new Set([
  "lead_created","lead_assigned","lead_accepted","lead_status_changed","followup_due",
  "opportunity_stage_changed","ticket_created","deal_completed"
]);

export async function POST(request) {
  try {
    const token = bearerToken(request);
    const user = await sessionUserFromToken(token);
    if (!user) return Response.json({ ok:false, error:"UNAUTHENTICATED" }, { status:401 });

    const body = await request.json().catch(() => ({}));
    const eventType = String(body.event_type || "");
    if (!ALLOWED_EVENTS.has(eventType)) {
      return Response.json({ ok:false, error:"INVALID_EVENT" }, { status:400 });
    }

    const result = await runAutomationEvent({
      eventType,
      leadId:body.lead_id || null,
      actorId:user.id,
      ownerId:body.owner_id || null,
      payload:body.payload || body
    });

    return Response.json(result, { status:200, headers:{ "Cache-Control":"no-store" } });
  } catch (error) {
    return Response.json({ ok:false, error:error?.message || "AUTOMATION_EVENT_FAILED" }, { status:500 });
  }
}
