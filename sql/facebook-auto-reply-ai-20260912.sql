-- PTM CRM · Facebook auto-reply scenarios + AI-assisted authoring
-- 2026-09-12

CREATE TABLE IF NOT EXISTS public.crm_facebook_reply_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  trigger_type text NOT NULL DEFAULT 'keyword' CHECK (trigger_type IN ('first_message','keyword','no_phone','has_phone','always')),
  keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  response_text text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  cooldown_minutes integer NOT NULL DEFAULT 30 CHECK (cooldown_minutes >= 0 AND cooldown_minutes <= 10080),
  created_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_facebook_reply_scenarios_enabled_idx
  ON public.crm_facebook_reply_scenarios(enabled, priority, created_at);

CREATE TABLE IF NOT EXISTS public.crm_facebook_auto_reply_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.crm_facebook_conversations(id) ON DELETE CASCADE,
  scenario_id uuid NOT NULL REFERENCES public.crm_facebook_reply_scenarios(id) ON DELETE CASCADE,
  inbound_message_id text NULL,
  outbound_message_id text NULL,
  response_text text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS crm_facebook_auto_reply_events_inbound_unique
  ON public.crm_facebook_auto_reply_events(inbound_message_id)
  WHERE inbound_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_facebook_auto_reply_events_conversation_idx
  ON public.crm_facebook_auto_reply_events(conversation_id, sent_at DESC);

