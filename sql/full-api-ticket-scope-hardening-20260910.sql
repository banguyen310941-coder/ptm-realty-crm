-- Close the gap between ticket visibility and ticket update permissions.
-- Marketing may only update tickets it created or is assigned to; any explicit assignee must be active.

CREATE OR REPLACE FUNCTION public.crm_full_api(p_token text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid;
  v_role text;
  v_lead uuid;
  v_id uuid;
  v_assigned uuid;
BEGIN
  SELECT u.id,u.role INTO v_uid,v_role
  FROM public.crm_sessions s JOIN public.users u ON u.id=s.user_id
  WHERE s.token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex')
    AND s.expires_at>now() AND u.active=true LIMIT 1;
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  END IF;

  IF v_role='sale' AND p_action='opportunity.save' THEN
    v_id := nullif(p_payload->>'id','')::uuid;
    v_lead := nullif(p_payload->>'lead_id','')::uuid;
    IF v_id IS NULL THEN
      IF v_lead IS NULL OR NOT EXISTS(SELECT 1 FROM public.leads WHERE id=v_lead AND owner_id=v_uid) THEN
        RETURN jsonb_build_object('ok',false,'error','Sale chỉ được tạo cơ hội cho khách hàng đang được giao cho mình.');
      END IF;
    ELSE
      IF NOT EXISTS(SELECT 1 FROM public.crm_opportunities WHERE id=v_id AND owner_id=v_uid) THEN
        RETURN jsonb_build_object('ok',false,'error','Sale chỉ được sửa cơ hội của mình.');
      END IF;
      IF p_payload ? 'lead_id' AND (v_lead IS NULL OR NOT EXISTS(SELECT 1 FROM public.leads WHERE id=v_lead AND owner_id=v_uid)) THEN
        RETURN jsonb_build_object('ok',false,'error','Sale chỉ được gắn cơ hội với khách hàng đang được giao cho mình.');
      END IF;
    END IF;
  END IF;

  IF p_action='ticket.save' THEN
    v_id := nullif(p_payload->>'id','')::uuid;
    v_assigned := nullif(p_payload->>'assigned_to','')::uuid;

    IF v_assigned IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM public.users u WHERE u.id=v_assigned AND u.active=true
    ) THEN
      RETURN jsonb_build_object('ok',false,'error','Người phụ trách ticket không tồn tại hoặc đã bị khóa.');
    END IF;

    IF v_role='sale' AND v_id IS NULL AND nullif(p_payload->>'lead_id','') IS NOT NULL THEN
      v_lead := nullif(p_payload->>'lead_id','')::uuid;
      IF NOT EXISTS(SELECT 1 FROM public.leads WHERE id=v_lead AND owner_id=v_uid) THEN
        RETURN jsonb_build_object('ok',false,'error','Sale chỉ được tạo ticket cho khách hàng đang được giao cho mình.');
      END IF;
    END IF;

    IF v_role='marketing' AND v_id IS NOT NULL AND NOT EXISTS(
      SELECT 1
      FROM public.crm_tickets t
      WHERE t.id=v_id AND (t.assigned_to=v_uid OR t.created_by=v_uid)
    ) THEN
      RETURN jsonb_build_object('ok',false,'error','Marketing chỉ được sửa ticket do mình tạo hoặc đang được giao.');
    END IF;
  END IF;

  RETURN public.crm_full_api_internal(p_token,p_action,p_payload);
END
$$;
