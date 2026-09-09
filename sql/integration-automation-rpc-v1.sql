-- PTM CRM integration + automation RPC v1
-- Core production architecture: Vercel routes call Neon Data API RPCs.
-- No raw PostgreSQL connection string is required by the application runtime.
--
-- Secret values are NEVER stored in this file. Provision a secret by storing
-- only SHA-256(secret) in crm_integration_config.value_hash.

CREATE TABLE IF NOT EXISTS public.crm_integration_config (
  key text PRIMARY KEY,
  value_hash text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.crm_integration_secret_ok(p_key text, p_secret text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS(
    SELECT 1
    FROM public.crm_integration_config c
    WHERE c.key=p_key
      AND c.enabled=true
      AND c.value_hash=encode(digest(coalesce(p_secret,''),'sha256'),'hex')
  );
$function$;

CREATE OR REPLACE FUNCTION public.crm_webhook_verify_v1(p_secret text, p_kind text DEFAULT 'lead'::text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.crm_integration_secret_ok(
    CASE WHEN p_kind='meta' THEN 'meta_verify' ELSE 'lead_webhook' END,
    p_secret
  );
$function$;

CREATE OR REPLACE FUNCTION public.crm_integration_status_v1()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'ok',true,
    'database',true,
    'lead_webhook',EXISTS(SELECT 1 FROM public.crm_integration_config WHERE key='lead_webhook' AND enabled=true),
    'email',EXISTS(SELECT 1 FROM public.crm_integration_config WHERE key='email' AND enabled=true),
    'zalo',EXISTS(SELECT 1 FROM public.crm_integration_config WHERE key='zalo' AND enabled=true),
    'facebook_verify',EXISTS(SELECT 1 FROM public.crm_integration_config WHERE key='meta_verify' AND enabled=true),
    'providers',jsonb_build_object(
      'website',true,'facebook',true,'tiktok',true,'zalo',true,'google',true,'hotline',true
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.crm_automation_event_internal(
  p_event_type text,
  p_lead_id uuid DEFAULT NULL::uuid,
  p_actor_id uuid DEFAULT NULL::uuid,
  p_owner_id uuid DEFAULT NULL::uuid,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lead record;
  v_rule record;
  v_action jsonb;
  v_owner uuid;
  v_title text;
  v_body text;
  v_type text;
  v_tag_id uuid;
  v_rules integer:=0;
  v_actions integer:=0;
  v_delay integer;
  v_priority text;
BEGIN
  SELECT l.id,l.name,l.phone,l.email,l.source,l.need,l.budget,l.status,l.project,l.owner_id,l.score,l.next_follow_up_at,l.profile,
         u.name owner_name,u.email owner_email
  INTO v_lead
  FROM public.leads l
  LEFT JOIN public.users u ON u.id=l.owner_id
  WHERE l.id=p_lead_id
  LIMIT 1;

  v_owner:=coalesce(p_owner_id,v_lead.owner_id,p_actor_id);

  FOR v_rule IN
    SELECT id,name,event_type,conditions,actions
    FROM public.crm_automation_rules
    WHERE enabled=true AND event_type=p_event_type
    ORDER BY created_at
  LOOP
    IF coalesce(v_rule.conditions,'{}'::jsonb) ? 'source'
       AND lower(coalesce(v_lead.source,''))<>lower(v_rule.conditions->>'source') THEN CONTINUE; END IF;
    IF coalesce(v_rule.conditions,'{}'::jsonb) ? 'status'
       AND coalesce(v_lead.status,'')<>coalesce(v_rule.conditions->>'status','') THEN CONTINUE; END IF;
    IF coalesce(v_rule.conditions,'{}'::jsonb) ? 'project'
       AND position(lower(v_rule.conditions->>'project') in lower(coalesce(v_lead.project,'')))=0 THEN CONTINUE; END IF;
    IF coalesce(v_rule.conditions,'{}'::jsonb) ? 'owner_id'
       AND coalesce(v_lead.owner_id::text,'')<>coalesce(v_rule.conditions->>'owner_id','') THEN CONTINUE; END IF;
    IF coalesce(v_rule.conditions,'{}'::jsonb) ? 'stage'
       AND coalesce(p_payload->>'stage','')<>coalesce(v_rule.conditions->>'stage','') THEN CONTINUE; END IF;
    IF coalesce(v_rule.conditions,'{}'::jsonb) ? 'min_score'
       AND coalesce(v_lead.score,0)<coalesce((v_rule.conditions->>'min_score')::integer,0) THEN CONTINUE; END IF;
    IF coalesce(v_rule.conditions,'{}'::jsonb) ? 'max_budget'
       AND coalesce(v_lead.budget,0)>coalesce((v_rule.conditions->>'max_budget')::numeric,0) THEN CONTINUE; END IF;

    v_rules:=v_rules+1;

    FOR v_action IN SELECT value FROM jsonb_array_elements(coalesce(v_rule.actions,'[]'::jsonb))
    LOOP
      v_type:=coalesce(v_action->>'type','');
      v_delay:=greatest(0,coalesce((v_action->>'delay_minutes')::integer,0));

      IF v_type='create_task' AND v_owner IS NOT NULL THEN
        v_title:=left(coalesce(nullif(v_action->>'title',''),
          CASE p_event_type
            WHEN 'lead_created' THEN 'Khách hàng mới'
            WHEN 'lead_assigned' THEN 'Liên hệ lead mới'
            WHEN 'lead_accepted' THEN 'Chăm sóc khách vừa nhận'
            WHEN 'lead_status_changed' THEN 'Theo dõi khách đổi trạng thái'
            WHEN 'followup_due' THEN 'Chăm sóc khách đến hạn'
            WHEN 'opportunity_stage_changed' THEN 'Xử lý bước tiếp theo của cơ hội'
            WHEN 'ticket_created' THEN 'Xử lý ticket CSKH mới'
            WHEN 'deal_completed' THEN 'Xử lý hậu mãi giao dịch hoàn tất'
            ELSE 'Công việc CRM'
          END || CASE WHEN v_lead.name IS NOT NULL THEN ' · '||v_lead.name ELSE '' END
        ),240);
        v_priority:=CASE WHEN v_action->>'priority' IN ('low','normal','high') THEN v_action->>'priority' ELSE 'high' END;

        IF NOT EXISTS(
          SELECT 1 FROM public.tasks t
          WHERE t.owner_id=v_owner
            AND t.lead_id IS NOT DISTINCT FROM p_lead_id
            AND t.title=v_title
            AND t.created_at>now()-interval '12 hours'
        ) THEN
          INSERT INTO public.tasks(title,task_type,due_at,owner_id,lead_id,done,priority)
          VALUES(v_title,coalesce(nullif(v_action->>'task_type',''),'followup'),now()+make_interval(mins=>v_delay),v_owner,p_lead_id,false,v_priority);
          v_actions:=v_actions+1;
        END IF;

      ELSIF v_type='notify_user' AND v_owner IS NOT NULL THEN
        v_title:=left(coalesce(nullif(v_action->>'title',''),
          CASE p_event_type
            WHEN 'lead_created' THEN 'Khách hàng mới'
            WHEN 'lead_assigned' THEN 'Lead mới được giao'
            WHEN 'lead_accepted' THEN 'Sale đã nhận khách'
            WHEN 'lead_status_changed' THEN 'Tình trạng khách thay đổi'
            WHEN 'followup_due' THEN 'Đến hạn chăm sóc'
            WHEN 'opportunity_stage_changed' THEN 'Cơ hội đổi giai đoạn'
            WHEN 'ticket_created' THEN 'Ticket CSKH mới'
            WHEN 'deal_completed' THEN 'Giao dịch hoàn tất'
            ELSE 'Thông báo CRM'
          END
        ),180);
        v_body:=left(coalesce(nullif(v_action->>'body',''),
          CASE WHEN v_lead.name IS NOT NULL THEN v_lead.name||': ' ELSE '' END ||
          CASE p_event_type
            WHEN 'lead_created' THEN 'CRM vừa tiếp nhận một khách hàng mới.'
            WHEN 'lead_assigned' THEN 'Bạn vừa được giao một khách hàng mới. Hãy xử lý ngay.'
            WHEN 'lead_accepted' THEN 'Lead đã được Sale xác nhận nhận và bắt đầu chăm sóc.'
            WHEN 'lead_status_changed' THEN 'Khách hàng vừa được cập nhật trạng thái bán hàng.'
            WHEN 'followup_due' THEN 'Khách hàng đã tới lịch chăm sóc. Cần liên hệ và cập nhật bước tiếp theo.'
            WHEN 'opportunity_stage_changed' THEN 'Một cơ hội bán hàng vừa chuyển sang giai đoạn mới.'
            WHEN 'ticket_created' THEN 'Có yêu cầu chăm sóc khách hàng mới cần xử lý.'
            WHEN 'deal_completed' THEN 'Giao dịch đã hoàn tất. Cần tiếp tục bước hợp đồng, tài chính và hậu mãi.'
            ELSE 'Có cập nhật mới trong CRM.'
          END ||
          CASE WHEN coalesce(p_payload->>'stage','')<>'' THEN ' Giai đoạn: '||p_payload->>'stage'||'.'
               WHEN coalesce(p_payload->>'status','')<>'' THEN ' Trạng thái: '||p_payload->>'status'||'.'
               ELSE '' END
        ),1000);

        IF NOT EXISTS(
          SELECT 1 FROM public.crm_notifications n
          WHERE n.user_id=v_owner
            AND n.entity_type='lead'
            AND n.entity_id IS NOT DISTINCT FROM p_lead_id
            AND n.title=v_title
            AND n.created_at>now()-interval '12 hours'
        ) THEN
          INSERT INTO public.crm_notifications(user_id,notification_type,title,body,entity_type,entity_id)
          VALUES(v_owner,coalesce(nullif(v_action->>'notification_type',''),'info'),v_title,v_body,'lead',p_lead_id);
          v_actions:=v_actions+1;
        END IF;

      ELSIF v_type='update_lead_status' AND p_lead_id IS NOT NULL
            AND coalesce(v_action->>'status',v_action->>'value') IN ('new','contact','hot','visit','deal','lost') THEN
        UPDATE public.leads
        SET status=coalesce(v_action->>'status',v_action->>'value'),updated_at=now()
        WHERE id=p_lead_id;
        v_actions:=v_actions+1;

      ELSIF v_type='add_tag' AND p_lead_id IS NOT NULL THEN
        v_tag_id:=nullif(v_action->>'tag_id','')::uuid;
        IF v_tag_id IS NULL AND coalesce(v_action->>'tag_name','')<>'' THEN
          SELECT id INTO v_tag_id FROM public.crm_tags WHERE lower(name)=lower(v_action->>'tag_name') LIMIT 1;
          IF v_tag_id IS NULL THEN
            INSERT INTO public.crm_tags(name,color,created_by)
            VALUES(left(v_action->>'tag_name',120),coalesce(nullif(v_action->>'color',''),'#0f766e'),p_actor_id)
            ON CONFLICT (name) DO UPDATE SET name=excluded.name
            RETURNING id INTO v_tag_id;
          END IF;
        END IF;
        IF v_tag_id IS NOT NULL THEN
          INSERT INTO public.crm_lead_tags(lead_id,tag_id)
          VALUES(p_lead_id,v_tag_id)
          ON CONFLICT DO NOTHING;
          v_actions:=v_actions+1;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('ok',true,'event_type',p_event_type,'rules_matched',v_rules,'actions_run',v_actions);
END
$function$;

CREATE OR REPLACE FUNCTION public.crm_automation_event_v1(
  p_token text,
  p_event_type text,
  p_lead_id uuid DEFAULT NULL::uuid,
  p_owner_id uuid DEFAULT NULL::uuid,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid uuid;
BEGIN
  SELECT u.id INTO v_uid
  FROM public.crm_sessions s
  JOIN public.users u ON u.id=s.user_id
  WHERE s.token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex')
    AND s.expires_at>now()
    AND u.active=true
  LIMIT 1;

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','Phiên đăng nhập đã hết hạn','code','UNAUTHENTICATED');
  END IF;

  RETURN public.crm_automation_event_internal(
    p_event_type,p_lead_id,v_uid,p_owner_id,coalesce(p_payload,'{}'::jsonb)
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.crm_automation_sweep_v1(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_row record;
  v_count integer:=0;
  v_actions integer:=0;
  v_result jsonb;
  v_routing jsonb;
BEGIN
  SELECT u.id INTO v_uid
  FROM public.crm_sessions s
  JOIN public.users u ON u.id=s.user_id
  WHERE s.token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex')
    AND s.expires_at>now()
    AND u.active=true
  LIMIT 1;

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','Phiên đăng nhập đã hết hạn','code','UNAUTHENTICATED');
  END IF;

  BEGIN
    v_routing:=public.crm_process_expired_offers(now());
  EXCEPTION WHEN OTHERS THEN
    v_routing:=NULL;
  END;

  FOR v_row IN
    SELECT id,owner_id
    FROM public.leads
    WHERE next_follow_up_at IS NOT NULL
      AND next_follow_up_at<=now()
      AND status<>'lost'
    ORDER BY next_follow_up_at
    LIMIT 200
  LOOP
    v_result:=public.crm_automation_event_internal('followup_due',v_row.id,v_uid,v_row.owner_id,'{}'::jsonb);
    v_count:=v_count+1;
    v_actions:=v_actions+coalesce((v_result->>'actions_run')::integer,0);
  END LOOP;

  RETURN jsonb_build_object(
    'ok',true,'due_leads',v_count,'actions_run',v_actions,'lead_routing',v_routing
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.crm_lead_intake_v1(p_secret text, p_lead jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
  v_owner uuid;
  v_offer uuid;
  v_duplicate boolean:=false;
  v_phone text;
  v_phone_key text;
  v_email text;
  v_name text;
  v_source text;
  v_need text;
  v_project text;
  v_notes text;
  v_budget numeric;
  v_profile jsonb;
BEGIN
  IF NOT public.crm_integration_secret_ok('lead_webhook',p_secret) THEN
    RETURN jsonb_build_object('ok',false,'error','INVALID_WEBHOOK_SECRET');
  END IF;

  v_phone:=trim(coalesce(p_lead->>'phone',''));
  v_phone_key:=regexp_replace(v_phone,'\D','','g');
  IF v_phone_key ~ '^84[0-9]{9}$' THEN v_phone_key:='0'||substr(v_phone_key,3); END IF;
  IF v_phone_key='' THEN RETURN jsonb_build_object('ok',false,'error','PHONE_REQUIRED'); END IF;

  v_email:=trim(coalesce(p_lead->>'email',''));
  v_name:=trim(coalesce(p_lead->>'name',''));
  v_source:=coalesce(nullif(trim(p_lead->>'source'),''),'Khác');
  v_need:=trim(coalesce(p_lead->>'need',''));
  v_project:=coalesce(nullif(trim(p_lead->>'project'),''),'Thiên Phúc Vĩnh Hằng Viên');
  v_notes:=trim(coalesce(p_lead->>'notes',''));
  v_budget:=coalesce(nullif(p_lead->>'budget','')::numeric,0);
  v_profile:=coalesce(p_lead->'profile','{}'::jsonb);

  SELECT id,owner_id,current_offer_id
  INTO v_id,v_owner,v_offer
  FROM public.leads
  WHERE (CASE WHEN regexp_replace(phone,'\D','','g') ~ '^84[0-9]{9}$'
              THEN '0'||substr(regexp_replace(phone,'\D','','g'),3)
              ELSE regexp_replace(phone,'\D','','g') END)=v_phone_key
     OR (v_email<>'' AND lower(trim(coalesce(email,'')))=lower(v_email))
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    v_duplicate:=true;
    UPDATE public.leads
    SET email=coalesce(email,nullif(v_email,'')),
        source=CASE WHEN source='Khác' THEN v_source ELSE source END,
        need=coalesce(need,nullif(v_need,'')),
        budget=CASE WHEN budget=0 THEN v_budget ELSE budget END,
        project=coalesce(project,nullif(v_project,'')),
        notes=coalesce(notes,nullif(v_notes,'')),
        profile=coalesce(profile,'{}'::jsonb)||v_profile,
        updated_at=now()
    WHERE id=v_id
    RETURNING owner_id,current_offer_id INTO v_owner,v_offer;
  ELSE
    INSERT INTO public.leads(name,phone,email,source,need,budget,status,project,owner_id,notes,profile)
    VALUES(
      coalesce(nullif(v_name,''),'Khách '||right(v_phone_key,4)),
      v_phone,nullif(v_email,''),v_source,nullif(v_need,''),v_budget,'new',nullif(v_project,''),NULL,nullif(v_notes,''),v_profile
    )
    RETURNING id INTO v_id;

    SELECT owner_id,current_offer_id INTO v_owner,v_offer FROM public.leads WHERE id=v_id;
    PERFORM public.crm_automation_event_internal('lead_created',v_id,NULL,v_owner,jsonb_build_object('source',v_source));
    IF v_owner IS NOT NULL THEN
      PERFORM public.crm_automation_event_internal('lead_assigned',v_id,NULL,v_owner,jsonb_build_object('source',v_source));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok',true,'lead_id',v_id,'duplicate',v_duplicate,'source',v_source,
    'assigned',v_owner IS NOT NULL,'offer_pending',v_offer IS NOT NULL
  );
END
$function$;

-- Secret provisioning examples (run manually; never commit the real secret):
-- INSERT INTO public.crm_integration_config(key,value_hash,enabled)
-- VALUES('lead_webhook', encode(digest('<REAL_SECRET>','sha256'),'hex'), true)
-- ON CONFLICT (key) DO UPDATE SET value_hash=excluded.value_hash, enabled=true, updated_at=now();
--
-- INSERT INTO public.crm_integration_config(key,value_hash,enabled)
-- VALUES('meta_verify', encode(digest('<REAL_VERIFY_TOKEN>','sha256'),'hex'), true)
-- ON CONFLICT (key) DO UPDATE SET value_hash=excluded.value_hash, enabled=true, updated_at=now();

NOTIFY pgrst, 'reload schema';
