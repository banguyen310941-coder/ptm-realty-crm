-- PTM CRM · Facebook/Messenger production hardening
-- 2026-09-12
-- Adds atomic auto-reply claims, failure observability and human-takeover pause.

ALTER TABLE public.crm_facebook_conversations
  ADD COLUMN IF NOT EXISTS automation_paused_until timestamptz NULL,
  ADD COLUMN IF NOT EXISTS automation_pause_reason text NULL,
  ADD COLUMN IF NOT EXISTS automation_paused_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.crm_facebook_auto_reply_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.crm_facebook_conversations(id) ON DELETE CASCADE,
  scenario_id uuid NOT NULL REFERENCES public.crm_facebook_reply_scenarios(id) ON DELETE CASCADE,
  inbound_message_id text NULL,
  outbound_message_id text NULL,
  status text NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed','sent','failed')),
  response_text text NOT NULL,
  error_text text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS crm_facebook_auto_reply_attempts_inbound_unique
  ON public.crm_facebook_auto_reply_attempts(inbound_message_id)
  WHERE inbound_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS crm_facebook_auto_reply_attempts_recent_idx
  ON public.crm_facebook_auto_reply_attempts(attempted_at DESC);

CREATE INDEX IF NOT EXISTS crm_facebook_auto_reply_attempts_scenario_idx
  ON public.crm_facebook_auto_reply_attempts(scenario_id, attempted_at DESC);

