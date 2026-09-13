-- PTM CRM · protect detailed integration status · 2026-09-13

CREATE OR REPLACE FUNCTION public.crm_auth_context_v1(p_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
SELECT CASE
  WHEN u.id IS NULL THEN jsonb_build_object(
    'ok',false,
    'error','Phiên đăng nhập đã hết hạn',
    'code','UNAUTHENTICATED'
  )
  ELSE jsonb_build_object(
    'ok',true,
    'user',jsonb_build_object(
      'id',u.id,
      'name',u.name,
      'email',u.email,
      'role',u.role
    )
  )
END
FROM (SELECT 1) z
LEFT JOIN LATERAL (
  SELECT usr.id,usr.name,usr.email,usr.role
  FROM public.crm_sessions s
  JOIN public.users usr ON usr.id=s.user_id
  WHERE s.token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex')
    AND s.expires_at>now()
    AND usr.active=true
  LIMIT 1
) u ON true
$function$;

REVOKE ALL ON FUNCTION public.crm_auth_context_v1(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_auth_context_v1(text) TO anonymous;
NOTIFY pgrst,'reload schema';
