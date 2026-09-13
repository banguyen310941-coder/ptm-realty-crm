-- PTM CRM · auth/session + housekeeping hardening · 2026-09-13

CREATE OR REPLACE FUNCTION public.crm_save_user_v2(p_token text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_admin uuid;
  v_id uuid:=nullif(p_payload->>'id','')::uuid;
  v_name text:=nullif(trim(p_payload->>'name'),'');
  v_email text:=nullif(lower(trim(p_payload->>'email')),'');
  v_role text:=nullif(p_payload->>'role','');
  v_current_role text;
  v_pw text:=coalesce(p_payload->>'password','');
  v_employee_code text:=nullif(trim(p_payload->>'employee_code'),'');
  v_phone text:=nullif(trim(p_payload->>'phone'),'');
  v_department text:=nullif(trim(p_payload->>'department'),'');
  v_job_title text:=nullif(trim(p_payload->>'job_title'),'');
  v_manager uuid:=nullif(p_payload->>'manager_id','')::uuid;
  v_start_date date:=nullif(p_payload->>'start_date','')::date;
  v_work_location text:=nullif(trim(p_payload->>'work_location'),'');
  v_notes text:=nullif(trim(p_payload->>'internal_notes'),'');
  v_salt bytea;
  v_hash text;
  v_revoked integer:=0;
BEGIN
  SELECT u.id INTO v_admin
  FROM public.crm_sessions s
  JOIN public.users u ON u.id=s.user_id
  WHERE s.token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex')
    AND s.expires_at>now()
    AND u.active=true
    AND u.role='admin'
  LIMIT 1;

  IF v_admin IS NULL THEN RETURN jsonb_build_object('ok',false,'error','Chỉ Admin được quản lý tài khoản'); END IF;

  IF v_id IS NULL THEN
    v_role:=coalesce(v_role,'sale');
  ELSE
    SELECT role INTO v_current_role FROM public.users WHERE id=v_id;
    IF v_current_role IS NULL THEN
      RETURN jsonb_build_object('ok',false,'error','Không tìm thấy tài khoản');
    END IF;
    v_role:=coalesce(v_role,v_current_role);
  END IF;

  IF v_role NOT IN ('ceo','admin','manager','marketing','sale','accounting') THEN
    RETURN jsonb_build_object('ok',false,'error','Vai trò không hợp lệ');
  END IF;

  IF v_employee_code IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.users u
    WHERE lower(trim(u.employee_code))=lower(v_employee_code)
      AND (v_id IS NULL OR u.id<>v_id)
  ) THEN RETURN jsonb_build_object('ok',false,'error','Mã nhân viên đã tồn tại'); END IF;

  IF v_manager IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.users u WHERE u.id=v_manager AND u.active=true
  ) THEN RETURN jsonb_build_object('ok',false,'error','Quản lý trực tiếp không tồn tại hoặc đã bị khóa'); END IF;

  IF v_id IS NULL THEN
    IF v_name IS NULL OR v_email IS NULL THEN RETURN jsonb_build_object('ok',false,'error','Tên và email là bắt buộc'); END IF;
    IF length(v_pw)<8 THEN RETURN jsonb_build_object('ok',false,'error','Mật khẩu mới phải có ít nhất 8 ký tự'); END IF;

    v_salt:=gen_random_bytes(16);
    v_hash:='pbkdf2_sha256$210000$'
      ||rtrim(translate(replace(encode(v_salt,'base64'),chr(10),''),'+/','-_'),'=')
      ||'$'
      ||rtrim(translate(replace(encode(public.crm_pbkdf2_sha256(v_pw,v_salt,210000),'base64'),chr(10),''),'+/','-_'),'=');

    INSERT INTO public.users(
      name,email,password_hash,role,active,employee_code,phone,department,job_title,
      manager_id,start_date,work_location,internal_notes
    ) VALUES(
      v_name,v_email,v_hash,v_role,true,v_employee_code,v_phone,v_department,v_job_title,
      v_manager,v_start_date,v_work_location,v_notes
    )
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('ok',true,'id',v_id,'sessions_revoked',0);
  END IF;

  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=v_id) THEN
    RETURN jsonb_build_object('ok',false,'error','Không tìm thấy tài khoản');
  END IF;
  IF v_id=v_admin AND v_role<>'admin' THEN
    RETURN jsonb_build_object('ok',false,'error','Admin không thể tự hạ quyền tài khoản đang đăng nhập');
  END IF;
  IF v_manager=v_id THEN
    RETURN jsonb_build_object('ok',false,'error','Nhân viên không thể là quản lý trực tiếp của chính mình');
  END IF;
  IF length(v_pw)>0 AND length(v_pw)<8 THEN
    RETURN jsonb_build_object('ok',false,'error','Mật khẩu mới phải có ít nhất 8 ký tự');
  END IF;

  IF length(v_pw)>0 THEN
    v_salt:=gen_random_bytes(16);
    v_hash:='pbkdf2_sha256$210000$'
      ||rtrim(translate(replace(encode(v_salt,'base64'),chr(10),''),'+/','-_'),'=')
      ||'$'
      ||rtrim(translate(replace(encode(public.crm_pbkdf2_sha256(v_pw,v_salt,210000),'base64'),chr(10),''),'+/','-_'),'=');
  END IF;

  UPDATE public.users
  SET name=coalesce(v_name,name),
      email=coalesce(v_email,email),
      role=v_role,
      password_hash=coalesce(v_hash,password_hash),
      employee_code=v_employee_code,
      phone=v_phone,
      department=v_department,
      job_title=v_job_title,
      manager_id=v_manager,
      start_date=v_start_date,
      work_location=v_work_location,
      internal_notes=v_notes,
      updated_at=now()
  WHERE id=v_id;

  IF length(v_pw)>0 THEN
    DELETE FROM public.crm_sessions WHERE user_id=v_id;
    GET DIAGNOSTICS v_revoked = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok',true,
    'id',v_id,
    'sessions_revoked',v_revoked,
    'reauth_required',length(v_pw)>0
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok',false,'error','Email hoặc mã nhân viên đã tồn tại');
END
$function$;

