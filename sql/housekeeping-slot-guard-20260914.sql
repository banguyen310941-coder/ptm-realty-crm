-- PTM CRM · public housekeeping trigger hardening · 2026-09-14
-- The public tick is required by the GitHub OIDC -> Vercel route because the
-- server currently uses the anonymous Neon Data API role. Make direct calls
-- operationally harmless: exactly one claim per five-minute wall-clock slot.

CREATE TABLE IF NOT EXISTS public.crm_housekeeping_tick_slots (
  slot bigint PRIMARY KEY,
  claimed_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE public.crm_housekeeping_tick_slots FROM PUBLIC;
REVOKE ALL ON TABLE public.crm_housekeeping_tick_slots FROM anonymous;
REVOKE ALL ON TABLE public.crm_housekeeping_tick_slots FROM authenticated;

CREATE OR REPLACE FUNCTION public.crm_housekeeping_tick_v2()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_slot bigint:=floor(extract(epoch from clock_timestamp())/300)::bigint;
  v_claimed integer:=0;
  v_result jsonb;
BEGIN
  INSERT INTO public.crm_housekeeping_tick_slots(slot)
  VALUES(v_slot)
  ON CONFLICT(slot) DO NOTHING;
  GET DIAGNOSTICS v_claimed = ROW_COUNT;

  IF v_claimed=0 THEN
    RETURN jsonb_build_object('ok',true,'skipped','duplicate_slot');
  END IF;

  DELETE FROM public.crm_housekeeping_tick_slots
  WHERE slot < v_slot-288;

  v_result:=public.crm_housekeeping_cron_v1();

  RETURN jsonb_build_object(
    'ok',coalesce((v_result->>'ok')::boolean,false),
    'skipped',v_result->'skipped',
    'ran_at',v_result->'ran_at'
  );
END
$function$;

REVOKE ALL ON FUNCTION public.crm_housekeeping_tick_v2() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_housekeeping_tick_v2() TO anonymous;
REVOKE EXECUTE ON FUNCTION public.crm_housekeeping_tick_v2() FROM authenticated;

INSERT INTO public.crm_schema_migrations(version,note)
VALUES (
  '20260914_housekeeping_slot_guard',
  'Public housekeeping tick is limited to one execution claim per five-minute wall-clock slot.'
)
ON CONFLICT(version) DO NOTHING;

NOTIFY pgrst,'reload schema';
