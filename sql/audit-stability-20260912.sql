-- PTM CRM · stability audit fixes · 2026-09-12
-- Restores scheduled housekeeping through a narrowly scoped, rate-limited tick.

CREATE OR REPLACE FUNCTION public.crm_housekeeping_tick_v2()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  v_result:=public.crm_housekeeping_cron_v1();
  RETURN jsonb_build_object(
    'ok',coalesce((v_result->>'ok')::boolean,false),
    'skipped',v_result->'skipped',
    'ran_at',v_result->'ran_at'
  );
END
$function$;

REVOKE EXECUTE ON FUNCTION public.crm_housekeeping_tick_v2() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_housekeeping_tick_v2() TO anonymous;

CREATE OR REPLACE FUNCTION public.crm_integration_status_v1()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
WITH housekeeping AS (
  SELECT max(created_at) last_run
  FROM public.activity_log
  WHERE action='housekeeping_cron'
    AND entity_type='system'
    AND entity_id='ptm-crm'
)
SELECT jsonb_build_object(
  'ok',true,
  'database',true,
  'lead_webhook',EXISTS(SELECT 1 FROM public.crm_integration_config WHERE key='lead_webhook' AND enabled=true),
  'email',EXISTS(SELECT 1 FROM public.crm_integration_config WHERE key='email' AND enabled=true),
  'zalo',EXISTS(SELECT 1 FROM public.crm_integration_config WHERE key='zalo' AND enabled=true),
  'facebook_verify',EXISTS(SELECT 1 FROM public.crm_integration_config WHERE key='meta_verify' AND enabled=true),
  'housekeeping_last_run',(SELECT last_run FROM housekeeping),
  'housekeeping_healthy',coalesce((SELECT last_run>now()-interval '15 minutes' FROM housekeeping),false),
  'providers',jsonb_build_object(
    'website',true,'facebook',true,'tiktok',true,'zalo',true,'google',true,'hotline',true
  )
)
$function$;

NOTIFY pgrst,'reload schema';