CREATE OR REPLACE FUNCTION public.crm_facebook_auto_reply_claim_v2(
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
  v_text text := lower(coalesce(p_text,''));
  v_keyword text;
  v_keyword_match boolean;
  v_attempt uuid;
BEGIN
  IF NOT public.crm_integration_secret_ok('meta_app_secret', p_secret) THEN
    RETURN jsonb_build_object('ok',false,'error','INVALID_META_APP_SECRET');
  END IF;

  IF p_conversation_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','CONVERSATION_REQUIRED');
  END IF;

  IF nullif(trim(coalesce(p_inbound_message_id,'')),'') IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.crm_facebook_auto_reply_attempts a
    WHERE a.inbound_message_id=p_inbound_message_id
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
    RETURN jsonb_build_object(
      'ok',true,'matched',false,'reason','HUMAN_TAKEOVER',
      'paused_until',v_conv.automation_paused_until
    );
  END IF;

  IF v_conv.last_inbound_at IS NULL OR v_conv.last_inbound_at < now()-interval '24 hours' THEN
    RETURN jsonb_build_object('ok',true,'matched',false,'reason','OUTSIDE_24H_WINDOW');
  END IF;

  FOR v_scenario IN
    SELECT s.*
    FROM public.crm_facebook_reply_scenarios s
    WHERE s.enabled=true
    ORDER BY s.priority ASC,s.created_at ASC
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.crm_facebook_auto_reply_events e
      WHERE e.conversation_id=p_conversation_id
        AND e.scenario_id=v_scenario.id
        AND e.sent_at>=now()-make_interval(mins=>v_scenario.cooldown_minutes)
    ) THEN
      CONTINUE;
    END IF;

    v_keyword_match:=false;
    IF v_scenario.trigger_type='keyword' THEN
      FOR v_keyword IN
        SELECT lower(trim(value))
        FROM jsonb_array_elements_text(v_scenario.keywords)
      LOOP
        IF v_keyword<>'' AND position(v_keyword in v_text)>0 THEN
          v_keyword_match:=true;
          EXIT;
        END IF;
      END LOOP;
    END IF;

    IF v_scenario.trigger_type='always'
       OR (v_scenario.trigger_type='keyword' AND v_keyword_match)
       OR (v_scenario.trigger_type='no_phone' AND coalesce(v_conv.phone_detected,v_conv.lead_phone,'')='')
       OR (v_scenario.trigger_type='has_phone' AND coalesce(v_conv.phone_detected,v_conv.lead_phone,'')<>'')
       OR (v_scenario.trigger_type='first_message' AND (
          SELECT count(*)
          FROM public.crm_facebook_messages m
          WHERE m.conversation_id=p_conversation_id
            AND m.direction='inbound'
       )=1)
    THEN
      INSERT INTO public.crm_facebook_auto_reply_attempts(
        conversation_id,scenario_id,inbound_message_id,status,response_text,payload
      )
      VALUES(
        p_conversation_id,
        v_scenario.id,
        nullif(trim(coalesce(p_inbound_message_id,'')),''),
        'claimed',
        v_scenario.response_text,
        jsonb_build_object('scenario_name',v_scenario.name)
      )
      ON CONFLICT DO NOTHING
      RETURNING id INTO v_attempt;

      IF v_attempt IS NULL THEN
        RETURN jsonb_build_object('ok',true,'matched',false,'duplicate',true);
      END IF;

      RETURN jsonb_build_object(
        'ok',true,'matched',true,
        'attempt_id',v_attempt,
        'scenario_id',v_scenario.id,
        'scenario_name',v_scenario.name,
        'reply_text',v_scenario.response_text,
        'conversation_id',p_conversation_id,
        'page_id',v_conv.page_id,
        'psid',v_conv.psid
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok',true,'matched',false);
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
BEGIN
  IF NOT public.crm_integration_secret_ok('meta_app_secret', p_secret) THEN
    RETURN jsonb_build_object('ok',false,'error','INVALID_META_APP_SECRET');
  END IF;

  SELECT a.*
  INTO v_attempt
  FROM public.crm_facebook_auto_reply_attempts a
  WHERE a.id=p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'error','ATTEMPT_NOT_FOUND');
  END IF;

  IF v_attempt.status IN ('sent','failed') THEN
    RETURN jsonb_build_object('ok',true,'duplicate',true,'status',v_attempt.status);
  END IF;

  IF p_success THEN
    UPDATE public.crm_facebook_auto_reply_attempts
    SET status='sent',
        outbound_message_id=nullif(trim(coalesce(p_outbound_message_id,'')),''),
        payload=coalesce(p_payload,'{}'::jsonb),
        completed_at=now()
    WHERE id=p_attempt_id;

    INSERT INTO public.crm_facebook_auto_reply_events(
      conversation_id,scenario_id,inbound_message_id,outbound_message_id,response_text,payload,sent_at
    )
    VALUES(
      v_attempt.conversation_id,
      v_attempt.scenario_id,
      v_attempt.inbound_message_id,
      nullif(trim(coalesce(p_outbound_message_id,'')),''),
      v_attempt.response_text,
      coalesce(p_payload,'{}'::jsonb),
      now()
    )
    ON CONFLICT DO NOTHING;

    INSERT INTO public.crm_facebook_messages(
      conversation_id,meta_message_id,direction,message_type,text_content,payload,sent_by_user_id,created_at
    )
    VALUES(
      v_attempt.conversation_id,
      nullif(trim(coalesce(p_outbound_message_id,'')),''),
      'outbound','text',
      nullif(left(v_attempt.response_text,5000),''),
      coalesce(p_payload,'{}'::jsonb),
      NULL,now()
    )
    ON CONFLICT DO NOTHING;

    UPDATE public.crm_facebook_conversations
    SET last_message_text=nullif(left(v_attempt.response_text,2000),''),
        last_message_at=now(),
        last_outbound_at=now(),
        updated_at=now()
    WHERE id=v_attempt.conversation_id;

    RETURN jsonb_build_object('ok',true,'status','sent','attempt_id',p_attempt_id);
  END IF;

  UPDATE public.crm_facebook_auto_reply_attempts
  SET status='failed',
      error_text=nullif(left(coalesce(p_error,'AUTO_REPLY_SEND_FAILED'),2000),''),
      payload=coalesce(p_payload,'{}'::jsonb),
      completed_at=now()
  WHERE id=p_attempt_id;

  RETURN jsonb_build_object('ok',true,'status','failed','attempt_id',p_attempt_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.crm_facebook_api_v1(
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
  v_uid uuid;
  v_role text;
  v_conversation uuid;
  v_row record;
  v_messages jsonb;
  v_conversations jsonb;
  v_affected integer:=0;
  v_pause_minutes integer;
  v_pause_until timestamptz;
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

  IF v_role NOT IN ('ceo','admin','manager','marketing','sale') THEN
    RETURN jsonb_build_object('ok',false,'error','Bạn không có quyền truy cập hội thoại Fanpage','code','FORBIDDEN');
  END IF;

  IF p_action='bootstrap' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.last_message_at DESC NULLS LAST),'[]'::jsonb)
    INTO v_conversations
    FROM (
      SELECT c.id,c.page_id,c.psid,c.sender_name,c.lead_id,c.phone_detected,c.status,c.unread_count,
             c.last_message_text,c.last_message_at,c.last_inbound_at,c.last_outbound_at,c.created_at,c.updated_at,
             c.automation_paused_until,c.automation_pause_reason,c.automation_paused_by,
             (c.automation_paused_until IS NOT NULL AND c.automation_paused_until>now()) automation_paused,
             l.name lead_name,l.phone lead_phone,l.status lead_status,l.owner_id,
             u.name owner_name,
             (c.last_inbound_at IS NOT NULL AND c.last_inbound_at>=now()-interval '24 hours') within_24h
      FROM public.crm_facebook_conversations c
      LEFT JOIN public.leads l ON l.id=c.lead_id
      LEFT JOIN public.users u ON u.id=l.owner_id
      WHERE v_role IN ('ceo','admin','manager','marketing')
         OR (v_role='sale' AND l.owner_id=v_uid)
      ORDER BY c.last_message_at DESC NULLS LAST
      LIMIT 150
    ) x;

    RETURN jsonb_build_object(
      'ok',true,
      'conversations',v_conversations,
      'unread_total',coalesce((
        SELECT sum(c.unread_count)
        FROM public.crm_facebook_conversations c
        LEFT JOIN public.leads l ON l.id=c.lead_id
        WHERE v_role IN ('ceo','admin','manager','marketing')
           OR (v_role='sale' AND l.owner_id=v_uid)
      ),0)
    );

  ELSIF p_action IN ('messages','mark_read','send_context','log_outbound','pause_automation','resume_automation') THEN
    v_conversation:=nullif(p_payload->>'conversation_id','')::uuid;

    SELECT c.*,l.name lead_name,l.phone lead_phone,l.status lead_status,l.owner_id,u.name owner_name
    INTO v_row
    FROM public.crm_facebook_conversations c
    LEFT JOIN public.leads l ON l.id=c.lead_id
    LEFT JOIN public.users u ON u.id=l.owner_id
    WHERE c.id=v_conversation
      AND (
        v_role IN ('ceo','admin','manager','marketing')
        OR (v_role='sale' AND l.owner_id=v_uid)
      )
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok',false,'error','Không tìm thấy hội thoại hoặc bạn không có quyền truy cập','code','NOT_FOUND');
    END IF;

    IF p_action='messages' THEN
      SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.created_at,m.id),'[]'::jsonb)
      INTO v_messages
      FROM (
        SELECT id,meta_message_id,direction,message_type,text_content,payload,sent_by_user_id,created_at
        FROM public.crm_facebook_messages
        WHERE conversation_id=v_conversation
        ORDER BY created_at DESC,id DESC
        LIMIT 250
      ) m;

      RETURN jsonb_build_object(
        'ok',true,
        'conversation',to_jsonb(v_row)||jsonb_build_object(
          'within_24h',v_row.last_inbound_at IS NOT NULL AND v_row.last_inbound_at>=now()-interval '24 hours',
          'automation_paused',v_row.automation_paused_until IS NOT NULL AND v_row.automation_paused_until>now()
        ),
        'messages',v_messages
      );

    ELSIF p_action='mark_read' THEN
      UPDATE public.crm_facebook_conversations
      SET unread_count=0,updated_at=now()
      WHERE id=v_conversation;
      GET DIAGNOSTICS v_affected=ROW_COUNT;
      RETURN jsonb_build_object('ok',true,'updated',v_affected);

    ELSIF p_action='send_context' THEN
      RETURN jsonb_build_object(
        'ok',true,
        'conversation_id',v_row.id,
        'page_id',v_row.page_id,
        'psid',v_row.psid,
        'last_inbound_at',v_row.last_inbound_at,
        'within_24h',v_row.last_inbound_at IS NOT NULL AND v_row.last_inbound_at>=now()-interval '24 hours',
        'automation_paused',v_row.automation_paused_until IS NOT NULL AND v_row.automation_paused_until>now(),
        'automation_paused_until',v_row.automation_paused_until
      );

    ELSIF p_action='log_outbound' THEN
      INSERT INTO public.crm_facebook_messages(
        conversation_id,meta_message_id,direction,message_type,text_content,payload,sent_by_user_id,created_at
      )
      VALUES(
        v_conversation,nullif(p_payload->>'meta_message_id',''),'outbound','text',
        nullif(left(coalesce(p_payload->>'text',''),5000),''),
        coalesce(p_payload->'meta_response','{}'::jsonb),v_uid,now()
      )
      ON CONFLICT DO NOTHING;

      v_pause_until:=now()+interval '8 hours';

      UPDATE public.crm_facebook_conversations
      SET last_message_text=nullif(left(coalesce(p_payload->>'text',''),2000),''),
          last_message_at=now(),
          last_outbound_at=now(),
          automation_paused_until=v_pause_until,
          automation_pause_reason='human_reply',
          automation_paused_by=v_uid,
          updated_at=now()
      WHERE id=v_conversation;

      RETURN jsonb_build_object(
        'ok',true,'conversation_id',v_conversation,
        'automation_paused',true,'automation_paused_until',v_pause_until
      );

    ELSIF p_action='pause_automation' THEN
      v_pause_minutes:=greatest(15,least(10080,coalesce((p_payload->>'minutes')::integer,480)));
      v_pause_until:=now()+make_interval(mins=>v_pause_minutes);

      UPDATE public.crm_facebook_conversations
      SET automation_paused_until=v_pause_until,
          automation_pause_reason=coalesce(nullif(left(p_payload->>'reason',120),''),'manual_pause'),
          automation_paused_by=v_uid,
          updated_at=now()
      WHERE id=v_conversation;

      RETURN jsonb_build_object(
        'ok',true,'automation_paused',true,'automation_paused_until',v_pause_until
      );

    ELSIF p_action='resume_automation' THEN
      UPDATE public.crm_facebook_conversations
      SET automation_paused_until=NULL,
          automation_pause_reason=NULL,
          automation_paused_by=NULL,
          updated_at=now()
      WHERE id=v_conversation;

      RETURN jsonb_build_object('ok',true,'automation_paused',false);
    END IF;
  END IF;

  RETURN jsonb_build_object('ok',false,'error','Hành động Fanpage không hợp lệ','code','BAD_ACTION');
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('ok',false,'error','Dữ liệu hội thoại không hợp lệ','code','BAD_REQUEST');
END
$function$;

