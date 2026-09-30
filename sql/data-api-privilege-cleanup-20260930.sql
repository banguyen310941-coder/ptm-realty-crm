-- PTM CRM · Data API privilege cleanup · 2026-09-30
-- Keep the server-side Data API boundary on anonymous + application-level secrets/tokens.
-- Neon Auth's authenticated role is not used by the CRM server RPC client.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.crm_cemetery_api(text,text,jsonb) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_cemetery_api(text,text,jsonb) TO anonymous;

REVOKE EXECUTE ON FUNCTION public.crm_finance_api_v2(text,text,jsonb) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_finance_api_v2(text,text,jsonb) TO anonymous;

REVOKE EXECUTE ON FUNCTION public.crm_inventory_sync_v1(text,jsonb) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_inventory_sync_v1(text,jsonb) TO anonymous;

INSERT INTO public.crm_schema_migrations(version,note)
VALUES (
  '20260930_data_api_privilege_cleanup',
  'Remove unintended authenticated-role EXECUTE grants from cemetery, finance and inventory RPCs; retain anonymous server boundary.'
)
ON CONFLICT (version) DO NOTHING;

NOTIFY pgrst,'reload schema';

COMMIT;
