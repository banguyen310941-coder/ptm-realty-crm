-- PTM CRM app audit hardening · 2026-09-12
-- Fixes manager role mismatch, login brute-force guard, automation sweep rate limiting,
-- and removes unnecessary PUBLIC/anonymous execute privileges.

CREATE TABLE IF NOT EXISTS public.crm_login_guard (
  email_hash text PRIMARY KEY,
  failure_count integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.crm_login_guard FROM PUBLIC;
REVOKE ALL ON public.crm_login_guard FROM anonymous;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role = ANY (ARRAY['ceo'::text,'admin'::text,'manager'::text,'marketing'::text,'sale'::text,'accounting'::text]));

CREATE OR REPLACE FUNCTION public.crm_login(p_email text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  u public.users%ROWTYPE;
  raw_token text;
  v_email_hash text:=encode(digest(lower(trim(coalesce(p_email,''))),'sha256'),'hex');
  v_guard public.crm_login_guard%ROWTYPE;
  v_guard_found boolean:=false;
  v_failures integer;
BEGIN
  DELETE FROM public.crm_sessions WHERE expires_at<=now();
  DELETE FROM public.crm_login_guard WHERE updated_at<now()-interval '24 hours';

  SELECT * INTO v_guard
  FROM public.crm_login_guard
  WHERE email_hash=v_email_hash
  FOR UPDATE;
  v_guard_found:=FOUND;

  IF v_guard_found AND v_guard.locked_until IS NOT NULL AND v_guard.locked_until>now() THEN
    RETURN jsonb_build_object('ok',false,'error','Đăng nhập tạm thời bị giới hạn. Vui lòng thử lại sau vài phút.');
  END IF;

  SELECT * INTO u
  FROM public.users
  WHERE lower(email)=lower(trim(p_email))
    AND active=true
  LIMIT 1;

  IF u.id IS NULL OR NOT public.crm_verify_password(coalesce(p_password,''),u.password_hash) THEN
    IF NOT v_guard_found THEN
      INSERT INTO public.crm_login_guard(email_hash,failure_count,window_started_at,updated_at)
      VALUES(v_email_hash,1,now(),now())
      ON CONFLICT(email_hash) DO NOTHING;
      v_failures:=1;
    ELSE
      IF v_guard.window_started_at<now()-interval '15 minutes' THEN
        v_failures:=1;
        UPDATE public.crm_login_guard
        SET failure_count=1,window_started_at=now(),locked_until=NULL,updated_at=now()
        WHERE email_hash=v_email_hash;
      ELSE
        v_failures:=v_guard.failure_count+1;
        UPDATE public.crm_login_guard
        SET failure_count=v_failures,
            locked_until=CASE WHEN v_failures>=20 THEN now()+interval '5 minutes' ELSE locked_until END,
            updated_at=now()
        WHERE email_hash=v_email_hash;
      END IF;
    END IF;

    RETURN jsonb_build_object('ok',false,'error','Email hoặc mật khẩu không đúng');
  END IF;

  DELETE FROM public.crm_login_guard WHERE email_hash=v_email_hash;

  raw_token:=encode(gen_random_bytes(32),'hex');
  INSERT INTO public.crm_sessions(token_hash,user_id,expires_at)
  VALUES(encode(digest(raw_token,'sha256'),'hex'),u.id,now()+interval '7 days');

  RETURN jsonb_build_object(
    'ok',true,
    'token',raw_token,
    'user',jsonb_build_object('id',u.id,'name',u.name,'email',u.email,'role',u.role)
  );
END
$function$;

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
  v_role text:=coalesce(nullif(p_payload->>'role',''),'sale');
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
    v_hash:='pbkdf2_sha256$210000$'||rtrim(translate(replace(encode(v_salt,'base64'),chr(10),''),'+/','-_'),'=')||'$'||
      rtrim(translate(replace(encode(public.crm_pbkdf2_sha256(v_pw,v_salt,210000),'base64'),chr(10),''),'+/','-_'),'=');
    INSERT INTO public.users(
      name,email,password_hash,role,active,employee_code,phone,department,job_title,
      manager_id,start_date,work_location,internal_notes
    ) VALUES(
      v_name,v_email,v_hash,v_role,true,v_employee_code,v_phone,v_department,v_job_title,
      v_manager,v_start_date,v_work_location,v_notes
    ) RETURNING id INTO v_id;
    RETURN jsonb_build_object('ok',true,'id',v_id);
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
    v_hash:='pbkdf2_sha256$210000$'||rtrim(translate(replace(encode(v_salt,'base64'),chr(10),''),'+/','-_'),'=')||'$'||
      rtrim(translate(replace(encode(public.crm_pbkdf2_sha256(v_pw,v_salt,210000),'base64'),chr(10),''),'+/','-_'),'=');
  END IF;

  UPDATE public.users
  SET name=coalesce(v_name,name),email=coalesce(v_email,email),role=v_role,
      password_hash=coalesce(v_hash,password_hash),employee_code=v_employee_code,phone=v_phone,
      department=v_department,job_title=v_job_title,manager_id=v_manager,start_date=v_start_date,
      work_location=v_work_location,internal_notes=v_notes,updated_at=now()
  WHERE id=v_id;

  RETURN jsonb_build_object('ok',true,'id',v_id);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok',false,'error','Email hoặc mã nhân viên đã tồn tại');
END
$function$;

CREATE OR REPLACE FUNCTION public.crm_automation_sweep_v1(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_uid uuid;
  v_result jsonb;
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

  v_result:=public.crm_housekeeping_v1();
  RETURN coalesce(v_result,'{}'::jsonb) || jsonb_build_object('via','authenticated_sweep');
END
$function$;

-- The unauthenticated cron wrapper is disabled at DB level.
REVOKE EXECUTE ON FUNCTION public.crm_housekeeping_cron_v1() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_housekeeping_cron_v1() FROM anonymous;

-- This helper does not authenticate a CRM user and is not used by the app.
REVOKE EXECUTE ON FUNCTION public.crm_facebook_conversation_tags_json(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_facebook_conversation_tags_json(uuid) FROM anonymous;

-- Harden externally callable SECURITY DEFINER RPCs: no implicit PUBLIC execute.
REVOKE EXECUTE ON FUNCTION public.crm_accept_lead_offer(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_accept_lead_offer(text,uuid) TO anonymous;

REVOKE EXECUTE ON FUNCTION public.crm_attendance_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_attendance_status(text) TO anonymous;

REVOKE EXECUTE ON FUNCTION public.crm_automation_event_v1(text,text,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_automation_event_v1(text,text,uuid,uuid,jsonb) TO anonymous;

REVOKE EXECUTE ON FUNCTION public.crm_automation_sweep_v1(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_automation_sweep_v1(text) TO anonymous;

REVOKE EXECUTE ON FUNCTION public.crm_check_in(text,text,boolean,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_check_in(text,text,boolean,text,text,text) TO anonymous;

REVOKE EXECUTE ON FUNCTION public.crm_check_out(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_check_out(text) TO anonymous;

REVOKE EXECUTE ON FUNCTION public.crm_finance_api_v2(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_finance_api_v2(text,text,jsonb) TO anonymous;

REVOKE EXECUTE ON FUNCTION public.crm_integration_status_v1() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_integration_status_v1() TO anonymous;

REVOKE EXECUTE ON FUNCTION public.crm_lead_intake_v1(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_lead_intake_v1(text,jsonb) TO anonymous;

REVOKE EXECUTE ON FUNCTION public.crm_lead_offer_tick(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_lead_offer_tick(text) TO anonymous;

REVOKE EXECUTE ON FUNCTION public.crm_my_lead_offers(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_my_lead_offers(text) TO anonymous;

REVOKE EXECUTE ON FUNCTION public.crm_team_attendance(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_team_attendance(text) TO anonymous;

REVOKE EXECUTE ON FUNCTION public.crm_webhook_verify_v1(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_webhook_verify_v1(text,text) TO anonymous;

-- Internal helpers should never be directly callable via PUBLIC.
REVOKE EXECUTE ON FUNCTION public.crm_accounting_save_deal_v2(text,jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_bootstrap_v2(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_bootstrap_v3(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_sale_save_deal_v2(text,jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_save_user_v2(text,jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_toggle_user_v2(text,jsonb) FROM PUBLIC;

NOTIFY pgrst,'reload schema';
