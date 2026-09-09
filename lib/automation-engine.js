import { query } from "@/lib/db";
import { sendEmailMessage, sendZaloBridgeMessage } from "@/lib/integration-channels";

const VALID_LEAD_STATUS = new Set(["new","contact","hot","visit","deal","lost"]);

const EVENT_COPY = {
  lead_created:{ title:"Khách hàng mới", body:"CRM vừa tiếp nhận một khách hàng mới." },
  lead_assigned:{ title:"Lead mới được giao", body:"Bạn vừa được giao một khách hàng mới. Hãy xử lý ngay." },
  lead_accepted:{ title:"Sale đã nhận khách", body:"Lead đã được Sale xác nhận nhận và bắt đầu chăm sóc." },
  lead_status_changed:{ title:"Tình trạng khách thay đổi", body:"Khách hàng vừa được cập nhật trạng thái bán hàng." },
  followup_due:{ title:"Đến hạn chăm sóc", body:"Khách hàng đã tới lịch chăm sóc. Cần liên hệ và cập nhật bước tiếp theo." },
  opportunity_stage_changed:{ title:"Cơ hội đổi giai đoạn", body:"Một cơ hội bán hàng vừa chuyển sang giai đoạn mới." },
  ticket_created:{ title:"Ticket CSKH mới", body:"Có yêu cầu chăm sóc khách hàng mới cần xử lý." },
  deal_completed:{ title:"Giao dịch hoàn tất", body:"Giao dịch đã hoàn tất. Cần tiếp tục bước hợp đồng, tài chính và hậu mãi." }
};

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function dueAt(delayMinutes = 0) {
  const minutes = Math.max(0, Number(delayMinutes || 0));
  return new Date(Date.now() + minutes * 60000).toISOString();
}

function conditionsMatch(conditions, lead, payload) {
  const c = asObject(conditions);
  if (!Object.keys(c).length) return true;
  if (c.source && String(lead?.source || "").toLowerCase() !== String(c.source).toLowerCase()) return false;
  if (c.status && String(lead?.status || "") !== String(c.status)) return false;
  if (c.project && !String(lead?.project || "").toLowerCase().includes(String(c.project).toLowerCase())) return false;
  if (c.owner_id && String(lead?.owner_id || "") !== String(c.owner_id)) return false;
  if (c.stage && String(payload?.stage || "") !== String(c.stage)) return false;
  if (c.min_score != null && Number(lead?.score || 0) < Number(c.min_score)) return false;
  if (c.max_budget != null && Number(lead?.budget || 0) > Number(c.max_budget)) return false;
  return true;
}

async function loadLead(leadId) {
  if (!leadId) return null;
  const rows = await query(
    `SELECT l.id,l.name,l.phone,l.email,l.source,l.need,l.budget,l.status,l.project,l.owner_id,l.score,l.next_follow_up_at,l.profile,
            u.name owner_name,u.email owner_email
       FROM public.leads l
       LEFT JOIN public.users u ON u.id=l.owner_id
      WHERE l.id=$1::uuid
      LIMIT 1`,
    [leadId]
  );
  return rows?.[0] || null;
}

async function loadUser(userId) {
  if (!userId) return null;
  const rows = await query(`SELECT id,name,email,role FROM public.users WHERE id=$1::uuid AND active=true LIMIT 1`, [userId]);
  return rows?.[0] || null;
}

async function createTask({ rule, action, lead, recipientId, eventType }) {
  if (!recipientId) return { type:"create_task", ok:false, skipped:true, reason:"NO_RECIPIENT" };
  const base = EVENT_COPY[eventType] || { title:"Công việc CRM", body:"Có công việc cần xử lý." };
  const title = String(action.title || `${base.title}${lead?.name ? ` · ${lead.name}` : ""}`).slice(0,240);
  const duplicate = await query(
    `SELECT id FROM public.tasks
      WHERE owner_id=$1::uuid
        AND lead_id IS NOT DISTINCT FROM $2::uuid
        AND title=$3
        AND created_at > now() - interval '12 hours'
      LIMIT 1`,
    [recipientId, lead?.id || null, title]
  );
  if (duplicate?.length) return { type:"create_task", ok:true, skipped:true, reason:"DEDUPED" };

  const rows = await query(
    `INSERT INTO public.tasks(title,task_type,due_at,owner_id,lead_id,done,priority)
     VALUES($1,$2,$3::timestamptz,$4::uuid,$5::uuid,false,$6)
     RETURNING id`,
    [title, action.task_type || "followup", dueAt(action.delay_minutes), recipientId, lead?.id || null, ["low","normal","high"].includes(action.priority) ? action.priority : "high"]
  );
  return { type:"create_task", ok:true, id:rows?.[0]?.id || null };
}