CREATE OR REPLACE FUNCTION public.crm_facebook_automation_api_v1(
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
  v_uid uuid;
  v_role text;
  v_id uuid;
  v_rows jsonb;
  v_row public.crm_facebook_reply_scenarios%ROWTYPE;
  v_keywords jsonb;
  v_stats jsonb;
  v_failures jsonb;
BEGIN
  SELECT u.id,u.role INTO v_uid,v_role
  FROM public.crm_sessions s
  JOIN public.users u ON u.id=s.user_id
  WHERE s.token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex')
    AND s.expires_at>now() AND u.active=true
  LIMIT 1;

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','Phiên đăng nhập đã hết hạn','code','UNAUTHENTICATED');
  END IF;

  IF v_role NOT IN ('ceo','admin','manager','marketing') THEN
    RETURN jsonb_build_object('ok',false,'error','Bạn không có quyền quản lý kịch bản Fanpage','code','FORBIDDEN');
  END IF;

  IF p_action='bootstrap' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.priority,x.created_at),'[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT s.*,
             coalesce(st.sent_7d,0) sent_7d,
             coalesce(st.failed_7d,0) failed_7d
      FROM public.crm_facebook_reply_scenarios s
      LEFT JOIN LATERAL (
        SELECT
          count(*) FILTER (WHERE a.status='sent' AND a.attempted_at>=now()-interval '7 days') sent_7d,
          count(*) FILTER (WHERE a.status='failed' AND a.attempted_at>=now()-interval '7 days') failed_7d
        FROM public.crm_facebook_auto_reply_attempts a
        WHERE a.scenario_id=s.id
      ) st ON true
    ) x;

    SELECT jsonb_build_object(
      'enabled_scenarios',(SELECT count(*) FROM public.crm_facebook_reply_scenarios WHERE enabled),
      'sent_24h',(SELECT count(*) FROM public.crm_facebook_auto_reply_attempts WHERE status='sent' AND attempted_at>=now()-interval '24 hours'),
      'failed_24h',(SELECT count(*) FROM public.crm_facebook_auto_reply_attempts WHERE status='failed' AND attempted_at>=now()-interval '24 hours'),
      'sent_7d',(SELECT count(*) FROM public.crm_facebook_auto_reply_attempts WHERE status='sent' AND attempted_at>=now()-interval '7 days'),
      'failed_7d',(SELECT count(*) FROM public.crm_facebook_auto_reply_attempts WHERE status='failed' AND attempted_at>=now()-interval '7 days')
    ) INTO v_stats;

    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.attempted_at DESC),'[]'::jsonb)
    INTO v_failures
    FROM (
      SELECT a.id,a.conversation_id,a.scenario_id,s.name scenario_name,
             a.error_text,a.attempted_at
      FROM public.crm_facebook_auto_reply_attempts a
      JOIN public.crm_facebook_reply_scenarios s ON s.id=a.scenario_id
      WHERE a.status='failed'
      ORDER BY a.attempted_at DESC
      LIMIT 10
    ) x;

    RETURN jsonb_build_object(
      'ok',true,
      'scenarios',v_rows,
      'role',v_role,
      'stats',v_stats,
      'recent_failures',v_failures
    );

  ELSIF p_action='save' THEN
    v_id:=nullif(p_payload->>'id','')::uuid;
    v_keywords:=coalesce(p_payload->'keywords','[]'::jsonb);
    IF jsonb_typeof(v_keywords)<>'array' THEN v_keywords:='[]'::jsonb; END IF;

    IF coalesce(trim(p_payload->>'name'),'')='' OR coalesce(trim(p_payload->>'response_text'),'')='' THEN
      RETURN jsonb_build_object('ok',false,'error','Tên và nội dung trả lời là bắt buộc','code','BAD_REQUEST');
    END IF;

    IF v_id IS NULL THEN
      INSERT INTO public.crm_facebook_reply_scenarios(
        name,trigger_type,keywords,response_text,enabled,priority,cooldown_minutes,created_by
      ) VALUES (
        left(trim(p_payload->>'name'),160),
        CASE WHEN p_payload->>'trigger_type' IN ('first_message','keyword','no_phone','has_phone','always') THEN p_payload->>'trigger_type' ELSE 'keyword' END,
        v_keywords,left(p_payload->>'response_text',5000),coalesce((p_payload->>'enabled')::boolean,true),
        greatest(1,least(9999,coalesce((p_payload->>'priority')::integer,100))),
        greatest(0,least(10080,coalesce((p_payload->>'cooldown_minutes')::integer,30))),v_uid
      ) RETURNING * INTO v_row;
    ELSE
      UPDATE public.crm_facebook_reply_scenarios s
      SET name=left(trim(p_payload->>'name'),160),
          trigger_type=CASE WHEN p_payload->>'trigger_type' IN ('first_message','keyword','no_phone','has_phone','always') THEN p_payload->>'trigger_type' ELSE s.trigger_type END,
          keywords=v_keywords,response_text=left(p_payload->>'response_text',5000),
          enabled=coalesce((p_payload->>'enabled')::boolean,s.enabled),
          priority=greatest(1,least(9999,coalesce((p_payload->>'priority')::integer,s.priority))),
          cooldown_minutes=greatest(0,least(10080,coalesce((p_payload->>'cooldown_minutes')::integer,s.cooldown_minutes))),
          updated_at=now()
      WHERE s.id=v_id RETURNING * INTO v_row;
      IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Không tìm thấy kịch bản','code','NOT_FOUND'); END IF;
    END IF;
    RETURN jsonb_build_object('ok',true,'scenario',to_jsonb(v_row));

  ELSIF p_action='toggle' THEN
    v_id:=nullif(p_payload->>'id','')::uuid;
    UPDATE public.crm_facebook_reply_scenarios
    SET enabled=coalesce((p_payload->>'enabled')::boolean,NOT enabled),updated_at=now()
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
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('ok',false,'error','Dữ liệu kịch bản không hợp lệ','code','BAD_REQUEST');
END
$function$;

REVOKE ALL ON public.crm_facebook_auto_reply_attempts FROM anonymous;

REVOKE EXECUTE ON FUNCTION public.crm_facebook_auto_reply_claim_v2(text,uuid,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_facebook_auto_reply_finish_v2(text,uuid,boolean,text,text,jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.crm_facebook_auto_reply_claim_v2(text,uuid,text,text) TO anonymous;
GRANT EXECUTE ON FUNCTION public.crm_facebook_auto_reply_finish_v2(text,uuid,boolean,text,text,jsonb) TO anonymous;

NOTIFY pgrst,'reload schema';
