-- PTM CRM · login capacity for 30 employees · 2026-09-14
-- Keep existing PBKDF2 accounts compatible, use bcrypt for new/reset passwords,
-- and transparently upgrade legacy hashes after a successful login.

CREATE OR REPLACE FUNCTION public.crm_verify_password(p_password text, p_encoded text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
STRICT
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  parts text[];
  iter integer;
  salt bytea;
  expected bytea;
  derived bytea;
BEGIN
  IF p_encoded LIKE '$2a$%' OR p_encoded LIKE '$2b$%' OR p_encoded LIKE '$2y$%' THEN
    RETURN crypt(p_password,p_encoded)=p_encoded;
  END IF;

  parts:=string_to_array(p_encoded,'$');
  IF array_length(parts,1)<>4 OR parts[1]<>'pbkdf2_sha256' THEN RETURN false; END IF;
  iter:=parts[2]::integer;
  salt:=public.crm_b64url_decode(parts[3]);
  expected:=public.crm_b64url_decode(parts[4]);
  derived:=public.crm_pbkdf2_sha256(p_password,salt,iter);
  RETURN derived=expected;
EXCEPTION WHEN others THEN
  RETURN false;
END
$function$;

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

  -- Successful legacy login: pay the PBKDF2 cost once, then upgrade to bcrypt.
  IF u.password_hash LIKE 'pbkdf2_sha256$%' THEN
    UPDATE public.users
    SET password_hash=crypt(coalesce(p_password,''),gen_salt('bf',10)),
        updated_at=now()
    WHERE id=u.id;
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

DO $migration$
BEGIN
  IF to_regprocedure('public.crm_save_user_pbkdf2_legacy(text,jsonb)') IS NULL
     AND to_regprocedure('public.crm_save_user_v2(text,jsonb)') IS NOT NULL THEN
    ALTER FUNCTION public.crm_save_user_v2(text,jsonb) RENAME TO crm_save_user_pbkdf2_legacy;
  END IF;
END
$migration$;

REVOKE ALL ON FUNCTION public.crm_save_user_pbkdf2_legacy(text,jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_save_user_pbkdf2_legacy(text,jsonb) FROM anonymous;
REVOKE EXECUTE ON FUNCTION public.crm_save_user_pbkdf2_legacy(text,jsonb) FROM authenticated;

CREATE OR REPLACE FUNCTION public.crm_save_user_v2(p_token text,p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_id uuid;
  v_password text:=coalesce(p_payload->>'password','');
BEGIN
  v_result:=public.crm_save_user_pbkdf2_legacy(p_token,p_payload);
  IF coalesce((v_result->>'ok')::boolean,false)=false THEN
    RETURN v_result;
  END IF;

  v_id:=nullif(v_result->>'id','')::uuid;
  IF v_id IS NOT NULL AND length(v_password)>0 THEN
    UPDATE public.users
    SET password_hash=crypt(v_password,gen_salt('bf',10)),
        updated_at=now()
    WHERE id=v_id;
  END IF;

  RETURN v_result || jsonb_build_object('password_scheme',CASE WHEN length(v_password)>0 THEN 'bcrypt' ELSE 'unchanged' END);
END
$function$;

REVOKE ALL ON FUNCTION public.crm_save_user_v2(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_save_user_v2(text,jsonb) TO anonymous;

INSERT INTO public.crm_schema_migrations(version,note)
VALUES (
  '20260914_login_capacity_bcrypt',
  'Use bcrypt for new/reset CRM passwords, keep PBKDF2 compatibility, auto-upgrade legacy hashes on successful login.'
)
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst,'reload schema';
