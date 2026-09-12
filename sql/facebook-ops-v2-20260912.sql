-- PTM CRM · Facebook operations v2
-- Per-page scenarios, business hours, retries, tags, quick replies and conversion reporting.

ALTER TABLE public.crm_facebook_reply_scenarios
  ADD COLUMN IF NOT EXISTS page_id text NULL,
  ADD COLUMN IF NOT EXISTS schedule_scope text NOT NULL DEFAULT 'always';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='crm_facebook_reply_scenarios_schedule_scope_check'
  ) THEN
    ALTER TABLE public.crm_facebook_reply_scenarios
      ADD CONSTRAINT crm_facebook_reply_scenarios_schedule_scope_check
      CHECK (schedule_scope IN ('always','business_hours','after_hours'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS crm_facebook_reply_scenarios_page_idx
  ON public.crm_facebook_reply_scenarios(page_id,enabled,priority);

ALTER TABLE public.crm_facebook_auto_reply_attempts
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retryable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS crm_facebook_auto_reply_attempts_retry_idx
  ON public.crm_facebook_auto_reply_attempts(status,retryable,next_retry_at)
  WHERE status='failed' AND retryable=true;

CREATE TABLE IF NOT EXISTS public.crm_facebook_page_settings (
  page_id text PRIMARY KEY,
  page_name text NULL,
  timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  business_days integer[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6],
  business_start time NOT NULL DEFAULT '08:00',
  business_end time NOT NULL DEFAULT '18:00',
  updated_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crm_facebook_quick_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  reply_text text NOT NULL,
  page_id text NULL,
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_facebook_quick_replies_page_idx
  ON public.crm_facebook_quick_replies(page_id,enabled,sort_order);

CREATE TABLE IF NOT EXISTS public.crm_facebook_conversation_tags (
  conversation_id uuid NOT NULL REFERENCES public.crm_facebook_conversations(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.crm_tags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(conversation_id,tag_id)
);

CREATE INDEX IF NOT EXISTS crm_facebook_conversation_tags_tag_idx
  ON public.crm_facebook_conversation_tags(tag_id,conversation_id);

CREATE OR REPLACE FUNCTION public.crm_facebook_auto_reply_claim_v3(
  p_secret text,
  p_conversation_id uuid,
  p_inbound_message_id text,
  p_text text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_scenario record;
  v_conv record;
  v_page record;
  v_text text:=lower(coalesce(p_text,''));
  v_keyword text;
  v_keyword_match boolean;
  v_attempt uuid;
  v_local timestamp;
  v_is_business boolean;
BEGIN
  IF NOT public.crm_integration_secret_ok('meta_app_secret',p_secret) THEN
    RETURN jsonb_build_object('ok',false,'error','INVALID_META_APP_SECRET');
  END IF;

  IF p_conversation_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','CONVERSATION_REQUIRED');
  END IF;

  IF nullif(trim(coalesce(p_inbound_message_id,'')),'') IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.crm_facebook_auto_reply_attempts
    WHERE inbound_message_id=p_inbound_message_id
  ) THEN
    RETURN jsonb_build_object('ok',true,'matched',false,'duplicate',true);
  END IF;

  SELECT c.*,l.phone lead_phone
  INTO v_conv
  FROM public.crm_facebook_conversations c
  LEFT JOIN public.leads l ON l.id=c.lead_id
  WHERE c.id=p_conversation_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'error','CONVERSATION_NOT_FOUND');
  END IF;

  IF v_conv.automation_paused_until IS NOT NULL AND v_conv.automation_paused_until>now() THEN
    RETURN jsonb_build_object('ok',true,'matched',false,'reason','HUMAN_TAKEOVER','paused_until',v_conv.automation_paused_until);
  END IF;

  IF v_conv.last_inbound_at IS NULL OR v_conv.last_inbound_at<now()-interval '24 hours' THEN
    RETURN jsonb_build_object('ok',true,'matched',false,'reason','OUTSIDE_24H_WINDOW');
  END IF;

  SELECT *
  INTO v_page
  FROM public.crm_facebook_page_settings
  WHERE page_id=v_conv.page_id;

  IF NOT FOUND THEN
    v_page.timezone:='Asia/Ho_Chi_Minh';
    v_page.business_days:=ARRAY[1,2,3,4,5,6];
    v_page.business_start:='08:00'::time;
    v_page.business_end:='18:00'::time;
  END IF;

  BEGIN
    v_local:=now() AT TIME ZONE v_page.timezone;
  EXCEPTION WHEN invalid_parameter_value THEN
    v_local:=now() AT TIME ZONE 'Asia/Ho_Chi_Minh';
  END;

  v_is_business :=
    extract(isodow FROM v_local)::integer=ANY(v_page.business_days)
    AND (
      (v_page.business_start<v_page.business_end
        AND v_local::time>=v_page.business_start
        AND v_local::time<v_page.business_end)
      OR
      (v_page.business_start>=v_page.business_end
        AND (v_local::time>=v_page.business_start OR v_local::time<v_page.business_end))
    );

  FOR v_scenario IN
    SELECT s.*
    FROM public.crm_facebook_reply_scenarios s
    WHERE s.enabled=true
      AND (s.page_id IS NULL OR s.page_id=v_conv.page_id)
      AND (
        s.schedule_scope='always'
        OR (s.schedule_scope='business_hours' AND v_is_business)
        OR (s.schedule_scope='after_hours' AND NOT v_is_business)
      )
    ORDER BY s.priority ASC,s.created_at ASC
  LOOP
    IF EXISTS(
      SELECT 1 FROM public.crm_facebook_auto_reply_events e
      WHERE e.conversation_id=p_conversation_id
        AND e.scenario_id=v_scenario.id
        AND e.sent_at>=now()-make_interval(mins=>v_scenario.cooldown_minutes)
    ) THEN CONTINUE; END IF;

    v_keyword_match:=false;
    IF v_scenario.trigger_type='keyword' THEN
      FOR v_keyword IN SELECT lower(trim(value)) FROM jsonb_array_elements_text(v_scenario.keywords)
      LOOP
        IF v_keyword<>'' AND position(v_keyword in v_text)>0 THEN
          v_keyword_match:=true; EXIT;
        END IF;
      END LOOP;
    END IF;

    IF v_scenario.trigger_type='always'
       OR (v_scenario.trigger_type='keyword' AND v_keyword_match)
       OR (v_scenario.trigger_type='no_phone' AND coalesce(v_conv.phone_detected,v_conv.lead_phone,'')='')
       OR (v_scenario.trigger_type='has_phone' AND coalesce(v_conv.phone_detected,v_conv.lead_phone,'')<>'')
       OR (v_scenario.trigger_type='first_message' AND (
         SELECT count(*) FROM public.crm_facebook_messages m
         WHERE m.conversation_id=p_conversation_id AND m.direction='inbound'
       )=1)
    THEN
      INSERT INTO public.crm_facebook_auto_reply_attempts(
        conversation_id,scenario_id,inbound_message_id,status,response_text,payload,last_attempt_at
      )
      VALUES(
        p_conversation_id,v_scenario.id,nullif(trim(coalesce(p_inbound_message_id,'')),''),
        'claimed',v_scenario.response_text,
        jsonb_build_object('scenario_name',v_scenario.name,'page_id',v_conv.page_id,'schedule_scope',v_scenario.schedule_scope),
        now()
      )
      ON CONFLICT DO NOTHING
      RETURNING id INTO v_attempt;

      IF v_attempt IS NULL THEN
        RETURN jsonb_build_object('ok',true,'matched',false,'duplicate',true);
      END IF;

      RETURN jsonb_build_object(
        'ok',true,'matched',true,'attempt_id',v_attempt,
        'scenario_id',v_scenario.id,'scenario_name',v_scenario.name,
        'reply_text',v_scenario.response_text,'conversation_id',p_conversation_id,
        'page_id',v_conv.page_id,'psid',v_conv.psid,'business_hours',v_is_business
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok',true,'matched',false,'business_hours',v_is_business);
END
$function$;

CREATE OR REPLACE FUNCTION public.crm_facebook_auto_reply_finish_v2(
  p_secret text,
  p_attempt_id uuid,
  p_success boolean,
  p_outbound_message_id text DEFAULT NULL,
  p_error text DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_attempt record;
  v_delay interval;
BEGIN
  IF NOT public.crm_integration_secret_ok('meta_app_secret',p_secret) THEN
    RETURN jsonb_build_object('ok',false,'error','INVALID_META_APP_SECRET');
  END IF;

  SELECT * INTO v_attempt
  FROM public.crm_facebook_auto_reply_attempts
  WHERE id=p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','ATTEMPT_NOT_FOUND'); END IF;
  IF v_attempt.status IN ('sent','failed') THEN
    RETURN jsonb_build_object('ok',true,'duplicate',true,'status',v_attempt.status);
  END IF;

  IF p_success THEN
    UPDATE public.crm_facebook_auto_reply_attempts
    SET status='sent',retryable=false,next_retry_at=NULL,
        outbound_message_id=nullif(trim(coalesce(p_outbound_message_id,'')),''),
        payload=coalesce(p_payload,'{}'::jsonb),completed_at=now(),last_attempt_at=now()
    WHERE id=p_attempt_id;

    INSERT INTO public.crm_facebook_auto_reply_events(
      conversation_id,scenario_id,inbound_message_id,outbound_message_id,response_text,payload,sent_at
    ) VALUES(
      v_attempt.conversation_id,v_attempt.scenario_id,v_attempt.inbound_message_id,
      nullif(trim(coalesce(p_outbound_message_id,'')),''),v_attempt.response_text,coalesce(p_payload,'{}'::jsonb),now()
    ) ON CONFLICT DO NOTHING;

    INSERT INTO public.crm_facebook_messages(
      conversation_id,meta_message_id,direction,message_type,text_content,payload,sent_by_user_id,created_at
    ) VALUES(
      v_attempt.conversation_id,nullif(trim(coalesce(p_outbound_message_id,'')),''),
      'outbound','text',nullif(left(v_attempt.response_text,5000),''),
      coalesce(p_payload,'{}'::jsonb),NULL,now()
    ) ON CONFLICT DO NOTHING;

    UPDATE public.crm_facebook_conversations
    SET last_message_text=nullif(left(v_attempt.response_text,2000),''),
        last_message_at=now(),last_outbound_at=now(),updated_at=now()
    WHERE id=v_attempt.conversation_id;

    RETURN jsonb_build_object('ok',true,'status','sent','attempt_id',p_attempt_id);
  END IF;

  v_delay:=CASE
    WHEN v_attempt.retry_count<=0 THEN interval '5 minutes'
    WHEN v_attempt.retry_count=1 THEN interval '15 minutes'
    ELSE interval '30 minutes'
  END;

  UPDATE public.crm_facebook_auto_reply_attempts
  SET status='failed',
      error_text=nullif(left(coalesce(p_error,'AUTO_REPLY_SEND_FAILED'),2000),''),
      payload=coalesce(p_payload,'{}'::jsonb),completed_at=now(),last_attempt_at=now(),
      retryable=(v_attempt.retry_count<3),
      next_retry_at=CASE WHEN v_attempt.retry_count<3 THEN now()+v_delay ELSE NULL END
  WHERE id=p_attempt_id;

  RETURN jsonb_build_object(
    'ok',true,'status','failed','attempt_id',p_attempt_id,
    'retryable',v_attempt.retry_count<3,
    'next_retry_at',CASE WHEN v_attempt.retry_count<3 THEN now()+v_delay ELSE NULL END
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.crm_facebook_retry_claim_v1(
  p_secret text,
  p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT public.crm_integration_secret_ok('meta_app_secret',p_secret) THEN
    RETURN jsonb_build_object('ok',false,'error','INVALID_META_APP_SECRET');
  END IF;

  WITH candidates AS (
    SELECT a.id
    FROM public.crm_facebook_auto_reply_attempts a
    JOIN public.crm_facebook_conversations c ON c.id=a.conversation_id
    WHERE a.status='failed'
      AND a.retryable=true
      AND coalesce(a.next_retry_at,now())<=now()
      AND a.retry_count<3
      AND c.last_inbound_at>=now()-interval '24 hours'
      AND NOT (c.automation_paused_until IS NOT NULL AND c.automation_paused_until>now())
    ORDER BY a.next_retry_at NULLS FIRST,a.last_attempt_at
    FOR UPDATE OF a SKIP LOCKED
    LIMIT greatest(1,least(coalesce(p_limit,10),25))
  ), claimed AS (
    UPDATE public.crm_facebook_auto_reply_attempts a
    SET status='claimed',retry_count=a.retry_count+1,next_retry_at=NULL,last_attempt_at=now()
    FROM candidates x
    WHERE a.id=x.id
    RETURNING a.*
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'attempt_id',a.id,'conversation_id',a.conversation_id,'scenario_id',a.scenario_id,
    'reply_text',a.response_text,'retry_count',a.retry_count,
    'page_id',c.page_id,'psid',c.psid
  )),'[]'::jsonb)
  INTO v_rows
  FROM claimed a
  JOIN public.crm_facebook_conversations c ON c.id=a.conversation_id;

  RETURN jsonb_build_object('ok',true,'items',v_rows);
END
$function$;

CREATE OR REPLACE FUNCTION public.crm_facebook_automation_api_v2(
  p_token text,
  p_action text DEFAULT 'bootstrap',
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid uuid; v_role text; v_id uuid; v_rows jsonb; v_row public.crm_facebook_reply_scenarios%ROWTYPE;
  v_keywords jsonb; v_stats jsonb; v_failures jsonb; v_pages jsonb;
BEGIN
  SELECT u.id,u.role INTO v_uid,v_role
  FROM public.crm_sessions s JOIN public.users u ON u.id=s.user_id
  WHERE s.token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex')
    AND s.expires_at>now() AND u.active=true LIMIT 1;
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'error','Phiên đăng nhập đã hết hạn','code','UNAUTHENTICATED'); END IF;
  IF v_role NOT IN ('ceo','admin','manager','marketing') THEN
    RETURN jsonb_build_object('ok',false,'error','Bạn không có quyền quản lý kịch bản Fanpage','code','FORBIDDEN');
  END IF;

  IF p_action='bootstrap' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.priority,x.created_at),'[]'::jsonb) INTO v_rows
    FROM (
      SELECT s.*,
        coalesce(st.sent_7d,0) sent_7d,coalesce(st.failed_7d,0) failed_7d
      FROM public.crm_facebook_reply_scenarios s
      LEFT JOIN LATERAL(
        SELECT count(*) FILTER(WHERE a.status='sent' AND a.last_attempt_at>=now()-interval '7 days') sent_7d,
               count(*) FILTER(WHERE a.status='failed' AND a.last_attempt_at>=now()-interval '7 days') failed_7d
        FROM public.crm_facebook_auto_reply_attempts a WHERE a.scenario_id=s.id
      ) st ON true
    ) x;

    SELECT jsonb_build_object(
      'enabled_scenarios',(SELECT count(*) FROM public.crm_facebook_reply_scenarios WHERE enabled),
      'sent_24h',(SELECT count(*) FROM public.crm_facebook_auto_reply_attempts WHERE status='sent' AND last_attempt_at>=now()-interval '24 hours'),
      'failed_24h',(SELECT count(*) FROM public.crm_facebook_auto_reply_attempts WHERE status='failed' AND last_attempt_at>=now()-interval '24 hours'),
      'retry_pending',(SELECT count(*) FROM public.crm_facebook_auto_reply_attempts WHERE status='failed' AND retryable=true AND retry_count<3),
      'stuck_claimed',(SELECT count(*) FROM public.crm_facebook_auto_reply_attempts WHERE status='claimed' AND last_attempt_at<now()-interval '10 minutes'),
      'sent_7d',(SELECT count(*) FROM public.crm_facebook_auto_reply_attempts WHERE status='sent' AND last_attempt_at>=now()-interval '7 days')
    ) INTO v_stats;

    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.last_attempt_at DESC),'[]'::jsonb) INTO v_failures
    FROM (
      SELECT a.id,a.conversation_id,a.scenario_id,s.name scenario_name,a.error_text,a.retry_count,a.next_retry_at,a.last_attempt_at
      FROM public.crm_facebook_auto_reply_attempts a
      JOIN public.crm_facebook_reply_scenarios s ON s.id=a.scenario_id
      WHERE a.status='failed' ORDER BY a.last_attempt_at DESC LIMIT 10
    ) x;

    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.page_name NULLS LAST,x.page_id),'[]'::jsonb) INTO v_pages
    FROM (
      SELECT p.page_id,p.page_name,p.timezone,p.business_days,p.business_start,p.business_end
      FROM public.crm_facebook_page_settings p
      UNION
      SELECT c.page_id,NULL::text,'Asia/Ho_Chi_Minh'::text,ARRAY[1,2,3,4,5,6]::integer[],'08:00'::time,'18:00'::time
      FROM public.crm_facebook_conversations c
      WHERE NOT EXISTS(SELECT 1 FROM public.crm_facebook_page_settings p2 WHERE p2.page_id=c.page_id)
      GROUP BY c.page_id
    ) x;

    RETURN jsonb_build_object('ok',true,'scenarios',v_rows,'role',v_role,'stats',v_stats,'recent_failures',v_failures,'pages',v_pages);
  ELSIF p_action='save' THEN
    v_id:=nullif(p_payload->>'id','')::uuid;
    v_keywords:=coalesce(p_payload->'keywords','[]'::jsonb);
    IF jsonb_typeof(v_keywords)<>'array' THEN v_keywords:='[]'::jsonb; END IF;
    IF coalesce(trim(p_payload->>'name'),'')='' OR coalesce(trim(p_payload->>'response_text'),'')='' THEN
      RETURN jsonb_build_object('ok',false,'error','Tên và nội dung trả lời là bắt buộc','code','BAD_REQUEST');
    END IF;
    IF v_id IS NULL THEN
      INSERT INTO public.crm_facebook_reply_scenarios(
        name,trigger_type,keywords,response_text,enabled,priority,cooldown_minutes,created_by,page_id,schedule_scope
      ) VALUES(
        left(trim(p_payload->>'name'),160),
        CASE WHEN p_payload->>'trigger_type' IN('first_message','keyword','no_phone','has_phone','always') THEN p_payload->>'trigger_type' ELSE 'keyword' END,
        v_keywords,left(p_payload->>'response_text',5000),coalesce((p_payload->>'enabled')::boolean,true),
        greatest(1,least(9999,coalesce((p_payload->>'priority')::integer,100))),
        greatest(0,least(10080,coalesce((p_payload->>'cooldown_minutes')::integer,30))),v_uid,
        nullif(trim(p_payload->>'page_id'),''),
        CASE WHEN p_payload->>'schedule_scope' IN('always','business_hours','after_hours') THEN p_payload->>'schedule_scope' ELSE 'always' END
      ) RETURNING * INTO v_row;
    ELSE
      UPDATE public.crm_facebook_reply_scenarios s SET
        name=left(trim(p_payload->>'name'),160),
        trigger_type=CASE WHEN p_payload->>'trigger_type' IN('first_message','keyword','no_phone','has_phone','always') THEN p_payload->>'trigger_type' ELSE s.trigger_type END,
        keywords=v_keywords,response_text=left(p_payload->>'response_text',5000),
        enabled=coalesce((p_payload->>'enabled')::boolean,s.enabled),
        priority=greatest(1,least(9999,coalesce((p_payload->>'priority')::integer,s.priority))),
        cooldown_minutes=greatest(0,least(10080,coalesce((p_payload->>'cooldown_minutes')::integer,s.cooldown_minutes))),
        page_id=nullif(trim(p_payload->>'page_id'),''),
        schedule_scope=CASE WHEN p_payload->>'schedule_scope' IN('always','business_hours','after_hours') THEN p_payload->>'schedule_scope' ELSE 'always' END,
        updated_at=now()
      WHERE s.id=v_id RETURNING * INTO v_row;
      IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Không tìm thấy kịch bản','code','NOT_FOUND'); END IF;
    END IF;
    RETURN jsonb_build_object('ok',true,'scenario',to_jsonb(v_row));
  ELSIF p_action='toggle' THEN
    v_id:=nullif(p_payload->>'id','')::uuid;
    UPDATE public.crm_facebook_reply_scenarios SET enabled=coalesce((p_payload->>'enabled')::boolean,NOT enabled),updated_at=now()
    WHERE id=v_id RETURNING * INTO v_row;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Không tìm thấy kịch bản','code','NOT_FOUND'); END IF;
    RETURN jsonb_build_object('ok',true,'scenario',to_jsonb(v_row));
  ELSIF p_action='delete' THEN
    v_id:=nullif(p_payload->>'id','')::uuid;
    DELETE FROM public.crm_facebook_reply_scenarios WHERE id=v_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Không tìm thấy kịch bản','code','NOT_FOUND'); END IF;
    RETURN jsonb_build_object('ok',true,'deleted',true);
  END IF;
  RETURN jsonb_build_object('ok',false,'error','Hành động không hợp lệ','code','BAD_ACTION');
