-- PTM CRM · 30-seat readiness baseline · 2026-09-14
-- Safe, idempotent production hardening for the employee rollout.

CREATE TABLE IF NOT EXISTS public.crm_schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now(),
  note text
);

REVOKE ALL ON TABLE public.crm_schema_migrations FROM PUBLIC;
REVOKE ALL ON TABLE public.crm_schema_migrations FROM anonymous;
REVOKE ALL ON TABLE public.crm_schema_migrations FROM authenticated;

-- Legacy Finance RPC must never be called directly from a Data API identity.
-- crm_finance_api_v2 remains the supported token-validating wrapper.
REVOKE ALL ON FUNCTION public.crm_finance_api(text,text,jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_finance_api(text,text,jsonb) FROM anonymous;
REVOKE EXECUTE ON FUNCTION public.crm_finance_api(text,text,jsonb) FROM authenticated;

-- The lower-level housekeeping implementation is owner-only.
-- Scheduled execution continues through the existing controlled wrapper.
REVOKE ALL ON FUNCTION public.crm_housekeeping_v1() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_housekeeping_v1() FROM anonymous;
REVOKE EXECUTE ON FUNCTION public.crm_housekeeping_v1() FROM authenticated;

INSERT INTO public.crm_schema_migrations(version,note)
VALUES (
  '20260914_30_employee_readiness',
  'Baseline: migration ledger, legacy Finance exposure closed, direct housekeeping implementation owner-only.'
)
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst,'reload schema';
