-- PTM CRM · lightweight session lookup · 2026-09-14
-- Used by the HttpOnly-cookie session endpoint. Avoids loading full CRM bootstrap
-- just to determine whether a browser session is still valid.

CREATE OR REPLACE FUNCTION public.crm_session_user_v1(p_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
WITH cu AS (
  SELECT u.id,u.name,u.email,u.role
  FROM public.crm_sessions s
  JOIN public.users u ON u.id=s.user_id
  WHERE s.token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex')
    AND s.expires_at>now()
    AND u.active=true
  LIMIT 1
)
SELECT coalesce(
  (
    SELECT jsonb_build_object(
      'ok',true,
      'user',jsonb_build_object(
        'id',cu.id,
        'name',cu.name,
        'email',cu.email,
        'role',cu.role
      )
    )
    FROM cu
  ),
  jsonb_build_object('ok',false,'error','UNAUTHENTICATED','code','UNAUTHENTICATED')
)
$function$;

REVOKE ALL ON FUNCTION public.crm_session_user_v1(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_session_user_v1(text) TO anonymous;
REVOKE EXECUTE ON FUNCTION public.crm_session_user_v1(text) FROM authenticated;

INSERT INTO public.crm_schema_migrations(version,note)
VALUES (
  '20260914_lightweight_session_user',
  'Add lightweight token-to-user lookup for HttpOnly cookie session restore.'
)
ON CONFLICT(version) DO NOTHING;

NOTIFY pgrst,'reload schema';