EXCEPTION WHEN invalid_text_representation THEN
  RETURN jsonb_build_object('ok',false,'error','Dữ liệu kịch bản không hợp lệ','code','BAD_REQUEST');
END
$function$;

CREATE OR REPLACE FUNCTION public.crm_facebook_ops_api_v1(
  p_token text,
  p_action text DEFAULT 'bootstrap',
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid uuid; v_role text; v_conv uuid; v_id uuid; v_rows jsonb; v_tags jsonb; v_pages jsonb; v_report jsonb; v_conv_tags jsonb;
  v_tag_ids jsonb; v_tag uuid; v_qr public.crm_facebook_quick_replies%ROWTYPE;
BEGIN
  SELECT u.id,u.role INTO v_uid,v_role
  FROM public.crm_sessions s JOIN public.users u ON u.id=s.user_id
  WHERE s.token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex')
    AND s.expires_at>now() AND u.active=true LIMIT 1;
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'error','Phiên đăng nhập đã hết hạn','code','UNAUTHENTICATED'); END IF;
  IF v_role NOT IN('ceo','admin','manager','marketing','sale') THEN
    RETURN jsonb_build_object('ok',false,'error','Bạn không có quyền dùng công cụ Fanpage','code','FORBIDDEN');
  END IF;

  IF p_action='bootstrap' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.sort_order,q.title),'[]'::jsonb) INTO v_rows
    FROM public.crm_facebook_quick_replies q WHERE q.enabled=true;
    SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.name),'[]'::jsonb) INTO v_tags FROM public.crm_tags t;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'conversation_id',x.conversation_id,'tags',x.tags
    )),'[]'::jsonb) INTO v_conv_tags
    FROM (
      SELECT ct.conversation_id,
        coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'color',t.color) ORDER BY t.name),'[]'::jsonb) tags
      FROM public.crm_facebook_conversation_tags ct
      JOIN public.crm_tags t ON t.id=ct.tag_id
      GROUP BY ct.conversation_id
    ) x;
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.page_name NULLS LAST,x.page_id),'[]'::jsonb) INTO v_pages
    FROM (
      SELECT p.page_id,p.page_name,p.timezone,p.business_days,p.business_start,p.business_end
      FROM public.crm_facebook_page_settings p
      UNION
      SELECT c.page_id,NULL::text,'Asia/Ho_Chi_Minh'::text,ARRAY[1,2,3,4,5,6]::integer[],'08:00'::time,'18:00'::time
      FROM public.crm_facebook_conversations c
      WHERE NOT EXISTS(SELECT 1 FROM public.crm_facebook_page_settings p2 WHERE p2.page_id=c.page_id)
      GROUP BY c.page_id
    ) x;

    IF v_role IN('ceo','admin','manager','marketing') THEN
      WITH base AS (
        SELECT c.id,c.page_id,c.lead_id,
          (coalesce(c.phone_detected,l.phone,'')<>'') has_phone,
          (l.owner_id IS NOT NULL) assigned,
          EXISTS(
            SELECT 1 FROM public.deals d
            WHERE d.lead_id=l.id AND d.stage IN('deposit','contract','completed')
          ) OR EXISTS(
            SELECT 1 FROM public.crm_opportunities o
            WHERE o.lead_id=l.id AND (o.stage IN('deposit','contract','won') OR o.status='won')
          ) OR EXISTS(
            SELECT 1 FROM public.crm_payments p
            WHERE p.lead_id=l.id AND p.payment_type IN('booking','deposit') AND p.status='paid'
          ) OR EXISTS(
            SELECT 1 FROM public.crm_contracts ct
            WHERE ct.lead_id=l.id AND ct.contract_type IN('booking','deposit','sale') AND ct.status IN('signed','completed')
          ) deposited
        FROM public.crm_facebook_conversations c
        LEFT JOIN public.leads l ON l.id=c.lead_id
        WHERE c.created_at>=now()-interval '30 days'
      )
      SELECT jsonb_build_object(
        'days',30,
        'chat',(SELECT count(*) FROM base),
        'phone',(SELECT count(*) FROM base WHERE has_phone),
        'lead',(SELECT count(*) FROM base WHERE lead_id IS NOT NULL),
        'assigned',(SELECT count(*) FROM base WHERE assigned),
        'deposit',(SELECT count(*) FROM base WHERE deposited),
        'by_page',coalesce((
          SELECT jsonb_agg(to_jsonb(x) ORDER BY x.chat DESC)
          FROM (
            SELECT page_id,count(*) chat,
              count(*) FILTER(WHERE has_phone) phone,
              count(*) FILTER(WHERE lead_id IS NOT NULL) lead,
              count(*) FILTER(WHERE assigned) assigned,
              count(*) FILTER(WHERE deposited) deposit
            FROM base GROUP BY page_id
          ) x
        ),'[]'::jsonb)
      ) INTO v_report;
    ELSE
      v_report:=jsonb_build_object('days',30,'restricted',true);
    END IF;

    RETURN jsonb_build_object('ok',true,'quick_replies',v_rows,'tags',v_tags,'conversation_tags',v_conv_tags,'pages',v_pages,'report',v_report,'role',v_role);
  ELSIF p_action='set_tags' THEN
    v_conv:=nullif(p_payload->>'conversation_id','')::uuid;
    IF NOT EXISTS(
      SELECT 1 FROM public.crm_facebook_conversations c LEFT JOIN public.leads l ON l.id=c.lead_id
      WHERE c.id=v_conv AND (v_role IN('ceo','admin','manager','marketing') OR (v_role='sale' AND l.owner_id=v_uid))
    ) THEN RETURN jsonb_build_object('ok',false,'error','Không có quyền với hội thoại','code','FORBIDDEN'); END IF;
    v_tag_ids:=coalesce(p_payload->'tag_ids','[]'::jsonb);
    DELETE FROM public.crm_facebook_conversation_tags WHERE conversation_id=v_conv;
    IF jsonb_typeof(v_tag_ids)='array' THEN
      FOR v_tag IN SELECT value::text::uuid FROM jsonb_array_elements_text(v_tag_ids)
      LOOP
        IF EXISTS(SELECT 1 FROM public.crm_tags WHERE id=v_tag) THEN
          INSERT INTO public.crm_facebook_conversation_tags(conversation_id,tag_id) VALUES(v_conv,v_tag) ON CONFLICT DO NOTHING;
        END IF;
      END LOOP;
    END IF;
    IF EXISTS(SELECT 1 FROM public.crm_facebook_conversations WHERE id=v_conv AND lead_id IS NOT NULL) THEN
      INSERT INTO public.crm_lead_tags(lead_id,tag_id)
      SELECT c.lead_id,ct.tag_id FROM public.crm_facebook_conversations c
      JOIN public.crm_facebook_conversation_tags ct ON ct.conversation_id=c.id
      WHERE c.id=v_conv ON CONFLICT DO NOTHING;
    END IF;
    RETURN jsonb_build_object('ok',true);
  ELSIF p_action='save_tag' THEN
    IF v_role NOT IN('ceo','admin','manager','marketing') THEN RETURN jsonb_build_object('ok',false,'error','FORBIDDEN','code','FORBIDDEN'); END IF;
    IF coalesce(trim(p_payload->>'name'),'')='' THEN RETURN jsonb_build_object('ok',false,'error','Tên nhãn là bắt buộc','code','BAD_REQUEST'); END IF;
    INSERT INTO public.crm_tags(name,color,created_by)
    VALUES(left(trim(p_payload->>'name'),80),coalesce(nullif(left(p_payload->>'color',20),''),'#0f766e'),v_uid)
    ON CONFLICT(name) DO UPDATE SET color=excluded.color
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('ok',true,'id',v_id);
  ELSIF p_action='save_quick_reply' THEN
    IF v_role NOT IN('ceo','admin','manager','marketing') THEN RETURN jsonb_build_object('ok',false,'error','FORBIDDEN','code','FORBIDDEN'); END IF;
    v_id:=nullif(p_payload->>'id','')::uuid;
    IF coalesce(trim(p_payload->>'title'),'')='' OR coalesce(trim(p_payload->>'reply_text'),'')='' THEN
      RETURN jsonb_build_object('ok',false,'error','Tên và nội dung là bắt buộc','code','BAD_REQUEST');
    END IF;
    IF v_id IS NULL THEN
      INSERT INTO public.crm_facebook_quick_replies(title,reply_text,page_id,enabled,sort_order,created_by)
      VALUES(left(trim(p_payload->>'title'),100),left(p_payload->>'reply_text',2000),nullif(trim(p_payload->>'page_id'),''),coalesce((p_payload->>'enabled')::boolean,true),coalesce((p_payload->>'sort_order')::integer,100),v_uid)
      RETURNING * INTO v_qr;
    ELSE
      UPDATE public.crm_facebook_quick_replies SET title=left(trim(p_payload->>'title'),100),reply_text=left(p_payload->>'reply_text',2000),
        page_id=nullif(trim(p_payload->>'page_id'),''),enabled=coalesce((p_payload->>'enabled')::boolean,enabled),
        sort_order=coalesce((p_payload->>'sort_order')::integer,sort_order),updated_at=now()
      WHERE id=v_id RETURNING * INTO v_qr;
    END IF;
    RETURN jsonb_build_object('ok',true,'quick_reply',to_jsonb(v_qr));
  ELSIF p_action='delete_quick_reply' THEN
    IF v_role NOT IN('ceo','admin','manager','marketing') THEN RETURN jsonb_build_object('ok',false,'error','FORBIDDEN','code','FORBIDDEN'); END IF;
    v_id:=nullif(p_payload->>'id','')::uuid;
    DELETE FROM public.crm_facebook_quick_replies WHERE id=v_id;
    RETURN jsonb_build_object('ok',true);
  ELSIF p_action='save_page' THEN
    IF v_role NOT IN('ceo','admin','manager','marketing') THEN RETURN jsonb_build_object('ok',false,'error','FORBIDDEN','code','FORBIDDEN'); END IF;
    IF coalesce(trim(p_payload->>'page_id'),'')='' THEN RETURN jsonb_build_object('ok',false,'error','Fanpage ID là bắt buộc','code','BAD_REQUEST'); END IF;
    INSERT INTO public.crm_facebook_page_settings(page_id,page_name,timezone,business_days,business_start,business_end,updated_by,updated_at)
    VALUES(
      left(trim(p_payload->>'page_id'),120),nullif(left(trim(p_payload->>'page_name'),160),''),
      coalesce(nullif(left(trim(p_payload->>'timezone'),80),''),'Asia/Ho_Chi_Minh'),
      CASE WHEN jsonb_typeof(p_payload->'business_days')='array'
        THEN ARRAY(SELECT value::integer FROM jsonb_array_elements_text(p_payload->'business_days') WHERE value::integer BETWEEN 1 AND 7)
        ELSE ARRAY[1,2,3,4,5,6] END,
      coalesce(nullif(p_payload->>'business_start','')::time,'08:00'::time),
      coalesce(nullif(p_payload->>'business_end','')::time,'18:00'::time),
      v_uid,now()
    ) ON CONFLICT(page_id) DO UPDATE SET
      page_name=excluded.page_name,timezone=excluded.timezone,business_days=excluded.business_days,
      business_start=excluded.business_start,business_end=excluded.business_end,updated_by=v_uid,updated_at=now();
    RETURN jsonb_build_object('ok',true);
  END IF;

  RETURN jsonb_build_object('ok',false,'error','Hành động không hợp lệ','code','BAD_ACTION');
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format THEN
  RETURN jsonb_build_object('ok',false,'error','Dữ liệu không hợp lệ','code','BAD_REQUEST');
