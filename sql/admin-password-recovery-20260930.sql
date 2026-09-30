-- PTM CRM · Admin password recovery · 2026-09-30
-- One-time recovery codes for the active Admin account.
-- Codes are stored only as bcrypt hashes, expire after 180 days, and are invalidated after use.

CREATE TABLE IF NOT EXISTS public.crm_admin_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE INDEX IF NOT EXISTS crm_admin_recovery_codes_active_idx
ON public.crm_admin_recovery_codes(user_id,created_at DESC)
WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS public.crm_admin_recovery_guard (
  email_hash text PRIMARY KEY,
  failure_count integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE public.crm_admin_recovery_codes FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON TABLE public.crm_admin_recovery_guard FROM PUBLIC, anonymous, authenticated;

CREATE OR REPLACE FUNCTION public.crm_admin_recovery_issue(
  p_token text,
  p_current_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  u public.users%ROWTYPE;
  v_raw text;
  v_code text;
  v_expires timestamptz:=now()+interval '180 days';
BEGIN
  SELECT usr.*
  INTO u
  FROM public.crm_sessions s
  JOIN public.users usr ON usr.id=s.user_id
  WHERE s.token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex')
    AND s.expires_at>now()
    AND usr.active=true
  LIMIT 1;

  IF u.id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','UNAUTHENTICATED','code','UNAUTHENTICATED');
  END IF;

  IF u.role<>'admin' THEN
    RETURN jsonb_build_object('ok',false,'error','Chỉ Admin được tạo mã khôi phục.','code','FORBIDDEN');
  END IF;

  IF NOT public.crm_verify_password(coalesce(p_current_password,''),u.password_hash) THEN
    RETURN jsonb_build_object('ok',false,'error','Mật khẩu hiện tại không đúng.','code','INVALID_CURRENT_PASSWORD');
  END IF;

  UPDATE public.crm_admin_recovery_codes
  SET used_at=now()
  WHERE user_id=u.id
    AND used_at IS NULL;

  v_raw:=upper(encode(gen_random_bytes(10),'hex'));
  v_code:='PTM-'||
    substr(v_raw,1,5)||'-'||
    substr(v_raw,6,5)||'-'||
    substr(v_raw,11,5)||'-'||
    substr(v_raw,16,5);

  INSERT INTO public.crm_admin_recovery_codes(user_id,code_hash,expires_at)
  VALUES(u.id,crypt(v_code,gen_salt('bf',10)),v_expires);

  INSERT INTO public.activity_log(user_id,action,entity_type,entity_id,detail)
  VALUES(u.id,'admin_recovery_code_issued','user',u.id::text,'Admin generated a new one-time recovery code.');

  RETURN jsonb_build_object(
    'ok',true,
    'recovery_code',v_code,
    'expires_at',v_expires
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.crm_admin_recovery_reset(
  p_email text,
  p_recovery_code text,
  p_new_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  u public.users%ROWTYPE;
  v_code_id uuid;
  v_email_hash text:=encode(digest(lower(trim(coalesce(p_email,''))),'sha256'),'hex');
  v_guard public.crm_admin_recovery_guard%ROWTYPE;
  v_guard_found boolean:=false;
  v_failures integer:=0;
BEGIN
  DELETE FROM public.crm_admin_recovery_guard
  WHERE updated_at<now()-interval '24 hours';

  SELECT *
  INTO v_guard
  FROM public.crm_admin_recovery_guard
  WHERE email_hash=v_email_hash
  FOR UPDATE;
  v_guard_found:=FOUND;

  IF v_guard_found
     AND v_guard.locked_until IS NOT NULL
     AND v_guard.locked_until>now() THEN
    RETURN jsonb_build_object(
      'ok',false,
      'error','Khôi phục đang tạm khóa do nhập sai nhiều lần. Vui lòng thử lại sau.',
      'code','RECOVERY_LOCKED'
    );
  END IF;

  IF length(coalesce(p_new_password,''))<10
     OR length(coalesce(p_new_password,''))>128 THEN
    RETURN jsonb_build_object(
      'ok',false,
      'error','Mật khẩu mới phải từ 10 đến 128 ký tự.',
      'code','WEAK_PASSWORD'
    );
  END IF;

  SELECT *
  INTO u
  FROM public.users
  WHERE lower(email)=lower(trim(coalesce(p_email,'')))
    AND role='admin'
    AND active=true
  LIMIT 1;

  IF u.id IS NOT NULL THEN
    SELECT rc.id
    INTO v_code_id
    FROM public.crm_admin_recovery_codes rc
    WHERE rc.user_id=u.id
      AND rc.used_at IS NULL
      AND rc.expires_at>now()
      AND crypt(trim(coalesce(p_recovery_code,'')),rc.code_hash)=rc.code_hash
    ORDER BY rc.created_at DESC
    LIMIT 1;
  END IF;

  IF u.id IS NULL OR v_code_id IS NULL THEN
    IF NOT v_guard_found THEN
      INSERT INTO public.crm_admin_recovery_guard(email_hash,failure_count,window_started_at,updated_at)
      VALUES(v_email_hash,1,now(),now())
      ON CONFLICT(email_hash) DO NOTHING;
    ELSE
      IF v_guard.window_started_at<now()-interval '15 minutes' THEN
        v_failures:=1;
        UPDATE public.crm_admin_recovery_guard
        SET failure_count=1,
            window_started_at=now(),
            locked_until=NULL,
            updated_at=now()
        WHERE email_hash=v_email_hash;
      ELSE
        v_failures:=v_guard.failure_count+1;
        UPDATE public.crm_admin_recovery_guard
        SET failure_count=v_failures,
            locked_until=CASE WHEN v_failures>=5 THEN now()+interval '15 minutes' ELSE locked_until END,
            updated_at=now()
        WHERE email_hash=v_email_hash;
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'ok',false,
      'error','Email Admin hoặc mã khôi phục không đúng.',
      'code','RECOVERY_INVALID'
    );
  END IF;

  UPDATE public.users
  SET password_hash=crypt(p_new_password,gen_salt('bf',10)),
      updated_at=now()
  WHERE id=u.id;

  UPDATE public.crm_admin_recovery_codes
  SET used_at=now()
  WHERE id=v_code_id;

  DELETE FROM public.crm_sessions
  WHERE user_id=u.id;

  DELETE FROM public.crm_login_guard
  WHERE email_hash=v_email_hash;

  DELETE FROM public.crm_admin_recovery_guard
  WHERE email_hash=v_email_hash;

  INSERT INTO public.activity_log(user_id,action,entity_type,entity_id,detail)
  VALUES(u.id,'admin_password_recovered','user',u.id::text,'Admin password reset using a one-time recovery code; existing sessions revoked.');

  RETURN jsonb_build_object(
    'ok',true,
    'message','Đã đặt lại mật khẩu Admin. Mã khôi phục vừa dùng đã bị vô hiệu.'
  );
END
$function$;

REVOKE ALL ON FUNCTION public.crm_admin_recovery_issue(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_admin_recovery_issue(text,text) TO anonymous;
REVOKE EXECUTE ON FUNCTION public.crm_admin_recovery_issue(text,text) FROM authenticated;

REVOKE ALL ON FUNCTION public.crm_admin_recovery_reset(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_admin_recovery_reset(text,text,text) TO anonymous;
REVOKE EXECUTE ON FUNCTION public.crm_admin_recovery_reset(text,text,text) FROM authenticated;

INSERT INTO public.crm_schema_migrations(version,note)
VALUES (
  '20260930_admin_password_recovery',
  'One-time Admin recovery codes with bcrypt hashing, expiry, rate limiting, and session revocation.'
)
ON CONFLICT(version) DO NOTHING;

NOTIFY pgrst,'reload schema';