async function createNotification({ rule, action, lead, recipientId, eventType, payload }) {
  if (!recipientId) return { type:"notify_user", ok:false, skipped:true, reason:"NO_RECIPIENT" };
  const base = EVENT_COPY[eventType] || { title:"Thông báo CRM", body:"Có cập nhật mới trong CRM." };
  const title = String(action.title || base.title).slice(0,180);
  const detail = payload?.stage ? ` Giai đoạn: ${payload.stage}.` : payload?.status ? ` Trạng thái: ${payload.status}.` : "";
  const body = String(action.body || `${lead?.name ? `${lead.name}: ` : ""}${base.body}${detail}`).slice(0,1000);
  const duplicate = await query(
    `SELECT id FROM public.crm_notifications
      WHERE user_id=$1::uuid
        AND entity_type='lead'
        AND entity_id IS NOT DISTINCT FROM $2::uuid
        AND title=$3
        AND created_at > now() - interval '12 hours'
      LIMIT 1`,
    [recipientId, lead?.id || null, title]
  );
  if (duplicate?.length) return { type:"notify_user", ok:true, skipped:true, reason:"DEDUPED" };

  const rows = await query(
    `INSERT INTO public.crm_notifications(user_id,notification_type,title,body,entity_type,entity_id)
     VALUES($1::uuid,$2,$3,$4,'lead',$5::uuid)
     RETURNING id`,
    [recipientId, action.notification_type || "info", title, body, lead?.id || null]
  );
  return { type:"notify_user", ok:true, id:rows?.[0]?.id || null };
}

async function updateLeadStatus({ action, lead }) {
  const status = String(action.status || action.value || "");
  if (!lead?.id || !VALID_LEAD_STATUS.has(status)) return { type:"update_lead_status", ok:false, skipped:true, reason:"STATUS_NOT_CONFIGURED" };
  await query(`UPDATE public.leads SET status=$2,updated_at=now() WHERE id=$1::uuid`, [lead.id, status]);
  return { type:"update_lead_status", ok:true, status };
}

async function addTag({ action, lead, actorId }) {
  if (!lead?.id) return { type:"add_tag", ok:false, skipped:true, reason:"NO_LEAD" };
  let tagId = action.tag_id || "";
  if (!tagId && action.tag_name) {
    const existing = await query(`SELECT id FROM public.crm_tags WHERE lower(name)=lower($1) LIMIT 1`, [String(action.tag_name)]);
    tagId = existing?.[0]?.id || "";
    if (!tagId) {
      const created = await query(
        `INSERT INTO public.crm_tags(name,color,created_by) VALUES($1,$2,$3::uuid) RETURNING id`,
        [String(action.tag_name).slice(0,120), action.color || "#0f766e", actorId || null]
      );
      tagId = created?.[0]?.id || "";
    }
  }
  if (!tagId) return { type:"add_tag", ok:false, skipped:true, reason:"TAG_NOT_CONFIGURED" };
  await query(`INSERT INTO public.crm_lead_tags(lead_id,tag_id) VALUES($1::uuid,$2::uuid) ON CONFLICT DO NOTHING`, [lead.id, tagId]);
  return { type:"add_tag", ok:true, tag_id:tagId };
}

async function sendEmail({ action, lead, recipient }) {
  const target = action.recipient === "lead" ? lead?.email : (recipient?.email || lead?.owner_email);
  const subject = action.subject || `${EVENT_COPY[action.event_type]?.title || "PTM CRM"}${lead?.name ? ` · ${lead.name}` : ""}`;
  const text = action.text || action.body || `${lead?.name || "Khách hàng"} có cập nhật mới trên PTM CRM.`;
  const result = await sendEmailMessage({ to:target, subject, text });
  return { type:"send_email", ...result };
}

async function sendZalo({ action, lead }) {
  const result = await sendZaloBridgeMessage({
    phone:action.phone || lead?.phone,
    template:action.template,
    text:action.text || action.body || `${lead?.name || "Khách hàng"} có cập nhật mới trên PTM CRM.`,
    data:{ lead_id:lead?.id || null, name:lead?.name || "", project:lead?.project || "" }
  });
  return { type:"send_zalo", ...result };
}

export async function runAutomationEvent({ eventType, leadId = null, actorId = null, ownerId = null, payload = {} }) {
  const rules = await query(
    `SELECT id,name,event_type,conditions,actions,enabled
       FROM public.crm_automation_rules
      WHERE enabled=true AND event_type=$1
      ORDER BY created_at ASC`,
    [eventType]
  );
  const lead = await loadLead(leadId);
  const effectiveOwner = ownerId || lead?.owner_id || actorId || null;
  const recipient = await loadUser(effectiveOwner);
  const outcomes = [];

  for (const rule of rules || []) {
    if (!conditionsMatch(rule.conditions, lead, payload)) continue;
    for (const rawAction of asArray(rule.actions)) {
      const action = { ...asObject(rawAction), event_type:eventType };
      try {
        if (action.type === "create_task") outcomes.push(await createTask({ rule,action,lead,recipientId:effectiveOwner,eventType }));
        else if (action.type === "notify_user") outcomes.push(await createNotification({ rule,action,lead,recipientId:effectiveOwner,eventType,payload }));
        else if (action.type === "update_lead_status") outcomes.push(await updateLeadStatus({ action,lead }));
        else if (action.type === "add_tag") outcomes.push(await addTag({ action,lead,actorId }));
        else if (action.type === "send_email") outcomes.push(await sendEmail({ action,lead,recipient }));
        else if (action.type === "send_zalo") outcomes.push(await sendZalo({ action,lead }));
        else outcomes.push({ type:action.type || "unknown", ok:false, skipped:true, reason:"UNSUPPORTED_ACTION" });
      } catch (error) {
        outcomes.push({ type:action.type || "unknown", ok:false, error:error?.message || "Automation action failed" });
      }
    }
  }

  return {
    ok:true,
    event_type:eventType,
    rules_matched:(rules || []).length,
    actions_run:outcomes.filter((x) => !x.skipped).length,
    outcomes
  };
}
