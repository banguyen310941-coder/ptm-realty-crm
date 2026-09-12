-- PTM CRM · lead intake identity hardening
CREATE OR REPLACE FUNCTION public.crm_lead_intake_v1(
  p_secret text,
  p_lead jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_id uuid;
  v_phone_id uuid;
  v_email_id uuid;
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
  v_matched_by text;
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

  SELECT id INTO v_phone_id
  FROM public.leads
  WHERE (
    CASE
      WHEN regexp_replace(phone,'\D','','g') ~ '^84[0-9]{9}$'
        THEN '0'||substr(regexp_replace(phone,'\D','','g'),3)
      ELSE regexp_replace(phone,'\D','','g')
    END
  )=v_phone_key
  LIMIT 1;

  IF v_email<>'' THEN
    SELECT id INTO v_email_id
    FROM public.leads
    WHERE lower(trim(coalesce(email,'')))=lower(v_email)
    LIMIT 1;
  END IF;

  IF v_phone_id IS NOT NULL AND v_email_id IS NOT NULL AND v_phone_id<>v_email_id THEN
    RETURN jsonb_build_object(
      'ok',false,
      'error','IDENTITY_CONFLICT',
      'code','IDENTITY_CONFLICT',
      'message','SĐT và email đang thuộc hai khách khác nhau; cần kiểm tra trước khi ghép.'
    );
  END IF;

  v_id:=coalesce(v_phone_id,v_email_id);

  IF v_id IS NOT NULL THEN
    v_duplicate:=true;
    v_matched_by:=CASE
      WHEN v_phone_id IS NOT NULL AND v_email_id IS NOT NULL THEN 'phone_email'
      WHEN v_phone_id IS NOT NULL THEN 'phone'
      ELSE 'email'
    END;

    UPDATE public.leads
    SET
      name=CASE
        WHEN v_name<>'' AND (trim(coalesce(name,''))='' OR name ~ '^Khách [0-9]{4}$')
          THEN v_name
        ELSE name
      END,
      email=coalesce(nullif(trim(email),''),nullif(v_email,'')),
      source=CASE WHEN nullif(trim(source),'') IS NULL OR source='Khác' THEN v_source ELSE source END,
      need=coalesce(nullif(trim(need),''),nullif(v_need,'')),
      budget=CASE WHEN coalesce(budget,0)=0 THEN v_budget ELSE budget END,
      project=coalesce(nullif(trim(project),''),nullif(v_project,'')),
      notes=coalesce(nullif(trim(notes),''),nullif(v_notes,'')),
      profile=coalesce(profile,'{}'::jsonb)||v_profile,
      updated_at=now()
    WHERE id=v_id
    RETURNING owner_id,current_offer_id INTO v_owner,v_offer;
  ELSE
    BEGIN
      INSERT INTO public.leads(name,phone,email,source,need,budget,status,project,owner_id,notes,profile)
      VALUES(
        coalesce(nullif(v_name,''),'Khách '||right(v_phone_key,4)),
        v_phone,nullif(v_email,''),v_source,nullif(v_need,''),v_budget,'new',
        nullif(v_project,''),NULL,nullif(v_notes,''),v_profile
      )
      RETURNING id,owner_id,current_offer_id INTO v_id,v_owner,v_offer;

      PERFORM public.crm_automation_event_internal(
        'lead_created',v_id,NULL,v_owner,jsonb_build_object('source',v_source)
      );
      IF v_owner IS NOT NULL THEN
        PERFORM public.crm_automation_event_internal(
          'lead_assigned',v_id,NULL,v_owner,jsonb_build_object('source',v_source)
        );
      END IF;
    EXCEPTION WHEN unique_violation THEN
      SELECT id,owner_id,current_offer_id INTO v_id,v_owner,v_offer
      FROM public.leads
      WHERE (
        CASE
          WHEN regexp_replace(phone,'\D','','g') ~ '^84[0-9]{9}$'
            THEN '0'||substr(regexp_replace(phone,'\D','','g'),3)
          ELSE regexp_replace(phone,'\D','','g')
        END
      )=v_phone_key
      OR (v_email<>'' AND lower(trim(coalesce(email,'')))=lower(v_email))
      ORDER BY CASE WHEN (
        CASE
          WHEN regexp_replace(phone,'\D','','g') ~ '^84[0-9]{9}$'
            THEN '0'||substr(regexp_replace(phone,'\D','','g'),3)
          ELSE regexp_replace(phone,'\D','','g')
        END
      )=v_phone_key THEN 0 ELSE 1 END
      LIMIT 1;

      IF v_id IS NULL THEN RAISE; END IF;
      v_duplicate:=true;
      v_matched_by:='concurrent';
    END;
  END IF;

  RETURN jsonb_build_object(
    'ok',true,
    'lead_id',v_id,
    'duplicate',v_duplicate,
    'matched_by',coalesce(v_matched_by,'new'),
    'source',v_source,
    'assigned',v_owner IS NOT NULL,
    'offer_pending',v_offer IS NOT NULL
  );
END
$function$;

REVOKE ALL ON FUNCTION public.crm_lead_intake_v1(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_lead_intake_v1(text,jsonb) TO anonymous;
NOTIFY pgrst,'reload schema';
