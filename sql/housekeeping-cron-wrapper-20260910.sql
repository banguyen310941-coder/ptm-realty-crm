-- Safe public wrapper for scheduled CRM housekeeping.
-- Keeps crm_housekeeping_v1 private while allowing the external scheduler
-- to trigger it at most once every four minutes.

create or replace function public.crm_housekeeping_cron_v1()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_last_run timestamptz;
  v_result jsonb;
begin
  if not pg_try_advisory_xact_lock(7300910) then
    return jsonb_build_object('ok', true, 'skipped', 'busy');
  end if;

  select max(created_at)
    into v_last_run
  from public.activity_log
  where action = 'housekeeping_cron'
    and entity_type = 'system'
    and entity_id = 'ptm-crm';

  if v_last_run is not null and v_last_run > now() - interval '4 minutes' then
    return jsonb_build_object(
      'ok', true,
      'skipped', 'rate_limited',
      'last_run_at', v_last_run
    );
  end if;

  v_result := public.crm_housekeeping_v1();

  insert into public.activity_log(user_id, action, entity_type, entity_id, detail)
  values (
    null,
    'housekeeping_cron',
    'system',
    'ptm-crm',
    left(coalesce(v_result::text, '{}'), 2000)
  );

  return coalesce(v_result, '{}'::jsonb)
    || jsonb_build_object('cron', true, 'ran_at', now());
end
$$;

revoke all on function public.crm_housekeeping_cron_v1() from public, authenticated;
grant execute on function public.crm_housekeeping_cron_v1() to anonymous;
