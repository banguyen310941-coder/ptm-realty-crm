-- Server-side CRM housekeeping for lead-offer expiry and due follow-ups.
-- Designed for a stateless scheduler: no business input, advisory lock, and a 4-minute DB throttle.

CREATE TABLE IF NOT EXISTS public.crm_housekeeping_state (
  key text PRIMARY KEY,
  last_run timestamptz NOT NULL DEFAULT '1970-01-01 00:00:00+00',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.crm_housekeeping_state(key,last_run)
VALUES('automation','1970-01-01 00:00:00+00')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.crm_housekeeping_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_now timestamptz := now();
  v_last timestamptz;
  v_row record;
  v_count integer := 0;
  v_actions integer := 0;
  v_result jsonb;
  v_routing jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ptm-crm-housekeeping-v1'));

  SELECT last_run INTO v_last
  FROM public.crm_housekeeping_state
  WHERE key='automation'
  FOR UPDATE;

  IF v_last IS NOT NULL AND v_last > v_now - interval '4 minutes' THEN
    RETURN jsonb_build_object('ok',true,'skipped',true,'last_run',v_last);
  END IF;

  UPDATE public.crm_housekeeping_state
  SET last_run=v_now,updated_at=v_now
  WHERE key='automation';

  BEGIN
    v_routing := public.crm_process_expired_offers(v_now);
  EXCEPTION WHEN OTHERS THEN
    v_routing := jsonb_build_object('ok',false,'error',SQLERRM);
  END;

  FOR v_row IN
    SELECT id,owner_id
    FROM public.leads
    WHERE next_follow_up_at IS NOT NULL
      AND next_follow_up_at <= v_now
      AND status <> 'lost'
    ORDER BY next_follow_up_at
    LIMIT 200
  LOOP
    v_result := public.crm_automation_event_internal(
      'followup_due', v_row.id, NULL, v_row.owner_id, '{}'::jsonb
    );
    v_count := v_count + 1;
    v_actions := v_actions + coalesce((v_result->>'actions_run')::integer,0);
  END LOOP;

  RETURN jsonb_build_object(
    'ok',true,
    'skipped',false,
    'ran_at',v_now,
    'due_leads',v_count,
    'actions_run',v_actions,
    'lead_routing',v_routing
  );
END
$$;

REVOKE ALL ON FUNCTION public.crm_housekeeping_v1() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_housekeeping_v1() TO anonymous;