END
$function$;

CREATE OR REPLACE FUNCTION public.crm_facebook_conversation_tags_json(p_conversation_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'color',t.color) ORDER BY t.name),'[]'::jsonb)
  FROM public.crm_facebook_conversation_tags ct
  JOIN public.crm_tags t ON t.id=ct.tag_id
  WHERE ct.conversation_id=p_conversation_id
$function$;

REVOKE ALL ON public.crm_facebook_page_settings FROM anonymous;
REVOKE ALL ON public.crm_facebook_quick_replies FROM anonymous;
REVOKE ALL ON public.crm_facebook_conversation_tags FROM anonymous;
REVOKE EXECUTE ON FUNCTION public.crm_facebook_auto_reply_claim_v3(text,uuid,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_facebook_retry_claim_v1(text,integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_facebook_automation_api_v2(text,text,jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_facebook_ops_api_v1(text,text,jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_facebook_conversation_tags_json(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_facebook_auto_reply_claim_v3(text,uuid,text,text) TO anonymous;
GRANT EXECUTE ON FUNCTION public.crm_facebook_retry_claim_v1(text,integer) TO anonymous;
GRANT EXECUTE ON FUNCTION public.crm_facebook_automation_api_v2(text,text,jsonb) TO anonymous;
GRANT EXECUTE ON FUNCTION public.crm_facebook_ops_api_v1(text,text,jsonb) TO anonymous;
GRANT EXECUTE ON FUNCTION public.crm_facebook_conversation_tags_json(uuid) TO anonymous;

INSERT INTO public.crm_facebook_quick_replies(title,reply_text,sort_order)
SELECT 'Xin số điện thoại','Anh/Chị cho em xin số điện thoại để em gửi thông tin và hỗ trợ nhanh hơn nhé.',10
WHERE NOT EXISTS(SELECT 1 FROM public.crm_facebook_quick_replies WHERE title='Xin số điện thoại');

INSERT INTO public.crm_facebook_quick_replies(title,reply_text,sort_order)
SELECT 'Hẹn tư vấn','Dạ em đã ghi nhận nhu cầu của Anh/Chị. Em xin phép kết nối nhân viên phụ trách để tư vấn chi tiết và phù hợp nhất ạ.',20
WHERE NOT EXISTS(SELECT 1 FROM public.crm_facebook_quick_replies WHERE title='Hẹn tư vấn');

NOTIFY pgrst,'reload schema';
