import { bearerToken, safeSecretEqual, sessionUserFromToken } from "@/lib/server-auth";
import { runAutomationEvent } from "@/lib/automation-engine";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

async function authorize(request) {
  const token = bearerToken(request);
  const user = await sessionUserFromToken(token).catch(() => null);
  if (user) return { user, mode:"session" };
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && safeSecretEqual(token, cronSecret)) return { user:null, mode:"cron" };
  return null;
}

export async function POST(request) {
  try {
    const auth = await authorize(request);
    if (!auth) return Response.json({ ok:false, error:"UNAUTHENTICATED" }, { status:401 });

    let routing = null;
    try {
      const rows = await query(`SELECT public.crm_process_expired_offers(now()) AS result`);
      routing = rows?.[0]?.result || null;
    } catch {}

    const dueLeads = await query(
      `SELECT id,owner_id,next_follow_up_at
         FROM public.leads
        WHERE next_follow_up_at IS NOT NULL
          AND next_follow_up_at <= now()
          AND status <> 'lost'
        ORDER BY next_follow_up_at ASC
        LIMIT 100`
    );

    let actionsRun = 0;
    const results = [];
    for (const lead of dueLeads || []) {
      const result = await runAutomationEvent({
        eventType:"followup_due",
        leadId:lead.id,
        actorId:auth.user?.id || null,
        ownerId:lead.owner_id || null,
        payload:{ next_follow_up_at:lead.next_follow_up_at }
      });
      actionsRun += Number(result.actions_run || 0);
      if (result.rules_matched) results.push({ lead_id:lead.id, ...result });
    }

    return Response.json({
      ok:true,
      mode:auth.mode,
      due_leads:(dueLeads || []).length,
      actions_run:actionsRun,
      lead_routing:routing,
      results
    }, { status:200, headers:{ "Cache-Control":"no-store" } });
  } catch (error) {
    return Response.json({ ok:false, error:error?.message || "AUTOMATION_SWEEP_FAILED" }, { status:500 });
  }
}