CREATE OR REPLACE FUNCTION public.crm_facebook_auto_reply_pick_v1(
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
BEGIN
  IF NOT public.crm_integration_secret_ok('meta_app_secret', p_secret) THEN
    RETURN jsonb_build_object('ok',false,'error','INVALID_META_APP_SECRET');
  END IF;

  IF p_conversation_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','CONVERSATION_REQUIRED');
  END IF;

  IF nullif(trim(coalesce(p_inbound_message_id,'')),'') IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.crm_facebook_auto_reply_events e
    WHERE e.inbound_message_id=p_inbound_message_id
  ) THEN
    RETURN jsonb_build_object('ok',true,'matched',false,'duplicate',true);
  END IF;

  SELECT c.*, l.phone lead_phone
  INTO v_conv
  FROM public.crm_facebook_conversations c
  LEFT JOIN public.leads l ON l.id=c.lead_id
  WHERE c.id=p_conversation_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'error','CONVERSATION_NOT_FOUND');
  END IF;

  IF v_conv.last_inbound_at IS NULL OR v_conv.last_inbound_at < now()-interval '24 hours' THEN
    RETURN jsonb_build_object('ok',true,'matched',false,'reason','OUTSIDE_24H_WINDOW');
  END IF;

  FOR v_scenario IN
    SELECT s.*
    FROM public.crm_facebook_reply_scenarios s
    WHERE s.enabled=true
    ORDER BY s.priority ASC, s.created_at ASC
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.crm_facebook_auto_reply_events e
      WHERE e.conversation_id=p_conversation_id
        AND e.scenario_id=v_scenario.id
        AND e.sent_at >= now() - make_interval(mins => v_scenario.cooldown_minutes)
    ) THEN
      CONTINUE;
    END IF;

    v_keyword_match:=false;
    IF v_scenario.trigger_type='keyword' THEN
      FOR v_keyword IN SELECT lower(trim(value)) FROM jsonb_array_elements_text(v_scenario.keywords)
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
          SELECT count(*) FROM public.crm_facebook_messages m
          WHERE m.conversation_id=p_conversation_id AND m.direction='inbound'
       )=1)
    THEN
      RETURN jsonb_build_object(
        'ok',true,'matched',true,
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

CREATE OR REPLACE FUNCTION public.crm_facebook_auto_reply_log_v1(
  p_secret text,
  p_conversation_id uuid,
  p_scenario_id uuid,
  p_inbound_message_id text,
  p_outbound_message_id text,
  p_text text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_event uuid;
BEGIN
  IF NOT public.crm_integration_secret_ok('meta_app_secret', p_secret) THEN
    RETURN jsonb_build_object('ok',false,'error','INVALID_META_APP_SECRET');
  END IF;

  INSERT INTO public.crm_facebook_auto_reply_events(
    conversation_id,scenario_id,inbound_message_id,outbound_message_id,response_text,payload
  ) VALUES (
    p_conversation_id,p_scenario_id,nullif(trim(coalesce(p_inbound_message_id,'')),''),
    nullif(trim(coalesce(p_outbound_message_id,'')),''),left(coalesce(p_text,''),5000),coalesce(p_payload,'{}'::jsonb)
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_event;

  IF v_event IS NULL THEN
    RETURN jsonb_build_object('ok',true,'duplicate',true);
  END IF;

  INSERT INTO public.crm_facebook_messages(
    conversation_id,meta_message_id,direction,message_type,text_content,payload,sent_by_user_id,created_at
  ) VALUES (
    p_conversation_id,nullif(trim(coalesce(p_outbound_message_id,'')),''),'outbound','text',
    nullif(left(coalesce(p_text,''),5000),''),coalesce(p_payload,'{}'::jsonb),NULL,now()
  ) ON CONFLICT DO NOTHING;

  UPDATE public.crm_facebook_conversations
  SET last_message_text=nullif(left(coalesce(p_text,''),2000),''),
      last_message_at=now(),last_outbound_at=now(),updated_at=now()
  WHERE id=p_conversation_id;

  RETURN jsonb_build_object('ok',true,'event_id',v_event);
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
    SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.priority,s.created_at),'[]'::jsonb)
    INTO v_rows
    FROM public.crm_facebook_reply_scenarios s;
    RETURN jsonb_build_object('ok',true,'scenarios',v_rows,'role',v_role);

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

REVOKE ALL ON public.crm_facebook_reply_scenarios FROM anonymous;
REVOKE ALL ON public.crm_facebook_auto_reply_events FROM anonymous;
REVOKE EXECUTE ON FUNCTION public.crm_facebook_auto_reply_pick_v1(text,uuid,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_facebook_auto_reply_log_v1(text,uuid,uuid,text,text,text,jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_facebook_automation_api_v1(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_facebook_auto_reply_pick_v1(text,uuid,text,text) TO anonymous;
GRANT EXECUTE ON FUNCTION public.crm_facebook_auto_reply_log_v1(text,uuid,uuid,text,text,text,jsonb) TO anonymous;
GRANT EXECUTE ON FUNCTION public.crm_facebook_automation_api_v1(text,text,jsonb) TO anonymous;

INSERT INTO public.crm_facebook_reply_scenarios(name,trigger_type,keywords,response_text,enabled,priority,cooldown_minutes)
SELECT 'Chào khách lần đầu','first_message','[]'::jsonb,
       'Phúc Trường Minh xin chào Anh/Chị. Em đã nhận được tin nhắn và sẽ hỗ trợ ngay. Anh/Chị đang quan tâm thông tin sản phẩm, vị trí hay chính sách tư vấn ạ?',
       true,10,1440
WHERE NOT EXISTS (SELECT 1 FROM public.crm_facebook_reply_scenarios WHERE name='Chào khách lần đầu');

INSERT INTO public.crm_facebook_reply_scenarios(name,trigger_type,keywords,response_text,enabled,priority,cooldown_minutes)
SELECT 'Xin số điện thoại','no_phone','[]'::jsonb,
       'Để tư vấn nhanh và gửi thông tin phù hợp, Anh/Chị cho em xin số điện thoại liên hệ nhé. CRM sẽ chuyển ngay cho nhân viên phụ trách.',
       true,80,720
WHERE NOT EXISTS (SELECT 1 FROM public.crm_facebook_reply_scenarios WHERE name='Xin số điện thoại');

NOTIFY pgrst, 'reload schema';
