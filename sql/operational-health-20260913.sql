-- PTM CRM · operational health accuracy
-- Housekeeping can run from authenticated CRM sweeps or the external scheduler.
-- Report both separately so monitoring is truthful.

CREATE OR REPLACE FUNCTION public.crm_integration_status_v1()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
WITH actual AS (
  SELECT last_run
  FROM public.crm_housekeeping_state
  WHERE key='automation'
  LIMIT 1
),
scheduler AS (
  SELECT max(created_at) last_run
  FROM public.activity_log
  WHERE action='housekeeping_cron'
    AND entity_type='system'
    AND entity_id='ptm-crm'
)
SELECT jsonb_build_object(
  'ok',true,
  'database',true,
  'lead_webhook',EXISTS(
    SELECT 1 FROM public.crm_integration_config
    WHERE key='lead_webhook' AND enabled=true
  ),
  'email',EXISTS(
    SELECT 1 FROM public.crm_integration_config
    WHERE key='email' AND enabled=true
  ),
  'zalo',EXISTS(
    SELECT 1 FROM public.crm_integration_config
    WHERE key='zalo' AND enabled=true
  ),
  'facebook_verify',EXISTS(
    SELECT 1 FROM public.crm_integration_config
    WHERE key='meta_verify' AND enabled=true
  ),
  'housekeeping_mode','hybrid',
  'housekeeping_last_run',coalesce(
    (SELECT last_run FROM actual),
    (SELECT last_run FROM scheduler)
  ),
  'housekeeping_healthy',coalesce(
    (SELECT last_run>now()-interval '15 minutes' FROM actual),
    (SELECT last_run>now()-interval '15 minutes' FROM scheduler),
    false
  ),
  'scheduler_last_run',(SELECT last_run FROM scheduler),
  'scheduler_healthy',coalesce(
    (SELECT last_run>now()-interval '15 minutes' FROM scheduler),
    false
  ),
  'providers',jsonb_build_object(
    'website',true,
    'facebook',true,
    'tiktok',true,
    'zalo',true,
    'google',true,
    'hotline',true
  )
)
$function$;

REVOKE ALL ON FUNCTION public.crm_integration_status_v1() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_integration_status_v1() TO anonymous;
NOTIFY pgrst,'reload schema';
