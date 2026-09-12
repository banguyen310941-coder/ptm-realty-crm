-- PTM CRM · Facebook/Messenger inbox
-- 2026-09-12
-- Adds a Pancake-like inbox foundation: persist conversations/messages, detect phone numbers,
-- link/create CRM leads, and reuse the existing 10-minute lead offer routing trigger.

CREATE TABLE IF NOT EXISTS public.crm_facebook_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id text NOT NULL,
  psid text NOT NULL,
  sender_name text NULL,
  lead_id uuid NULL REFERENCES public.leads(id) ON DELETE SET NULL,
  phone_detected text NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  last_message_text text NULL,
  last_message_at timestamptz NULL,
  last_inbound_at timestamptz NULL,
  last_outbound_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(page_id, psid)
);

CREATE INDEX IF NOT EXISTS crm_facebook_conversations_lead_idx
  ON public.crm_facebook_conversations(lead_id);
CREATE INDEX IF NOT EXISTS crm_facebook_conversations_last_message_idx
  ON public.crm_facebook_conversations(last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.crm_facebook_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.crm_facebook_conversations(id) ON DELETE CASCADE,
  meta_message_id text NULL,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  message_type text NOT NULL DEFAULT 'text',
  text_content text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_by_user_id uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS crm_facebook_messages_meta_mid_unique
  ON public.crm_facebook_messages(meta_message_id)
  WHERE meta_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_facebook_messages_conversation_idx
  ON public.crm_facebook_messages(conversation_id, created_at);

CREATE OR REPLACE FUNCTION public.crm_facebook_receive_v1(
  p_secret text,
  p_page_id text,
  p_psid text,
  p_message_id text DEFAULT NULL,
  p_text text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_sender_name text DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_received_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_conversation uuid;
  v_lead uuid;
  v_owner uuid;
  v_phone text;
  v_name text;
  v_created_lead boolean := false;
BEGIN
  IF NOT public.crm_integration_secret_ok('meta_app_secret', p_secret) THEN
    RETURN jsonb_build_object('ok',false,'error','INVALID_META_APP_SECRET');
  END IF;

  IF coalesce(trim(p_page_id),'')='' OR coalesce(trim(p_psid),'')='' THEN
    RETURN jsonb_build_object('ok',false,'error','PAGE_OR_PSID_REQUIRED');
  END IF;

  IF nullif(trim(coalesce(p_message_id,'')),'') IS NOT NULL THEN
    SELECT m.conversation_id,c.lead_id
    INTO v_conversation,v_lead
    FROM public.crm_facebook_messages m
    JOIN public.crm_facebook_conversations c ON c.id=m.conversation_id
    WHERE m.meta_message_id=p_message_id
    LIMIT 1;

    IF v_conversation IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok',true,'duplicate',true,'conversation_id',v_conversation,'lead_id',v_lead
      );
    END IF;
  END IF;

  v_phone:=regexp_replace(coalesce(p_phone,''),'\D','','g');
  IF v_phone ~ '^84[0-9]{9}$' THEN
    v_phone:='0'||substr(v_phone,3);
  END IF;
  IF v_phone !~ '^0[0-9]{9,10}$' THEN
    v_phone:='';
  END IF;

  INSERT INTO public.crm_facebook_conversations AS c(
    page_id,psid,sender_name,phone_detected,last_message_text,last_message_at,last_inbound_at,unread_count,updated_at
  )
  VALUES(
    trim(p_page_id),trim(p_psid),nullif(trim(coalesce(p_sender_name,'')),''),
    nullif(v_phone,''),nullif(left(coalesce(p_text,''),2000),''),
    coalesce(p_received_at,now()),coalesce(p_received_at,now()),1,now()
  )
  ON CONFLICT (page_id,psid) DO UPDATE
  SET sender_name=coalesce(nullif(excluded.sender_name,''),c.sender_name),
      phone_detected=coalesce(nullif(excluded.phone_detected,''),c.phone_detected),
      last_message_text=excluded.last_message_text,
      last_message_at=excluded.last_message_at,
      last_inbound_at=excluded.last_inbound_at,
      unread_count=c.unread_count+1,
      updated_at=now()
  RETURNING id,lead_id INTO v_conversation,v_lead;

  INSERT INTO public.crm_facebook_messages(
    conversation_id,meta_message_id,direction,message_type,text_content,payload,created_at
  )
  VALUES(
    v_conversation,nullif(trim(coalesce(p_message_id,'')),''),
    'inbound',coalesce(nullif(p_payload->>'message_type',''),'text'),
    nullif(left(coalesce(p_text,''),5000),''),
    coalesce(p_payload,'{}'::jsonb),coalesce(p_received_at,now())
  )
  ON CONFLICT DO NOTHING;

  IF v_phone<>'' THEN
    SELECT l.id INTO v_lead
    FROM public.leads l
    WHERE (CASE
      WHEN regexp_replace(l.phone,'\D','','g') ~ '^84[0-9]{9}$'
        THEN '0'||substr(regexp_replace(l.phone,'\D','','g'),3)
      ELSE regexp_replace(l.phone,'\D','','g')
    END)=v_phone
    LIMIT 1;

    IF v_lead IS NULL THEN
      v_name:=coalesce(
        nullif(trim(coalesce(p_sender_name,'')),''),
        'Khách Facebook '||right(trim(p_psid),4)
      );

      INSERT INTO public.leads(
        name,phone,email,source,need,budget,status,project,owner_id,notes,profile,last_contact_at
      )
      VALUES(
        v_name,v_phone,NULL,'Facebook',nullif(left(coalesce(p_text,''),1500),''),
        0,'new','Thiên Phúc Vĩnh Hằng Viên',NULL,
        'Tự động tạo từ hội thoại Fanpage',
        jsonb_build_object(
          'attribution',jsonb_build_object(
            'provider','facebook_messenger',
            'page_id',trim(p_page_id),
            'psid',trim(p_psid),
            'received_at',coalesce(p_received_at,now())
          )
        ),
        coalesce(p_received_at,now())
      )
      ON CONFLICT DO NOTHING
      RETURNING id INTO v_lead;

      IF v_lead IS NOT NULL THEN
        v_created_lead:=true;
      ELSE
        SELECT l.id INTO v_lead
        FROM public.leads l
        WHERE (CASE
          WHEN regexp_replace(l.phone,'\D','','g') ~ '^84[0-9]{9}$'
            THEN '0'||substr(regexp_replace(l.phone,'\D','','g'),3)
          ELSE regexp_replace(l.phone,'\D','','g')
        END)=v_phone
        LIMIT 1;
      END IF;
    ELSE
      UPDATE public.leads
      SET source=CASE WHEN source='Khác' THEN 'Facebook' ELSE source END,
          last_contact_at=greatest(coalesce(last_contact_at,'epoch'::timestamptz),coalesce(p_received_at,now())),
          profile=coalesce(profile,'{}'::jsonb)||jsonb_build_object(
            'facebook_messenger',jsonb_build_object(
              'page_id',trim(p_page_id),'psid',trim(p_psid),'last_inbound_at',coalesce(p_received_at,now())
            )
          ),
          updated_at=now()
      WHERE id=v_lead;
    END IF;

    UPDATE public.crm_facebook_conversations
    SET lead_id=v_lead,phone_detected=v_phone,updated_at=now()
    WHERE id=v_conversation;

    IF v_created_lead AND v_lead IS NOT NULL THEN
      SELECT owner_id INTO v_owner FROM public.leads WHERE id=v_lead;
      PERFORM public.crm_automation_event_internal(
        'lead_created',v_lead,NULL,v_owner,jsonb_build_object('source','Facebook','channel','messenger')
      );
      IF v_owner IS NOT NULL THEN
        PERFORM public.crm_automation_event_internal(
          'lead_assigned',v_lead,NULL,v_owner,jsonb_build_object('source','Facebook','channel','messenger')
        );
      END IF;
    END IF;
  ELSIF v_lead IS NOT NULL THEN
    UPDATE public.leads
    SET last_contact_at=greatest(coalesce(last_contact_at,'epoch'::timestamptz),coalesce(p_received_at,now())),
        updated_at=now()
    WHERE id=v_lead;
  END IF;

  RETURN jsonb_build_object(
    'ok',true,
    'duplicate',false,
    'conversation_id',v_conversation,
    'lead_id',v_lead,
    'created_lead',v_created_lead,
    'phone_detected',nullif(v_phone,'')
  );
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

  ELSIF p_action IN ('messages','mark_read','send_context','log_outbound') THEN
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
          'within_24h',v_row.last_inbound_at IS NOT NULL AND v_row.last_inbound_at>=now()-interval '24 hours'
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
        'within_24h',v_row.last_inbound_at IS NOT NULL AND v_row.last_inbound_at>=now()-interval '24 hours'
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

      UPDATE public.crm_facebook_conversations
      SET last_message_text=nullif(left(coalesce(p_payload->>'text',''),2000),''),
          last_message_at=now(),
          last_outbound_at=now(),
          updated_at=now()
      WHERE id=v_conversation;

      RETURN jsonb_build_object('ok',true,'conversation_id',v_conversation);
    END IF;
  END IF;

  RETURN jsonb_build_object('ok',false,'error','Hành động Fanpage không hợp lệ','code','BAD_ACTION');
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('ok',false,'error','Mã hội thoại không hợp lệ','code','BAD_REQUEST');
END
$function$;

REVOKE ALL ON public.crm_facebook_conversations FROM anonymous;
REVOKE ALL ON public.crm_facebook_messages FROM anonymous;

REVOKE EXECUTE ON FUNCTION public.crm_facebook_receive_v1(text,text,text,text,text,text,text,jsonb,timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_facebook_api_v1(text,text,jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.crm_facebook_receive_v1(text,text,text,text,text,text,text,jsonb,timestamptz) TO anonymous;
GRANT EXECUTE ON FUNCTION public.crm_facebook_api_v1(text,text,jsonb) TO anonymous;

NOTIFY pgrst, 'reload schema';
