-- PTM CRM · Data API RPC boundary hardening · 2026-09-13
-- Detailed integration status must validate the CRM session inside Postgres,
-- because the Neon Data API endpoint is directly reachable by clients.

CREATE OR REPLACE FUNCTION public.crm_integration_status_v2(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_role text;
BEGIN
  SELECT u.role INTO v_role
  FROM public.crm_sessions s
  JOIN public.users u ON u.id=s.user_id
  WHERE s.token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex')
    AND s.expires_at>now()
    AND u.active=true
  LIMIT 1;

  IF v_role IS NULL THEN
    RETURN jsonb_build_object(
      'ok',false,
      'error','Phiên đăng nhập đã hết hạn',
      'code','UNAUTHENTICATED'
    );
  END IF;

  IF v_role NOT IN ('admin','ceo','manager','marketing') THEN
    RETURN jsonb_build_object(
      'ok',false,
      'error','Bạn không có quyền xem trạng thái tích hợp hệ thống',
      'code','FORBIDDEN'
    );
  END IF;

  RETURN public.crm_integration_status_v1();
END
$function$;

-- Internal helpers are only invoked by SECURITY DEFINER wrappers.
REVOKE EXECUTE ON FUNCTION public.crm_integration_status_v1() FROM anonymous;
REVOKE EXECUTE ON FUNCTION public.crm_housekeeping_v1() FROM anonymous;

REVOKE ALL ON FUNCTION public.crm_integration_status_v2(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_integration_status_v2(text) TO anonymous;

NOTIFY pgrst,'reload schema';
