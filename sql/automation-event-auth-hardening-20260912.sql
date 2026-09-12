-- PTM CRM · Automation event authorization hardening · 2026-09-12
-- Enforces event whitelist, lead scope and server-derived notification target.

CREATE OR REPLACE FUNCTION public.crm_automation_event_v1(
  p_token text,
  p_event_type text,
  p_lead_id uuid DEFAULT NULL,
  p_owner_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_role text;
  v_effective_lead uuid:=p_lead_id;
  v_lead_owner uuid;
  v_target_owner uuid:=NULL;
  v_ticket_id uuid;
  v_ticket_lead uuid;
BEGIN
  SELECT u.id,u.role INTO v_uid,v_role
  FROM public.crm_sessions s
  JOIN public.users u ON u.id=s.user_id
  WHERE s.token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex')
    AND s.expires_at>now()
    AND u.active=true
  LIMIT 1;

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','Phiên đăng nhập đã hết hạn','code','UNAUTHENTICATED');
  END IF;

  IF p_event_type NOT IN (
    'lead_created','lead_assigned','lead_accepted','lead_status_changed','followup_due',
    'opportunity_stage_changed','ticket_created','deal_completed'
  ) THEN
    RETURN jsonb_build_object('ok',false,'error','Automation event không hợp lệ','code','BAD_EVENT');
  END IF;

  IF p_event_type='ticket_created' AND nullif(p_payload->>'ticket_id','') IS NOT NULL THEN
    v_ticket_id:=(p_payload->>'ticket_id')::uuid;
    SELECT t.lead_id,t.assigned_to
    INTO v_ticket_lead,v_target_owner
    FROM public.crm_tickets t
    WHERE t.id=v_ticket_id
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok',false,'error','Ticket không tồn tại','code','NOT_FOUND');
    END IF;

    IF p_lead_id IS NOT NULL AND v_ticket_lead IS DISTINCT FROM p_lead_id THEN
      RETURN jsonb_build_object('ok',false,'error','Ticket không thuộc lead đã gửi','code','BAD_REQUEST');
    END IF;
    v_effective_lead:=v_ticket_lead;
  END IF;

  IF v_effective_lead IS NOT NULL THEN
    SELECT l.owner_id INTO v_lead_owner
    FROM public.leads l
    WHERE l.id=v_effective_lead
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok',false,'error','Không tìm thấy khách hàng','code','NOT_FOUND');
    END IF;
  END IF;

  IF v_role='sale' THEN
    IF v_effective_lead IS NULL OR v_lead_owner IS DISTINCT FROM v_uid THEN
      RETURN jsonb_build_object('ok',false,'error','Bạn chỉ được chạy automation cho khách hàng của mình','code','FORBIDDEN');
    END IF;
  ELSIF v_role='accounting' THEN
    IF p_event_type<>'deal_completed' THEN
      RETURN jsonb_build_object('ok',false,'error','Kế toán không có quyền phát automation event này','code','FORBIDDEN');
    END IF;
  ELSIF v_role NOT IN ('ceo','admin','manager','marketing') THEN
    RETURN jsonb_build_object('ok',false,'error','Bạn không có quyền phát automation event','code','FORBIDDEN');
  END IF;

  -- Never trust an arbitrary owner supplied by the browser.
  -- Ticket owner is resolved from the saved ticket; all other events use the lead owner/actor internally.
  RETURN public.crm_automation_event_internal(
    p_event_type,
    v_effective_lead,
    v_uid,
    v_target_owner,
    coalesce(p_payload,'{}'::jsonb)
  );
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('ok',false,'error','Dữ liệu automation không hợp lệ','code','BAD_REQUEST');
END
$function$;

REVOKE EXECUTE ON FUNCTION public.crm_automation_event_v1(text,text,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_automation_event_v1(text,text,uuid,uuid,jsonb) TO anonymous;

NOTIFY pgrst,'reload schema';