CREATE OR REPLACE FUNCTION public.crm_toggle_user_v2(p_token text, p_payload jsonb)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
WITH cu AS (
  SELECT u.id
  FROM public.crm_sessions s
  JOIN public.users u ON u.id=s.user_id
  WHERE s.token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex')
    AND s.expires_at>now()
    AND u.active=true
    AND u.role='admin'
  LIMIT 1
),
inp AS (
  SELECT nullif(p_payload->>'id','')::uuid id
),
upd AS (
  UPDATE public.users u
  SET active=NOT u.active,updated_at=now()
  FROM inp,cu
  WHERE u.id=inp.id
    AND u.id<>cu.id
  RETURNING u.id,u.active
),
revoked AS (
  DELETE FROM public.crm_sessions s
  USING upd u
  WHERE s.user_id=u.id
    AND u.active=false
  RETURNING s.token_hash
)
SELECT CASE
  WHEN NOT EXISTS(SELECT 1 FROM cu)
    THEN jsonb_build_object('ok',false,'error','Chỉ Admin được khóa/mở tài khoản')
  WHEN (SELECT id FROM inp)=(SELECT id FROM cu)
    THEN jsonb_build_object('ok',false,'error','Không thể tự khóa tài khoản đang đăng nhập')
  WHEN EXISTS(SELECT 1 FROM upd)
    THEN jsonb_build_object(
      'ok',true,
      'id',(SELECT id FROM upd LIMIT 1),
      'active',(SELECT active FROM upd LIMIT 1),
      'sessions_revoked',(SELECT count(*) FROM revoked)
    )
  ELSE jsonb_build_object('ok',false,'error','Không tìm thấy tài khoản')
END
$function$;

CREATE OR REPLACE FUNCTION public.crm_housekeeping_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_now timestamptz:=now();
  v_last timestamptz;
  v_row record;
  v_count integer:=0;
  v_actions integer:=0;
  v_sessions integer:=0;
  v_guards integer:=0;
  v_result jsonb;
  v_routing jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ptm-crm-housekeeping-v1'));

  SELECT last_run INTO v_last
  FROM public.crm_housekeeping_state
  WHERE key='automation'
  FOR UPDATE;

  IF v_last IS NOT NULL AND v_last > v_now - interval '4 minutes' THEN
    RETURN jsonb_build_object('ok',true,'skipped',true,'last_run',v_last);
  END IF;

  UPDATE public.crm_housekeeping_state
  SET last_run=v_now,updated_at=v_now
  WHERE key='automation';

  DELETE FROM public.crm_sessions WHERE expires_at<=v_now;
  GET DIAGNOSTICS v_sessions = ROW_COUNT;

  DELETE FROM public.crm_login_guard WHERE updated_at<v_now-interval '24 hours';
  GET DIAGNOSTICS v_guards = ROW_COUNT;

  BEGIN
    v_routing:=public.crm_process_expired_offers(v_now);
  EXCEPTION WHEN OTHERS THEN
    v_routing:=jsonb_build_object('ok',false,'error',SQLERRM);
  END;

  FOR v_row IN
    SELECT id,owner_id
    FROM public.leads
    WHERE next_follow_up_at IS NOT NULL
      AND next_follow_up_at<=v_now
      AND status<>'lost'
    ORDER BY next_follow_up_at
    LIMIT 200
  LOOP
    v_result:=public.crm_automation_event_internal(
      'followup_due',v_row.id,NULL,v_row.owner_id,'{}'::jsonb
    );
    v_count:=v_count+1;
    v_actions:=v_actions+coalesce((v_result->>'actions_run')::integer,0);
  END LOOP;

  RETURN jsonb_build_object(
    'ok',true,
    'skipped',false,
    'ran_at',v_now,
    'due_leads',v_count,
    'actions_run',v_actions,
    'expired_sessions_removed',v_sessions,
    'old_login_guards_removed',v_guards,
    'lead_routing',v_routing
  );
END
$function$;

CREATE INDEX IF NOT EXISTS leads_next_follow_up_due_idx
  ON public.leads(next_follow_up_at)
  WHERE next_follow_up_at IS NOT NULL AND status<>'lost';

CREATE INDEX IF NOT EXISTS activity_log_health_idx
  ON public.activity_log(action,entity_type,entity_id,created_at DESC);

REVOKE ALL ON FUNCTION public.crm_save_user_v2(text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_toggle_user_v2(text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_housekeeping_v1() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.crm_save_user_v2(text,jsonb) TO anonymous;
GRANT EXECUTE ON FUNCTION public.crm_toggle_user_v2(text,jsonb) TO anonymous;
GRANT EXECUTE ON FUNCTION public.crm_housekeeping_v1() TO anonymous;

NOTIFY pgrst,'reload schema';
